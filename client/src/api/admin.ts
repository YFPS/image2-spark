import { authFetch } from "./auth";
import type { ConversationDetail, ConversationListItem } from "./conversations";

const BASE = "/api/admin";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail?.error?.message || body?.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export type DashboardStats = {
  total_users: number;
  today_registrations: number;
  today_active_users: number;
  total_images_generated: number;
  today_images_generated: number;
  total_credits_consumed: number;
  today_credits_consumed: number;
};

export type AdminUser = {
  id: number;
  email: string;
  nickname: string;
  role: string;
  credits: number;
  disabled: boolean;
  email_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminAccessLog = {
  id: number;
  method: string;
  path: string;
  status_code: number;
  ip: string | null;
  user_id: number | null;
  duration_ms: number;
  created_at: string;
};

export type AdminOpLog = {
  id: number;
  admin_id: number;
  action: string;
  target_type: string | null;
  target_id: number | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

export type DAUItem = { date: string; count: number };

export type TrafficStats = {
  total_requests: number;
  today_requests: number;
  avg_duration_ms: number;
  error_rate: number;
  top_paths: { path: string; count: number }[];
};

export type UpstreamChannel = {
  id: number;
  name: string;
  base_url: string;
  api_key_masked: string;
  enabled: boolean;
  priority: number;
  supports_edit: boolean;
  max_concurrent: number;
  timeout_seconds: number;
  last_health_check: string | null;
  last_health_ok: boolean | null;
  last_latency_ms: number | null;
  total_requests: number;
  total_failures: number;
  created_at: string;
  updated_at: string;
};

export type UpstreamHealth = {
  id: number;
  name: string;
  base_url: string;
  enabled: boolean;
  last_health_ok: boolean | null;
  last_latency_ms: number | null;
  last_health_check: string | null;
  total_requests: number;
  total_failures: number;
  failure_rate: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  recent_requests: number;
  recent_failures: number;
  recent_failure_rate: number;
  recent_p95_latency_ms: number | null;
};

export type Paged<T> = { items: T[]; total: number; page: number; page_size: number };

export type AdminDataTableKey =
  | "conversations"
  | "messages"
  | "credit_transactions"
  | "email_verification_tokens"
  | "generated_assets";

export type AdminDataTableMeta = {
  key: AdminDataTableKey;
  label: string;
  columns: string[];
};

export type AdminUserSummary = {
  id: number;
  email: string;
  nickname: string;
  role: string;
};

export type AdminDataTableRow = Record<string, unknown> & {
  _user: AdminUserSummary | null;
  _conversation_id: number | null;
};

export type AdminDataTablePage = Paged<AdminDataTableRow> & {
  table: AdminDataTableKey;
  label: string;
  columns: string[];
};

export type AdminConversationListItem = ConversationListItem & {
  deleted_at: string | null;
};

export type AdminConversationDetail = ConversationDetail & {
  deleted_at: string | null;
};

export type AdminImageAsset = {
  id: number;
  user_id: number;
  conversation_id: number;
  message_id: number;
  slot_index: number;
  image_url: string | null;
  storage_kind: string;
  status: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: string;
  updated_at: string;
  _user: AdminUserSummary | null;
};

// ===== Dashboard =====
export const getDashboard = () => api<DashboardStats>("/dashboard");

// ===== Users =====
export const getUsers = (p: { page?: number; page_size?: number; search?: string; role?: string; disabled?: boolean }) => {
  const q = new URLSearchParams();
  if (p.page) q.set("page", String(p.page));
  if (p.page_size) q.set("page_size", String(p.page_size));
  if (p.search) q.set("search", p.search);
  if (p.role) q.set("role", p.role);
  if (p.disabled !== undefined) q.set("disabled", String(p.disabled));
  return api<Paged<AdminUser>>(`/users?${q}`);
};

export const getUser = (id: number) => api<AdminUser>(`/users/${id}`);

export const updateUser = (id: number, data: Partial<Pick<AdminUser, "nickname" | "role" | "disabled" | "credits">>) =>
  api<AdminUser>(`/users/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

export const deleteUser = (id: number) =>
  api<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" });

export const adjustCredits = (id: number, delta: number, note: string) =>
  api<{ ok: boolean; credits: number }>(`/users/${id}/adjust-credits`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delta, note }),
  });

export const getUserTransactions = (id: number, page?: number) =>
  api<Paged<{ id: number; delta: number; balance_after: number; reason: string; note: string | null; created_at: string }>>(
    `/users/${id}/transactions?page=${page || 1}`,
  );

// ===== Logs =====
export const getAccessLogs = (p: { page?: number; user_id?: number; path?: string; status_code?: number }) => {
  const q = new URLSearchParams();
  if (p.page) q.set("page", String(p.page));
  if (p.user_id) q.set("user_id", String(p.user_id));
  if (p.path) q.set("path", p.path);
  if (p.status_code) q.set("status_code", String(p.status_code));
  return api<Paged<AdminAccessLog>>(`/logs/access?${q}`);
};

export const getAdminLogs = (p: { page?: number; admin_id?: number; action?: string }) => {
  const q = new URLSearchParams();
  if (p.page) q.set("page", String(p.page));
  if (p.admin_id) q.set("admin_id", String(p.admin_id));
  if (p.action) q.set("action", p.action);
  return api<Paged<AdminOpLog>>(`/logs/operations?${q}`);
};

// ===== Stats =====
export const getDAU = (days?: number) => api<DAUItem[]>(`/stats/dau?days=${days || 30}`);
export const getTraffic = () => api<TrafficStats>("/stats/traffic");

// ===== Images =====
export const getImages = (p: { page?: number; user_id?: number; status?: string }) => {
  const q = new URLSearchParams();
  if (p.page) q.set("page", String(p.page));
  if (p.user_id) q.set("user_id", String(p.user_id));
  if (p.status) q.set("status", p.status);
  return api<Paged<AdminImageAsset>>(`/images?${q}`);
};

export const deleteImage = (id: number) => api<{ ok: boolean }>(`/images/${id}`, { method: "DELETE" });

// ===== Data Tables =====
export const getAdminDataTables = () => api<AdminDataTableMeta[]>("/data-tables");

export const getAdminDataTable = (
  table: AdminDataTableKey,
  p: {
    page?: number;
    page_size?: number;
    search?: string;
    user_id?: number;
    conversation_id?: number;
    message_id?: number;
    status?: string;
  } = {},
) => {
  const q = new URLSearchParams();
  if (p.page) q.set("page", String(p.page));
  if (p.page_size) q.set("page_size", String(p.page_size));
  if (p.search) q.set("search", p.search);
  if (p.user_id != null) q.set("user_id", String(p.user_id));
  if (p.conversation_id != null) q.set("conversation_id", String(p.conversation_id));
  if (p.message_id != null) q.set("message_id", String(p.message_id));
  if (p.status) q.set("status", p.status);
  return api<AdminDataTablePage>(`/data-tables/${table}?${q}`);
};

export const getAdminUserConversations = (userId: number) =>
  api<AdminConversationListItem[]>(`/users/${userId}/conversations`);

export const getAdminConversation = (conversationId: number) =>
  api<AdminConversationDetail>(`/conversations/${conversationId}`);

// ===== Upstreams =====
export const getUpstreams = () => api<UpstreamChannel[]>("/upstreams");

export const createUpstream = (data: {
  name: string; base_url: string; api_key: string; enabled?: boolean;
  priority?: number; supports_edit?: boolean; max_concurrent?: number; timeout_seconds?: number;
}) => api<UpstreamChannel>("/upstreams", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});

export const updateUpstream = (id: number, data: Partial<{
  name: string; base_url: string; api_key: string; enabled: boolean;
  priority: number; supports_edit: boolean; max_concurrent: number; timeout_seconds: number;
}>) => api<UpstreamChannel>(`/upstreams/${id}`, {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});

export const deleteUpstream = (id: number) => api<{ ok: boolean }>(`/upstreams/${id}`, { method: "DELETE" });

export const healthCheckUpstream = (id: number) => api<UpstreamHealth>(`/upstreams/${id}/health-check`, { method: "POST" });

export const getUpstreamStatus = () => api<UpstreamHealth[]>("/upstreams/status");
