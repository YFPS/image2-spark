// 单 hook 管整个对话历史状态：列表 + 当前详情 + 乐观增删改
//
// stale-while-revalidate 缓存策略：
//  - 挂载时同步从 localStorage 读上次拉到的列表作为初始 state（瞬时可用）
//  - 后台 refresh() 拉新数据覆盖
//  - 列表任何变化（refresh / 增删改 / 追加消息）都写回 localStorage
//  - cache key 按 user.id 区分，避免多账号串号
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationDetail,
  ConversationListItem,
  MessageCreateIn,
  MessageOut,
  createConversation as apiCreate,
  deleteConversation as apiDel,
  getConversation as apiGet,
  listConversations as apiList,
  patchConversation as apiPatch,
  postMessage as apiPostMsg,
} from "../api/conversations";
import { useAuth } from "../auth/AuthContext";
import { AuthApiError } from "../api/auth";
import { chooseRestoredConversationId } from "./pendingGeneration";

const CACHE_PREFIX = "conv_list_cache_v1:";
// currentId 持久化：刷新页面后回到上次正在看的会话；解决"刷新后默认变新对话"的 bug
const CURRENT_ID_PREFIX = "conv_current_id_v1:";

function cacheKey(userId: number | null | undefined): string | null {
  return userId ? `${CACHE_PREFIX}${userId}` : null;
}

function currentIdKey(userId: number | null | undefined): string | null {
  return userId ? `${CURRENT_ID_PREFIX}${userId}` : null;
}

function readListCache(userId: number | null | undefined): ConversationListItem[] {
  const k = cacheKey(userId);
  if (!k) return [];
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ConversationListItem[]) : [];
  } catch {
    return [];
  }
}

function writeListCache(userId: number | null | undefined, list: ConversationListItem[]): void {
  const k = cacheKey(userId);
  if (!k) return;
  try {
    localStorage.setItem(k, JSON.stringify(list));
  } catch {
    // 配额超限等异常静默忽略，缓存只是体验优化
  }
}

function readCurrentId(userId: number | null | undefined): number | null {
  const k = currentIdKey(userId);
  if (!k) return null;
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeCurrentId(userId: number | null | undefined, id: number | null): void {
  const k = currentIdKey(userId);
  if (!k) return;
  try {
    if (id == null) localStorage.removeItem(k);
    else localStorage.setItem(k, String(id));
  } catch {
    // 配额超限等异常静默忽略
  }
}

type State = {
  list: ConversationListItem[];
  current: ConversationDetail | null;
  loadingList: boolean;
  loadingDetail: boolean;
  error: string | null;
};

export type UseConversations = State & {
  searchQ: string;
  setSearchQ: (q: string) => void;
  currentId: number | null;
  setCurrentId: (id: number | null) => void;
  refresh: () => Promise<void>;
  createConversation: () => Promise<ConversationDetail>;
  appendMessage: (convId: number, body: MessageCreateIn) => Promise<MessageOut>;
  /** 把一条服务端返回的 message 挂到 current.messages（无 fetch；用于任务化生图） */
  attachMessage: (convId: number, m: MessageOut) => void;
  rename: (id: number, title: string) => Promise<void>;
  togglePin: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
};

export function useConversations(): UseConversations {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  // 初始 state 同步读 localStorage，避免首屏空列表抖动
  // 用 lazy initializer 保证只在首次渲染读一次
  const [state, setState] = useState<State>(() => ({
    list: readListCache(userId),
    current: null,
    loadingList: false,
    loadingDetail: false,
    error: null,
  }));
  const [searchQ, setSearchQ] = useState("");
  // currentId 同步从 localStorage 读，让刷新后自动回到上次会话
  const [currentId, _setCurrentId] = useState<number | null>(() => readCurrentId(userId));
  // setCurrentId 要稳定（其它 useCallback 用空 deps 引用它）；用 ref 跟踪 userId 避免 stale closure
  const userIdRef = useRef<number | null>(userId);
  userIdRef.current = userId;
  const setCurrentId = useCallback((id: number | null) => {
    _setCurrentId(id);
    writeCurrentId(userIdRef.current, id);
  }, []);

  // 用 ref 缓存最新 list，避免回调闭包旧值
  const listRef = useRef(state.list);
  listRef.current = state.list;
  const autoRestoreAttemptedRef = useRef(false);
  // optimistic id 生成器：自减计数 + Date.now() 偏移，杜绝同毫秒撞 id
  const optimisticSeqRef = useRef(0);

  // user 切换时换缓存：把旧 user 的 list 清掉，读新 user 的；currentId 也读新 user 的缓存
  const lastUserIdRef = useRef<number | null>(userId);
  useEffect(() => {
    if (lastUserIdRef.current !== userId) {
      lastUserIdRef.current = userId;
      setState((s) => ({ ...s, list: readListCache(userId), current: null }));
      // 跨账号切换时直接读新 user 的 currentId 缓存（不经过 setCurrentId 避免写错 user 的 key）
      _setCurrentId(readCurrentId(userId));
    }
    // setCurrentId 不依赖（其本身已 useCallback；切 user 时主动用 _setCurrentId）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // list 任何变化都同步写缓存（只有非空列表才写，避免覆盖掉昨天的缓存）
  useEffect(() => {
    if (userId && state.list.length > 0) {
      writeListCache(userId, state.list);
    }
  }, [userId, state.list]);

  // 拉列表
  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loadingList: true, error: null }));
    try {
      const list = await apiList({ q: searchQ || undefined });
      setState((s) => ({ ...s, list, loadingList: false }));
      if (!searchQ && !autoRestoreAttemptedRef.current) {
        autoRestoreAttemptedRef.current = true;
        const restoredId = chooseRestoredConversationId({ currentId, list });
        if (restoredId !== currentId) setCurrentId(restoredId);
      }
    } catch (e) {
      setState((s) => ({ ...s, loadingList: false, error: errMsg(e) }));
    }
  }, [currentId, searchQ, setCurrentId]);

  // 搜索词变化时拉列表（搜索框输入加 250ms debounce，避免每个按键都打后端）
  useEffect(() => {
    if (!searchQ) {
      // 空查询直接拉，不 debounce
      void refresh();
      return;
    }
    const t = window.setTimeout(() => void refresh(), 250);
    return () => window.clearTimeout(t);
  }, [refresh, searchQ]);

  // currentId 变化时拉详情
  useEffect(() => {
    if (currentId == null) {
      setState((s) => ({ ...s, current: null }));
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loadingDetail: true, error: null }));
    void apiGet(currentId)
      .then((d) => {
        if (alive) setState((s) => ({ ...s, current: d, loadingDetail: false }));
      })
      .catch((e) => {
        if (!alive) return;
        // 持久化的 currentId 指向已被删除 / 不属于本用户的会话时（404），清掉避免反复报错
        if (e instanceof AuthApiError && e.status === 404) {
          setCurrentId(null);
          setState((s) => ({ ...s, loadingDetail: false, error: null, current: null }));
          return;
        }
        setState((s) => ({ ...s, loadingDetail: false, error: errMsg(e) }));
      });
    return () => {
      alive = false;
    };
  }, [currentId, setCurrentId]);

  // 当前会话存在 pending 消息时启动轮询：
  //  - 每 2s 拉详情，比较 messages 中 pending 的数量
  //  - 全部 pending 变成 done/failed 时停止
  //  - 切换会话 / 卸载时也停止
  // 这是"刷新后接管"的核心：刷新后从 messages 看到 status=pending → 自动启动轮询直到结果回来
  const hasPending = !!state.current?.messages.some(
    (m) => m.role === "ai" && m.status === "pending",
  );
  useEffect(() => {
    if (!hasPending || currentId == null) return;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      if (!alive) return;
      try {
        const d = await apiGet(currentId);
        if (!alive) return;
        setState((s) => {
          // 只在当前 currentId 仍是这个会话时覆盖
          if (s.current?.id !== d.id) return s;
          return { ...s, current: d };
        });
        // 服务端可能也更新了 conv 的 updated_at / preview，顺手把 list 中这条同步
        setState((s) => ({ ...s, list: bumpListItem(s.list, d.id, d) }));
      } catch {
        // 单次失败不致命，下一轮 retry
      }
      if (!alive) return;
      timer = window.setTimeout(tick, 2000);
    };
    timer = window.setTimeout(tick, 2000);
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [hasPending, currentId]);

  // 新建会话：写入服务端 + 插入列表头 + 设为 current
  const createConversation = useCallback(async () => {
    const conv = await apiCreate();
    setState((s) => ({
      ...s,
      list: [toListItem(conv), ...s.list],
      current: conv,
    }));
    setCurrentId(conv.id);
    return conv;
  }, []);

  // 追加消息：乐观更新本地 current.messages + 更新 list 中该 session 的 preview/updated_at
  const appendMessage = useCallback(async (convId: number, body: MessageCreateIn) => {
    // 自减计数器保证同一渲染周期内连发多条消息也不会撞 id
    optimisticSeqRef.current -= 1;
    const optimisticId = optimisticSeqRef.current;
    const optimistic: MessageOut = {
      id: optimisticId, // 临时负数 id；落地后被服务端 id 覆盖
      role: body.role,
      text: body.text,
      image_urls: body.image_urls ?? null,
      params: body.params ?? null,
      status: "done", // appendMessage 走的是同步落库链路（user 文本 / 错误回复等），不进 pending 池
      created_at: new Date().toISOString(),
    };
    setState((s) => {
      if (s.current && s.current.id === convId) {
        const newTitle = !s.current.title && body.role === "user"
          ? body.text.trim().replace(/\s+/g, " ").slice(0, 30)
          : s.current.title;
        const newCurrent: ConversationDetail = {
          ...s.current,
          title: newTitle,
          message_count: s.current.message_count + 1,
          preview: s.current.preview || (body.role === "user" ? body.text.slice(0, 60) : s.current.preview),
          updated_at: optimistic.created_at,
          messages: [...s.current.messages, optimistic],
        };
        return { ...s, current: newCurrent, list: bumpListItem(s.list, convId, newCurrent) };
      }
      return s;
    });

    try {
      const saved = await apiPostMsg(convId, body);
      // 用服务端 id 覆盖 optimistic（用全局唯一负数 optimisticId 精确替换）
      setState((s) => {
        if (!s.current || s.current.id !== convId) return s;
        const messages = s.current.messages.map((m) => (m.id === optimisticId ? saved : m));
        return { ...s, current: { ...s.current, messages } };
      });
      return saved;
    } catch (e) {
      // 失败回滚：精确删掉这条 optimistic
      setState((s) => {
        if (!s.current || s.current.id !== convId) return s;
        return {
          ...s,
          current: {
            ...s.current,
            message_count: Math.max(0, s.current.message_count - 1),
            messages: s.current.messages.filter((m) => m.id !== optimisticId),
          },
          error: errMsg(e),
        };
      });
      throw e;
    }
  }, []);

  // 直接把一条服务端返回的 message 挂到 current.messages（用于任务化生图：
  // /api/images/generate 返回 pending message 后，前端立刻挂上，触发 hasPending 轮询）
  const attachMessage = useCallback((convId: number, m: MessageOut) => {
    setState((s) => {
      if (s.current?.id !== convId) return s;
      // 避免重复 attach（同 id 已存在则跳过）
      if (s.current.messages.some((x) => x.id === m.id)) return s;
      const newCurrent: ConversationDetail = {
        ...s.current,
        messages: [...s.current.messages, m],
        message_count: s.current.message_count + 1,
        has_pending: s.current.has_pending || (m.role === "ai" && m.status === "pending"),
      };
      return {
        ...s,
        current: newCurrent,
        list: bumpListItem(s.list, convId, newCurrent),
      };
    });
  }, []);

  // 重命名
  const rename = useCallback(async (id: number, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setState((s) => ({
      ...s,
      list: s.list.map((c) => (c.id === id ? { ...c, title: trimmed } : c)),
      current: s.current?.id === id ? { ...s.current, title: trimmed } : s.current,
    }));
    try {
      await apiPatch(id, { title: trimmed });
    } catch (e) {
      // 回滚靠 refresh
      await refresh();
      setState((s) => ({ ...s, error: errMsg(e) }));
    }
  }, [refresh]);

  // 切换收藏
  const togglePin = useCallback(async (id: number) => {
    const cur = listRef.current.find((c) => c.id === id);
    if (!cur) return;
    const next = !cur.pinned;
    setState((s) => ({
      ...s,
      list: s.list.map((c) => (c.id === id ? { ...c, pinned: next } : c)),
      current: s.current?.id === id ? { ...s.current, pinned: next } : s.current,
    }));
    try {
      await apiPatch(id, { pinned: next });
    } catch (e) {
      await refresh();
      setState((s) => ({ ...s, error: errMsg(e) }));
    }
  }, [refresh]);

  // 软删
  const remove = useCallback(async (id: number) => {
    setState((s) => ({
      ...s,
      list: s.list.filter((c) => c.id !== id),
      current: s.current?.id === id ? null : s.current,
    }));
    if (currentId === id) setCurrentId(null);
    try {
      await apiDel(id);
    } catch (e) {
      await refresh();
      setState((s) => ({ ...s, error: errMsg(e) }));
    }
  }, [currentId, refresh]);

  return {
    ...state,
    searchQ,
    setSearchQ,
    currentId,
    setCurrentId,
    refresh,
    createConversation,
    appendMessage,
    attachMessage,
    rename,
    togglePin,
    remove,
  };
}

function toListItem(d: ConversationDetail): ConversationListItem {
  return {
    id: d.id,
    title: d.title,
    pinned: d.pinned,
    preview: d.preview,
    message_count: d.message_count,
    has_pending: d.has_pending,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

/** 把列表里某条 session 的 preview/updated_at 同步到本地 list */
function bumpListItem(
  list: ConversationListItem[],
  id: number,
  cur: ConversationDetail,
): ConversationListItem[] {
  const idx = list.findIndex((c) => c.id === id);
  const updated: ConversationListItem = {
    id: cur.id,
    title: cur.title,
    pinned: cur.pinned,
    preview: cur.preview,
    message_count: cur.message_count,
    has_pending: cur.has_pending,
    created_at: cur.created_at,
    updated_at: cur.updated_at,
  };
  if (idx < 0) return [updated, ...list];
  const next = [...list];
  next[idx] = updated;
  return next;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "请求失败";
}
