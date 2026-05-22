// auth 后端契约镜像（与 server/app/schemas.py 对齐）

export type UserRole = "admin" | "user" | "paid";

export type UserPublic = {
  id: number;
  email: string;
  nickname: string;
  role: UserRole;
  avatar_url: string | null;
  credits: number;
  // 邮箱验证时间；null 表示未验证
  email_verified_at: string | null;
  // 后端派生：email_verified_at === null
  verification_required: boolean;
  last_login_at: string | null;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  user: UserPublic;
  // 注册接口返回；邮件 provider 临时故障时为 false，前端提示重发
  verification_email_sent: boolean;
};

export type ApiAuthError = {
  code: string;
  message: string;
  lock_remaining?: number;
};

export class AuthApiError extends Error {
  status: number;
  apiError: ApiAuthError;
  constructor(status: number, apiError: ApiAuthError) {
    super(apiError.message || apiError.code);
    this.status = status;
    this.apiError = apiError;
  }
}

// ===== token 存取 =====

const TOKEN_KEY = "auth_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

// ===== fetch 包装 =====

async function parseErrorBody(res: Response): Promise<ApiAuthError> {
  try {
    const j = await res.json();
    if (j?.error?.code) return j.error as ApiAuthError;
    if (j?.detail?.error?.code) return j.detail.error as ApiAuthError;
  } catch {
    // ignore
  }
  return { code: "network_error", message: `HTTP ${res.status}` };
}

/** 给受保护接口用：自动附 Bearer 头；401 时调用方负责清 token + 通知 context */
export async function authFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

// ===== auth API =====

export async function register(params: {
  email: string;
  password: string;
  nickname?: string;
}): Promise<TokenResponse> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new AuthApiError(res.status, await parseErrorBody(res));
  return (await res.json()) as TokenResponse;
}

export async function login(params: {
  email: string;
  password: string;
}): Promise<TokenResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new AuthApiError(res.status, await parseErrorBody(res));
  return (await res.json()) as TokenResponse;
}

export async function logout(): Promise<void> {
  const token = getToken();
  if (!token) return;
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

export async function fetchMe(): Promise<UserPublic> {
  const res = await authFetch("/api/auth/me");
  if (!res.ok) throw new AuthApiError(res.status, await parseErrorBody(res));
  return (await res.json()) as UserPublic;
}

// ===== 邮箱验证 =====

/** 用邮件链接里的 token 完成验证；成功返回最新 user（含 credits +5）。 */
export async function verifyEmail(token: string): Promise<UserPublic> {
  const res = await fetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new AuthApiError(res.status, await parseErrorBody(res));
  const body = (await res.json()) as { ok: boolean; user: UserPublic };
  return body.user;
}

/** 重发验证邮件。后端固定返回 {ok:true}，不暴露邮箱状态。 */
export async function resendVerification(email: string): Promise<void> {
  const res = await fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new AuthApiError(res.status, await parseErrorBody(res));
}
