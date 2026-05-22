import { useCallback, useEffect, useRef, useState } from "react";

import { fetchLogs, type LogItem } from "../api/logs";
import { useAuth } from "../auth/AuthContext";

type State = {
  items: LogItem[];
  nextCursor: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  endReached: boolean;
};

const INITIAL: State = {
  items: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  endReached: false,
};

/**
 * 日志分页 hook：与 useGallery 同形，只是 item shape 不同。
 */
export function useLogs() {
  const { user } = useAuth();
  const [state, setState] = useState<State>(INITIAL);
  const reqSeqRef = useRef(0);
  const cursorRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setState(INITIAL);
      cursorRef.current = null;
      return;
    }
    const seq = ++reqSeqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const page = await fetchLogs();
      if (seq !== reqSeqRef.current) return;
      cursorRef.current = page.next_cursor;
      setState({
        items: page.items,
        nextCursor: page.next_cursor,
        loading: false,
        loadingMore: false,
        error: null,
        endReached: page.next_cursor === null,
      });
    } catch (e) {
      if (seq !== reqSeqRef.current) return;
      console.warn("[logs] reload failed:", e);
      setState((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, [user]);

  const loadMore = useCallback(async () => {
    if (!user) return;
    const cursor = cursorRef.current;
    if (cursor == null) return;
    let shouldFire = false;
    setState((s) => {
      if (s.endReached || s.loading || s.loadingMore) return s;
      shouldFire = true;
      return { ...s, loadingMore: true };
    });
    if (!shouldFire) return;

    const seq = ++reqSeqRef.current;
    try {
      const page = await fetchLogs({ cursor });
      if (seq !== reqSeqRef.current) return;
      cursorRef.current = page.next_cursor;
      setState((s) => ({
        ...s,
        items: [...s.items, ...page.items],
        nextCursor: page.next_cursor,
        loadingMore: false,
        endReached: page.next_cursor === null,
      }));
    } catch (e) {
      if (seq !== reqSeqRef.current) return;
      console.warn("[logs] loadMore failed:", e);
      setState((s) => ({ ...s, loadingMore: false, error: String(e) }));
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setState(INITIAL);
      cursorRef.current = null;
      reqSeqRef.current++;
      return;
    }
    void reload();
  }, [user, reload]);

  return {
    items: state.items,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    endReached: state.endReached,
    reload,
    loadMore,
  };
}
