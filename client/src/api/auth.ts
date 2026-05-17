// auth 后端契约镜像（与 server/app/schemas.py 对齐）

export type UserRole = "admin" | "user" | "paid";

export type UserPublic = {
  id: number;
  email: string;
  nickname: string;
  role: UserRole;
  avatar_url: string | null;
  credits: number;
  last_login_at: string | null;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  user: UserPublic;
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
