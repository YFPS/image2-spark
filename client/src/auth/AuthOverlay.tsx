// 登录/注册全屏页 —— 极简左右布局，右侧使用项目液态玻璃卡片效果。

import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AuthApiError,
  login as apiLogin,
  register as apiRegister,
} from "../api/auth";
import { loadStoredParams } from "../GlassControls";
import { LiquidGlass, type GlassShape } from "../LiquidGlass";
import { useAuth } from "./AuthContext";

type Tab = "login" | "register";

const ERROR_TEXT: Record<string, string> = {
  email_invalid: "邮箱格式不正确",
  password_weak: "密码须 8-72 位且含字母与数字",
  nickname_invalid: "昵称须为 1-32 字符",
  email_taken: "该邮箱已注册",
  invalid_credentials: "邮箱或密码错误",
  invalid_token: "登录已过期，请重新登录",
  account_disabled: "账号已停用，请联系管理员",
  email_not_verified: "请先验证邮箱后再继续",
  verification_token_invalid: "验证链接无效或已使用",
  verification_token_expired: "验证链接已过期，请重新发送",
  forbidden: "当前角色无权访问",
  too_many_attempts: "登录失败次数过多，请稍后再试",
  internal_error: "服务异常，请稍后重试",
  network_error: "网络异常，请检查后重试",
};

const ACCENT = "#F0FE2D";
const LINK = "#4CB1FF";
const FONT =
  "Outfit, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function fmtError(err: unknown, fallback = "操作失败"): string {
  if (err instanceof AuthApiError) {
    const code = err.apiError.code;
    let text = ERROR_TEXT[code] || err.apiError.message || fallback;
    if (code === "too_many_attempts" && err.apiError.lock_remaining) {
      const mins = Math.ceil(err.apiError.lock_remaining / 60);
      text = `${text}（约 ${mins} 分钟后重试）`;
    }
    return text;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export function AuthOverlay() {
  const { completeAuth } = useAuth();
  const glassPanelRef = useRef<HTMLElement>(null);
  const [glassShapes, setGlassShapes] = useState<GlassShape[]>([]);
  const [glassParams] = useState(() => loadStoredParams());
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const panel = glassPanelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const seamOverlap = 36;
      setGlassShapes([
        {
          centerX: rect.left - seamOverlap + (rect.width + seamOverlap) / 2,
          centerY: rect.top + rect.height / 2,
          width: rect.width + seamOverlap,
          height: rect.height,
          radius: 36,
        },
      ]);
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tab]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const response =
        tab === "login"
          ? await apiLogin({ email: email.trim(), password })
          : await apiRegister({
              email: email.trim(),
              password,
              nickname: nickname.trim() || undefined,
            });
      completeAuth(response);
    } catch (e) {
      setErr(fmtError(e));
      setBusy(false);
    }
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setErr("");
  };

  return (
    <div
      className="fixed inset-0 z-[1000] overflow-hidden bg-[#0D0D0D]"
      style={{ fontFamily: FONT }}
    >
      <LiquidGlass shapes={glassShapes} params={glassParams} />
      <ReferenceDitheringBackground />

      <main className="relative z-10 flex min-h-screen items-center justify-center overflow-y-auto p-4 md:overflow-hidden md:p-8">
        <section className="relative grid w-full max-w-[1000px] overflow-hidden rounded-[36px] shadow-[0_32px_90px_rgba(0,0,0,0.55)] md:h-[700px] md:grid-cols-2">
          <div className="relative z-20 min-h-[360px] overflow-hidden rounded-t-[36px] md:min-h-0 md:rounded-l-[36px] md:rounded-r-none">
            <img
              src="/auth-left-image.webp"
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>

          <section
            ref={glassPanelRef}
            className="relative z-10 flex min-h-[520px] items-center justify-center rounded-b-[36px] border border-white/[0.08] p-6 md:min-h-0 md:rounded-l-none md:rounded-r-[36px] md:border-l-0 md:p-10"
            style={{
              background: "rgba(28,28,32,0.18)",
              backdropFilter: "blur(10px) saturate(130%)",
              WebkitBackdropFilter: "blur(10px) saturate(130%)",
              boxShadow: "0 1px 0 rgba(255,255,255,0.05) inset",
            }}
          >
            <div className="relative w-full max-w-[420px]">
            <div>
              <h1 className="text-[22px] font-semibold tracking-normal text-white">
                {tab === "login" ? "登录 image2" : "注册 image2"}
              </h1>
              <p className="mt-1 text-[12px] leading-5 text-white/48">
                继续进入 AI 图像工作台。
              </p>
            </div>

            <div className="mt-6 flex h-[50px] rounded-full border border-white/[0.06] bg-white/[0.04] p-1">
              <TabPill active={tab === "login"} onClick={() => switchTab("login")}>
                登录
              </TabPill>
              <TabPill active={tab === "register"} onClick={() => switchTab("register")}>
                注册
              </TabPill>
            </div>

            <form onSubmit={onSubmit} autoComplete="on" className="mt-5">
              <SharedFieldGroup>
                <FieldRow label="邮箱">
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full bg-transparent text-[13px] text-white/90 placeholder:text-white/30 focus:outline-none"
                  />
                </FieldRow>

                <FieldRow
                  label="密码"
                  right={
                    tab === "login" && (
                      <button
                        type="button"
                        className="text-[12px] font-medium transition-opacity hover:opacity-80"
                        style={{ color: LINK }}
                      >
                        忘记密码？
                      </button>
                    )
                  }
                >
                  <div className="flex items-center gap-2">
                    <input
                      type={showPwd ? "text" : "password"}
                      required
                      minLength={8}
                      maxLength={72}
                      autoComplete={tab === "login" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={tab === "register" ? "8-72 位，含字母与数字" : "请输入密码"}
                      className="w-full bg-transparent text-[13px] text-white/90 placeholder:text-white/30 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="shrink-0 text-white/45 transition-colors hover:text-white/75"
                      aria-label={showPwd ? "隐藏密码" : "显示密码"}
                    >
                      {showPwd ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                  </div>
                </FieldRow>

                {tab === "register" && (
                  <FieldRow label="昵称">
                    <input
                      type="text"
                      autoComplete="nickname"
                      maxLength={32}
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder="选填，默认使用邮箱前缀"
                      className="w-full bg-transparent text-[13px] text-white/90 placeholder:text-white/30 focus:outline-none"
                    />
                  </FieldRow>
                )}
              </SharedFieldGroup>

              {err && (
                <div className="mt-3 rounded-[10px] border border-red-300/25 bg-red-400/10 px-3 py-2 text-[12px] leading-relaxed text-red-200">
                  {err}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-5 h-[50px] w-full rounded-full text-[14px] font-semibold tracking-normal text-[#0D0D0D] transition-all active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 md:hover:brightness-105"
                style={{
                  background: ACCENT,
                  boxShadow: "0 0 24px rgba(240,254,45,0.35)",
                }}
              >
                {busy ? "处理中..." : tab === "login" ? "登录" : "注册"}
              </button>

              <div className="mt-5 text-center text-[12px] text-white/52">
                {tab === "login" ? (
                  <>
                    没有账号？{" "}
                    <button
                      type="button"
                      onClick={() => switchTab("register")}
                      className="font-medium transition-opacity hover:opacity-80"
                      style={{ color: LINK }}
                    >
                      注册
                    </button>
                  </>
                ) : (
                  <>
                    已有账号？{" "}
                    <button
                      type="button"
                      onClick={() => switchTab("login")}
                      className="font-medium transition-opacity hover:opacity-80"
                      style={{ color: LINK }}
                    >
                      登录
                    </button>
                  </>
                )}
              </div>
            </form>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}

function ReferenceDitheringBackground() {
  return (
    <div className="auth-compute-background pointer-events-none fixed inset-0 z-[1] select-none overflow-hidden bg-black">
      <video
        className="absolute inset-0 h-full w-full object-cover opacity-80"
        style={{ objectPosition: "center" }}
        autoPlay
        loop
        muted
        playsInline
      >
        <source
          src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/bg-hero-0BnFGdr81Ifnj3WbBZoNt1KE4D5DMT.mp4"
          type="video/mp4"
        />
      </video>
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.74) 0%, rgba(0,0,0,0.36) 52%, rgba(0,0,0,0.04) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.24) 0%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.66) 100%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)",
          backgroundSize: "114px 114px, 114px 114px",
          backgroundPosition: "center center",
        }}
      />
    </div>
  );
}

function TabPill(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex-1 rounded-full py-1.5 text-[12px] font-medium tracking-normal transition-all active:scale-[0.98]"
      style={
        props.active
          ? {
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.92)",
              boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset",
            }
          : {
              color: "rgba(255,255,255,0.45)",
              background: "transparent",
            }
      }
    >
      {props.children}
    </button>
  );
}

function SharedFieldGroup({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-white/[0.06] bg-black/30">
      <style>{`
        .auth-shared-row + .auth-shared-row {
          border-top: 1px solid rgba(255,255,255,0.06);
        }
      `}</style>
      {children}
    </div>
  );
}

function FieldRow(props: { label: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-shared-row px-4 py-3">
      <div className="flex items-center justify-between">
        <label className="text-[10.5px] uppercase tracking-normal text-white/45">
          {props.label}
        </label>
        {props.right}
      </div>
      <div className="mt-1">{props.children}</div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6.5 0 10 6 10 6a17.6 17.6 0 0 1-3.3 4M6.1 6.1C3.6 7.7 2 12 2 12s3.5 7 10 7c2 0 3.7-.6 5.1-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
