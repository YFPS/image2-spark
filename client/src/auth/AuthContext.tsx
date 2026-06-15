// 全局鉴权上下文：token + user + 操作 API
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AuthApiError,
  fetchMe,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  resendVerification as apiResendVerification,
  setToken,
  verifyEmail as apiVerifyEmail,
  type TokenResponse,
  type UserPublic,
} from "../api/auth";

type Status = "loading" | "unauthenticated" | "authenticated";

type VerifyFlash = { kind: "success" | "error"; message: string } | null;

type AuthState = {
  user: UserPublic | null;
  status: Status;
  // 注册响应里的 verification_email_sent；登录后清回 null
  verificationEmailSent: boolean | null;
  // 邮件链接验证后的成功/失败提示；UI 展示一段时间后清掉
  verifyFlash: VerifyFlash;
  clearVerifyFlash: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname?: string) => Promise<void>;
  completeAuth: (response: TokenResponse) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  verifyEmailToken: (token: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth 必须在 <AuthProvider> 内使用");
  return v;
}

/** 从当前 URL 抽出 ?token=...；命中 /verify-email 路径时返回 token，否则 null。 */
function readVerifyTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  if (window.location.pathname !== "/verify-email") return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  return token && token.length >= 16 ? token : null;
}

/** 把 URL 清回 /，不刷新页面。 */
function clearVerifyUrl(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/verify-email") {
    window.history.replaceState({}, "", "/");
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [verificationEmailSent, setVerificationEmailSent] = useState<boolean | null>(null);
  const [verifyFlash, setVerifyFlash] = useState<VerifyFlash>(null);

  const clearVerifyFlash = useCallback(() => setVerifyFlash(null), []);

  const completeAuth = useCallback((response: TokenResponse) => {
    setToken(response.access_token);
    setUser(response.user);
    setVerificationEmailSent(response.verification_email_sent ?? null);
    setStatus("authenticated");
  }, []);

  const refresh = useCallback(async () => {
    const t = getToken();
    if (!t) {
      setUser(null);
      setStatus("unauthenticated");
      return;
    }
    try {
      const me = await fetchMe();
      setUser(me);
      setStatus("authenticated");
    } catch (e) {
      if (e instanceof AuthApiError && (e.status === 401 || e.status === 403)) {
        setToken(null);
      }
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  // 启动时：先处理邮件链接 /verify-email?token=...，再走常规 refresh
  // verify-email 接口本身不需要 JWT，匿名也能调；但有/无本地 token 走两条不同 UX 路径：
  //  - 有 token：用 verify 返回的最新 user 覆盖 state，直接进主页（已验证态）
  //  - 无 token：只展示 flash 提示，引导到登录页（不能凭空 setStatus 为 authenticated）
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const verifyToken = readVerifyTokenFromUrl();
      if (verifyToken) {
        const hasSession = !!getToken();
        try {
          const nextUser = await apiVerifyEmail(verifyToken);
          if (cancelled) return;
          if (hasSession) {
            setUser(nextUser);
            setVerificationEmailSent(null);
            setStatus("authenticated");
          }
          setVerifyFlash({
            kind: "success",
            message: hasSession
              ? "邮箱验证成功，已发放注册赠送积分"
              : "邮箱验证成功，请登录后继续",
          });
        } catch (e) {
          if (cancelled) return;
          const msg =
            e instanceof AuthApiError
              ? e.apiError.code === "verification_token_expired"
                ? "验证链接已过期，请重新发送"
                : e.apiError.code === "verification_token_invalid"
                  ? "验证链接无效或已使用"
                  : e.apiError.message || "验证失败"
              : "验证失败";
          setVerifyFlash({ kind: "error", message: msg });
        } finally {
          clearVerifyUrl();
          // 不论 verify 成功失败，都走一次 refresh：
          //  - 已登录：上一行 setUser 已覆盖最新态，refresh 是兜底
          //  - 未登录：让 status 转到 "unauthenticated"，渲染登录页
          if (!cancelled) await refresh();
        }
        return;
      }
      await refresh();
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await apiLogin({ email, password });
    completeAuth(r);
  }, [completeAuth]);

  const register = useCallback(
    async (email: string, password: string, nickname?: string) => {
      const r = await apiRegister({ email, password, nickname });
      completeAuth(r);
    },
    [completeAuth],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    setToken(null);
    setUser(null);
    setVerificationEmailSent(null);
    setStatus("unauthenticated");
  }, []);

  const verifyEmailToken = useCallback(async (token: string) => {
    const nextUser = await apiVerifyEmail(token);
    setUser(nextUser);
    setVerificationEmailSent(null);
    setStatus("authenticated");
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!user) return;
    await apiResendVerification(user.email);
    setVerificationEmailSent(true);
  }, [user]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      verificationEmailSent,
      verifyFlash,
      clearVerifyFlash,
      login,
      register,
      completeAuth,
      logout,
      refresh,
      verifyEmailToken,
      resendVerificationEmail,
    }),
    [
      user,
      status,
      verificationEmailSent,
      verifyFlash,
      clearVerifyFlash,
      login,
      register,
      completeAuth,
      logout,
      refresh,
      verifyEmailToken,
      resendVerificationEmail,
    ],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
