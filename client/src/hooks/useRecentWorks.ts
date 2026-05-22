import { useCallback, useEffect, useRef, useState } from "react";

import { fetchRecentWorks, type RecentWorkItem } from "../api/gptImage";
import { useAuth } from "../auth/AuthContext";

type State = {
  items: RecentWorkItem[];
  loading: boolean;
  error: string | null;
};

const INITIAL: State = { items: [], loading: false, error: null };

/**
 * 最近作品 hook：
 *  - 用户登录后挂载即首拉
 *  - 用户登出 / 切换时清空
 *  - 通过 refresh() 让外部触发重拉（实时刷新场景：AI 消息 pending→done）
 */
export function useRecentWorks() {
  const { user } = useAuth();
  const [state, setState] = useState<State>(INITIAL);
  // 防止竞态：旧请求迟回时不要覆盖新结果
  const reqSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setState(INITIAL);
      return;
    }
    const seq = ++reqSeqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const items = await fetchRecentWorks();
      if (seq !== reqSeqRef.current) return; // 旧请求，丢弃
      setState({ items, loading: false, error: null });
    } catch (e) {
      if (seq !== reqSeqRef.current) return;
      // 静默 fallback —— 最近作品失败不该影响主流程
      console.warn("[recentWorks] refresh failed:", e);
      setState((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, [user]);

  // 登入 / 登出自动同步
  useEffect(() => {
    if (!user) {
      setState(INITIAL);
      reqSeqRef.current++;
      return;
    }
    void refresh();
  }, [user, refresh]);

  return {
    items: state.items,
    loading: state.loading,
    error: state.error,
    refresh,
  };
}
