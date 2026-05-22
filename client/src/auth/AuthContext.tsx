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
  type UserPublic,
} from "../api/auth";

type Status = "loading" | "unauthenticated" | "authenticated";

type AuthState = {
  user: UserPublic | null;
  status: Status;
  // 注册响应里的 verification_email_sent；登录后清回 null
  verificationEmailSent: boolean | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname?: string) => Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [verificationEmailSent, setVerificationEmailSent] = useState<boolean | null>(null);

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await apiLogin({ email, password });
    setToken(r.access_token);
    setUser(r.user);
    setVerificationEmailSent(null);
    setStatus("authenticated");
  }, []);

  const register = useCallback(
    async (email: string, password: string, nickname?: string) => {
      const r = await apiRegister({ email, password, nickname });
      setToken(r.access_token);
      setUser(r.user);
      setVerificationEmailSent(r.verification_email_sent);
      setStatus("authenticated");
    },
    [],
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
      login,
      register,
      logout,
      refresh,
      verifyEmailToken,
      resendVerificationEmail,
    }),
    [
      user,
      status,
      verificationEmailSent,
      login,
      register,
      logout,
      refresh,
      verifyEmailToken,
      resendVerificationEmail,
    ],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
