// conversations 后端契约镜像（与 server/app/schemas.py 对齐）
import { authFetch, AuthApiError } from "./auth";

export type MessageRole = "user" | "ai";
// 异步生成状态：done（落库完成）/ pending（后台 task 进行中）/ failed（上游异常）
// user 消息恒为 done；AI 消息可能为 pending（前端从此 status 识别"生成中"占位 + 启动轮询）
export type MessageStatus = "done" | "pending" | "failed";

export type MessageOut = {
  id: number;
  role: MessageRole;
  text: string;
  image_urls: string[] | null;
  params: Record<string, unknown> | null;
  status: MessageStatus;
  created_at: string;
};

export type ConversationListItem = {
  id: number;
  title: string;
  pinned: boolean;
  preview: string;
  message_count: number;
  created_at: string;
  updated_at: string;
};

export type ConversationDetail = ConversationListItem & {
  messages: MessageOut[];
};

export type MessageCreateIn = {
  role: MessageRole;
  text: string;
  image_urls?: string[] | null;
  params?: Record<string, unknown> | null;
};

export type ConversationPatchIn = {
  title?: string;
  pinned?: boolean;
};

async function parseErr(res: Response): Promise<AuthApiError> {
  let code = "network_error";
  let message = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    const err = j?.error || j?.detail?.error;
    if (err?.code) {
      code = err.code;
      message = err.message || err.code;
    }
  } catch {
    // ignore
  }
  return new AuthApiError(res.status, { code, message });
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw await parseErr(res);
  return (await res.json()) as T;
}

/** 列表 + 可选关键词搜索 / pinned 过滤 */
export async function listConversations(opts: { q?: string; pinned?: boolean } = {}): Promise<ConversationListItem[]> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.pinned !== undefined) params.set("pinned", opts.pinned ? "1" : "0");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await authFetch(`/api/conversations${qs}`);
  return jsonOrThrow<ConversationListItem[]>(res);
}

export async function createConversation(): Promise<ConversationDetail> {
  const res = await authFetch("/api/conversations", { method: "POST" });
  return jsonOrThrow<ConversationDetail>(res);
}

export async function getConversation(id: number): Promise<ConversationDetail> {
  const res = await authFetch(`/api/conversations/${id}`);
  return jsonOrThrow<ConversationDetail>(res);
}

export async function patchConversation(
  id: number,
  body: ConversationPatchIn,
): Promise<ConversationListItem> {
  const res = await authFetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<ConversationListItem>(res);
}

export async function deleteConversation(id: number): Promise<void> {
  const res = await authFetch(`/api/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw await parseErr(res);
}

export async function postMessage(
  convId: number,
  body: MessageCreateIn,
): Promise<MessageOut> {
  const res = await authFetch(`/api/conversations/${convId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<MessageOut>(res);
}
