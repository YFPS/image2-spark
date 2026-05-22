import { authFetch } from "./auth";

export type LogType =
  | "signup_bonus"
  | "recharge"
  | "admin_grant"
  | "generate"
  | "edit"
  | "refund"
  | "adjust";

export type LogRef = {
  kind: "message";
  message_id: number;
  conversation_id: number;
  thumbnail_url: string | null;
  prompt_preview: string | null;
};

export type LogItem = {
  id: number;
  type: LogType;
  delta: number;
  balance_after: number;
  note: string | null;
  created_at: string; // ISO
  ref: LogRef | null;
};

export type LogsPage = {
  items: LogItem[];
  next_cursor: number | null;
};

export async function fetchLogs(opts?: {
  cursor?: number | null;
  limit?: number;
}): Promise<LogsPage> {
  const params = new URLSearchParams();
  if (opts?.cursor != null) params.set("cursor", String(opts.cursor));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await authFetch(`/api/me/logs${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    throw new Error(`fetchLogs failed: ${res.status}`);
  }
  return (await res.json()) as LogsPage;
}
