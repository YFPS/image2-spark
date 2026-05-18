// 单 hook 管整个对话历史状态：列表 + 当前详情 + 乐观增删改
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
  rename: (id: number, title: string) => Promise<void>;
  togglePin: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
};

export function useConversations(): UseConversations {
  const [state, setState] = useState<State>({
    list: [],
    current: null,
    loadingList: false,
    loadingDetail: false,
    error: null,
  });
  const [searchQ, setSearchQ] = useState("");
  const [currentId, setCurrentId] = useState<number | null>(null);

  // 用 ref 缓存最新 list，避免回调闭包旧值
  const listRef = useRef(state.list);
  listRef.current = state.list;
  // optimistic id 生成器：自减计数 + Date.now() 偏移，杜绝同毫秒撞 id
  const optimisticSeqRef = useRef(0);

  // 拉列表
  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loadingList: true, error: null }));
    try {
      const list = await apiList({ q: searchQ || undefined });
      setState((s) => ({ ...s, list, loadingList: false }));
    } catch (e) {
      setState((s) => ({ ...s, loadingList: false, error: errMsg(e) }));
    }
  }, [searchQ]);

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
        if (alive) setState((s) => ({ ...s, loadingDetail: false, error: errMsg(e) }));
      });
    return () => {
      alive = false;
    };
  }, [currentId]);

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
