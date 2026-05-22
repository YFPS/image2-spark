// 登录/注册全屏页 —— 节点画布风格（按 pencil 设计稿 image2-signin 精修还原）
//
// 设计稿要点（与 DESIGN.md v0.2 一致）：
//  - 深 #0D0D0D 画布 + dot-grid + 三色辉光雾
//  - 中央卡片是"节点造型"：14px 圆角玻璃 + 空心白圆环节点头（不是实心圆，DESIGN.md 铁律）+ v0.2 角标
//  - Email + Password 共用一个内层灰卡容器，中间细线分隔（设计稿原样）
//  - 唯一电黄 CTA "Sign in →" / "Sign up →"（accent-foxo #F0FE2D，黑字）
//  - Forgot? 与 Sign up → 用天蓝 link 色 #4CB1FF
//  - 第三方按钮三个并排带文字的胶囊（G Google / GitHub / SSO）
//  - 卡下方协作者三色点（黄/蓝/粉），呼应主画布
//  - 周边漂浮 Model / PostFire / Output 装饰节点 + SVG 弧形虚线连线
//  - 右下 telemetry-block + 底部 fine-print

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { AuthApiError } from "../api/auth";
import Image2SigninFrame from "../generated/Image2SigninFrame";
import { useAuth } from "./AuthContext";

type Tab = "login" | "register";

// 错误码 → 中文文案
const ERROR_TEXT: Record<string, string> = {
  email_invalid: "邮箱格式不正确",
  password_weak: "密码须 8–72 位且含字母与数字",
  nickname_invalid: "昵称须为 1–32 字符",
  email_taken: "该邮箱已注册",
  invalid_credentials: "邮箱或密码错误",
  invalid_token: "登录已过期，请重新登录",
  // account_disabled 在登录路径已不再返回（合流到 invalid_credentials）；
  // 但 /me 等受保护接口在中途封号场景仍会返回，保留文案
  account_disabled: "账号已停用，请联系管理员",
  email_not_verified: "请先验证邮箱后再继续",
  verification_token_invalid: "验证链接无效或已使用",
  verification_token_expired: "验证链接已过期，请重新发送",
  forbidden: "当前角色无权访问",
  too_many_attempts: "登录失败次数过多，请稍后再试",
  internal_error: "服务异常，请稍后重试",
  network_error: "网络异常，请检查后重试",
};

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

// 端口/协作者语义色（与 DESIGN.md 一致）
const PORT = {
  model: "#F0FE2D",     // accent-foxo (Paul)
  positive: "#7CE38B",
  image: "#4CB1FF",     // accent-robot (Kate / 链接色)
  output: "#FF7E87",    // accent-ptext (Mario)
};

const LINK = "#4CB1FF"; // 链接/Forgot/Sign up 的天蓝色

const FONT =
  "Outfit, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export function AuthOverlay() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showGeneratedFrame, setShowGeneratedFrame] = useState(false);

  // 右下遥测块：实时秒/迭代/种子
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setElapsed((v) => v + 0.04), 40);
    return () => window.clearInterval(t);
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (tab === "login") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, nickname.trim() || undefined);
      }
    } catch (e) {
      setErr(fmtError(e));
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setErr("");
  };

  if (showGeneratedFrame) {
    return (
      <div className="fixed inset-0 z-[1000] overflow-hidden">
        <Image2SigninFrame />
        <button
          type="button"
          onClick={() => setShowGeneratedFrame(false)}
          className="absolute right-6 top-6 z-50 rounded-full border border-white/[0.12] bg-[#1c1c2099] px-4 py-2 text-[12px] font-medium text-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-[18px] transition hover:bg-white/[0.08] hover:text-white active:scale-[0.98]"
        >
          返回当前登录页
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[1000] overflow-hidden"
      style={{
        background: "#0D0D0D",
        fontFamily: FONT,
        color: "rgba(255,255,255,0.92)",
      }}
    >
      {/* 1. 画布底纹 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(255,255,255,0.06) 1px, transparent 1.4px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute h-[520px] w-[520px] rounded-full"
          style={{
            top: -120,
            left: "18%",
            background: "rgba(255,80,200,0.22)",
            filter: "blur(120px)",
          }}
        />
        <div
          className="absolute h-[560px] w-[560px] rounded-full"
          style={{
            bottom: -160,
            right: "12%",
            background: "rgba(80,180,255,0.18)",
            filter: "blur(120px)",
          }}
        />
        <div
          className="absolute h-[400px] w-[400px] rounded-full"
          style={{
            top: "30%",
            right: "8%",
            background: "rgba(140,100,255,0.16)",
            filter: "blur(120px)",
          }}
        />
      </div>

      {/* 2. 装饰 SVG 连线 */}
      <DecoWires />

      {/* 3. 装饰节点 */}
      <DecoNode
        className="hidden lg:block"
        style={{ top: 96, left: 64 }}
        title="Model"
        subtitle="v1.0 image"
        port={{ side: "right", color: PORT.model, top: 56 }}
      />
      <DecoNode
        className="hidden lg:block"
        style={{ bottom: 132, left: 96 }}
        title="PostFire"
        subtitle="post-process · auto"
        meta="+12"
      />
      <DecoOutputNode className="hidden lg:block" style={{ top: 132, right: 80 }} />

      {/* 4. 顶部品牌 mark */}
      <div className="absolute left-8 top-7 z-10 flex items-center gap-2.5">
        <BrandMark />
        <div className="leading-tight">
          <div className="text-[13px] font-medium" style={{ color: "rgba(255,255,255,0.92)" }}>
            image2
          </div>
          <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>
            AI canvas · v0.2
          </div>
        </div>
      </div>

      {/* 5. 中央登录节点卡 */}
      <button
        type="button"
        onClick={() => setShowGeneratedFrame(true)}
        className="absolute right-8 top-7 z-20 rounded-full border border-white/[0.10] px-4 py-2 text-[12px] font-medium transition-all hover:-translate-y-0.5 hover:border-white/[0.18] hover:bg-white/[0.08] active:scale-[0.98]"
        style={{
          background: "rgba(28,28,32,0.60)",
          color: "rgba(255,255,255,0.78)",
          backdropFilter: "blur(18px) saturate(140%)",
          WebkitBackdropFilter: "blur(18px) saturate(140%)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
        }}
      >
        测试新版登录页
      </button>

      <div
        className="absolute left-1/2 top-1/2 z-10 w-[400px] -translate-x-1/2 -translate-y-1/2"
        style={{ fontFamily: FONT }}
      >
        <div
          className="relative rounded-[14px]"
          style={{
            background: "rgba(28,28,32,0.6)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(18px) saturate(140%)",
            WebkitBackdropFilter: "blur(18px) saturate(140%)",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {/* 节点头：空心白圆环 + 标题 + 副标 + v0.2 角标 */}
          <div className="px-5 pt-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                {/* 空心白圆环（DESIGN.md v0.2 节点激活态标识，不要用实心圆） */}
                <span
                  className="h-3 w-3 rounded-full"
                  style={{
                    border: "1.5px solid rgba(255,255,255,0.85)",
                    background: "transparent",
                  }}
                />
                <span
                  className="text-[15px] font-medium"
                  style={{ color: "rgba(255,255,255,0.95)" }}
                >
                  {tab === "login" ? "Sign in to image2" : "Create your image2"}
                </span>
              </div>
              <span
                className="text-[10px] tabular-nums"
                style={{ color: "rgba(255,255,255,0.32)", letterSpacing: "0.04em" }}
              >
                v0.2
              </span>
            </div>
            <div
              className="mt-1.5 text-[12px]"
              style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "0.01em" }}
            >
              Collaborative AI canvas — free for teams.
            </div>
          </div>

          {/* tab 切换：极简灰阶 pill（不抢电黄 CTA） */}
          <div className="px-5 pt-4">
            <div
              className="flex rounded-full p-1"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <TabPill active={tab === "login"} onClick={() => switchTab("login")}>
                Sign in
              </TabPill>
              <TabPill active={tab === "register"} onClick={() => switchTab("register")}>
                Sign up
              </TabPill>
            </div>
          </div>

          {/* 表单 */}
          <form onSubmit={onSubmit} autoComplete="on" className="px-5 pb-5 pt-4">
            {/* Email + Password 共享深色卡片容器（设计稿原样：中间细线分隔） */}
            <SharedFieldGroup>
              <FieldRow label="Email">
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="paul@image2.dev"
                  className="w-full bg-transparent text-[13px] focus:outline-none"
                  style={{ color: "rgba(255,255,255,0.92)" }}
                />
              </FieldRow>

              <FieldRow
                label="Password"
                right={
                  tab === "login" && (
                    <button
                      type="button"
                      className="text-[12px] font-medium transition-opacity hover:opacity-80"
                      style={{ color: LINK }}
                    >
                      Forgot?
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
                    placeholder={tab === "register" ? "8–72 chars, letters + digits" : "••••••••••"}
                    className="w-full bg-transparent text-[13px] focus:outline-none"
                    style={{ color: "rgba(255,255,255,0.92)" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="shrink-0 transition-opacity hover:opacity-100"
                    style={{ color: "rgba(255,255,255,0.40)" }}
                    aria-label={showPwd ? "隐藏密码" : "显示密码"}
                  >
                    {showPwd ? <EyeIcon /> : <EyeOffIcon />}
                  </button>
                </div>
              </FieldRow>

              {/* 注册才显示：昵称 */}
              {tab === "register" && (
                <FieldRow label="Nickname">
                  <input
                    type="text"
                    autoComplete="nickname"
                    maxLength={32}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="optional · falls back to email prefix"
                    className="w-full bg-transparent text-[13px] focus:outline-none"
                    style={{ color: "rgba(255,255,255,0.92)" }}
                  />
                </FieldRow>
              )}
            </SharedFieldGroup>

            {err && (
              <div
                className="mt-3 rounded-[8px] px-3 py-2 text-[12px] leading-relaxed"
                style={{
                  background: "rgba(255,92,92,0.08)",
                  border: "1px solid rgba(255,92,92,0.24)",
                  color: "#FF8A8A",
                }}
              >
                {err}
              </div>
            )}

            {/* 电黄 CTA */}
            <button
              type="submit"
              disabled={busy}
              className="relative mt-4 w-full overflow-hidden rounded-full py-3 text-[14px] font-semibold transition-all hover:brightness-105 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
              style={{
                background: "#F0FE2D",
                color: "#0D0D0D",
                boxShadow: "0 0 24px rgba(240, 254, 45, 0.35)",
                letterSpacing: "0.01em",
              }}
            >
              {busy ? "处理中…" : tab === "login" ? "Sign in  →" : "Sign up  →"}
            </button>

            {/* "── or continue with ──" 分割 */}
            <div
              className="my-4 flex items-center gap-3 text-[10.5px]"
              style={{ color: "rgba(255,255,255,0.32)", letterSpacing: "0.04em" }}
            >
              <span className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
              or continue with
              <span className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
            </div>

            {/* 三个第三方胶囊按钮（带文字） */}
            <div className="flex items-center gap-2">
              <SocialPill label="Google"><GoogleIcon /></SocialPill>
              <SocialPill label="GitHub"><GitHubIcon /></SocialPill>
              <SocialPill label="SSO"><SsoIcon /></SocialPill>
            </div>

            {/* 底部切换：No account? Sign up → / Have an account? Sign in → */}
            <div
              className="mt-5 text-center text-[12px]"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              {tab === "login" ? (
                <>
                  No account?{" "}
                  <button
                    type="button"
                    onClick={() => switchTab("register")}
                    className="font-medium transition-opacity hover:opacity-80"
                    style={{ color: LINK }}
                  >
                    Sign up →
                  </button>
                </>
              ) : (
                <>
                  Have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchTab("login")}
                    className="font-medium transition-opacity hover:opacity-80"
                    style={{ color: LINK }}
                  >
                    Sign in →
                  </button>
                </>
              )}
            </div>
          </form>
        </div>

        {/* 卡下方协作者三色点（黄/蓝/粉，呼应 DESIGN.md 三 accent / 三协作者） */}
        <div className="mt-4 flex items-center justify-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: PORT.model, boxShadow: `0 0 6px ${PORT.model}` }}
          />
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: PORT.image, boxShadow: `0 0 6px ${PORT.image}` }}
          />
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: PORT.output, boxShadow: `0 0 6px ${PORT.output}` }}
          />
        </div>

        {/* 底部协议小字 */}
        <p
          className="mt-3 text-center text-[10px] leading-relaxed"
          style={{ color: "rgba(255,255,255,0.32)", letterSpacing: "0.02em" }}
        >
          继续即代表你同意
          <a className="mx-1 transition-colors hover:text-white/60" style={{ color: "rgba(255,255,255,0.55)" }} href="#">
            用户协议
          </a>
          与
          <a className="mx-1 transition-colors hover:text-white/60" style={{ color: "rgba(255,255,255,0.55)" }} href="#">
            隐私政策
          </a>
        </p>
      </div>

      {/* 6. 右下 telemetry-block */}
      <div
        className="absolute bottom-10 right-10 z-10 hidden flex-col items-end gap-0.5 tabular-nums lg:flex"
        style={{
          color: "rgba(255,255,255,0.40)",
          fontSize: 11,
          letterSpacing: "0.02em",
          fontFeatureSettings: '"tnum" on',
        }}
      >
        <span>T: {elapsed.toFixed(2)}s</span>
        <span>I: 0</span>
        <span>N: 1 (auth)</span>
        <span>S: {(elapsed * 17).toFixed(2)}</span>
      </div>

      {/* 7. 底部居中 fine-print */}
      <div
        className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 text-[10px]"
        style={{ color: "rgba(255,255,255,0.32)", letterSpacing: "0.04em" }}
      >
        © 2026 image2 · collaborative ai canvas
      </div>
    </div>
  );
}

/* ============== 中心卡子组件 ============== */

function TabPill(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex-1 rounded-full py-1.5 text-[12px] font-medium transition-all active:scale-[0.98]"
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

/** Email + Password 共享的深色卡片容器（设计稿原样：单个 card + 内部细线分隔） */
function SharedFieldGroup({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        background: "rgba(0,0,0,0.32)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* 用相邻兄弟选择器加细线分隔，由 children 自然顺序产生 */}
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
    <div className="auth-shared-row px-3.5 py-2.5">
      <div className="flex items-center justify-between">
        <label
          className="text-[10.5px] uppercase"
          style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em" }}
        >
          {props.label}
        </label>
        {props.right}
      </div>
      <div className="mt-1">{props.children}</div>
    </div>
  );
}

function SocialPill(props: { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[12px] font-medium transition-all hover:-translate-y-0.5 active:scale-[0.98]"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.78)",
      }}
    >
      {props.children}
      <span>{props.label}</span>
    </button>
  );
}

/* ============== 装饰节点 ============== */

type DecoNodeProps = {
  className?: string;
  style?: CSSProperties;
  title: string;
  subtitle: string;
  meta?: string;
  port?: { side: "left" | "right"; color: string; top: number };
};

function DecoNode(props: DecoNodeProps) {
  return (
    <div
      className={`absolute z-[1] w-[200px] rounded-[14px] ${props.className ?? ""}`}
      style={{
        ...props.style,
        background: "rgba(28,28,32,0.50)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px) saturate(140%)",
        WebkitBackdropFilter: "blur(12px) saturate(140%)",
        opacity: 0.85,
        fontFamily: FONT,
      }}
    >
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{
            border: "1.5px solid rgba(255,255,255,0.85)",
            background: "transparent",
          }}
        />
        <span className="text-[12px] font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>
          {props.title}
        </span>
        {props.meta && (
          <span
            className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] tabular-nums"
            style={{
              background: PORT.model,
              color: "#0D0D0D",
              fontWeight: 600,
            }}
          >
            {props.meta}
          </span>
        )}
      </div>
      <div className="mx-3 mb-3 rounded-[10px] px-2.5 py-2"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)", letterSpacing: "0.02em" }}>
          {props.subtitle}
        </div>
      </div>

      {props.port && (
        <span
          className="absolute h-2.5 w-2.5 rounded-full"
          style={{
            top: props.port.top,
            [props.port.side]: -5,
            background: props.port.color,
            border: "2px solid #0D0D0D",
            boxShadow: `0 0 6px ${props.port.color}`,
          }}
        />
      )}
    </div>
  );
}

function DecoOutputNode(props: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`absolute z-[1] w-[220px] rounded-[14px] ${props.className ?? ""}`}
      style={{
        ...props.style,
        background: "rgba(28,28,32,0.50)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px) saturate(140%)",
        WebkitBackdropFilter: "blur(12px) saturate(140%)",
        opacity: 0.85,
        fontFamily: FONT,
      }}
    >
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ border: "1.5px solid rgba(255,255,255,0.85)" }}
        />
        <span className="text-[12px] font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>
          Output
        </span>
        <span
          className="ml-auto text-[10px] tabular-nums"
          style={{ color: "rgba(255,255,255,0.32)" }}
        >
          1024×1024
        </span>
      </div>
      <div className="mx-3 mb-2 overflow-hidden rounded-[10px]"
        style={{ border: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div
          className="h-[120px] w-full"
          style={{
            background:
              "conic-gradient(from 200deg at 40% 60%, #FF50C8 0deg, #8C64FF 110deg, #50B4FF 220deg, #F0FE2D 320deg, #FF50C8 360deg)",
            filter: "blur(0.5px)",
          }}
        />
      </div>
      <div
        className="px-3.5 pb-3 text-[10px]"
        style={{ color: "rgba(255,255,255,0.40)", letterSpacing: "0.02em" }}
      >
        preview · 1024×1024
      </div>

      <span
        className="absolute h-2.5 w-2.5 rounded-full"
        style={{
          top: 56,
          left: -5,
          background: PORT.output,
          border: "2px solid #0D0D0D",
          boxShadow: `0 0 6px ${PORT.output}`,
        }}
      />
    </div>
  );
}

/* ============== 装饰连线 ============== */

function DecoWires() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 hidden lg:block"
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      style={{ zIndex: 1 }}
    >
      <defs>
        <linearGradient id="wireGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(255,255,255,0)" />
          <stop offset="0.5" stopColor="rgba(255,255,255,0.32)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      {/* Model → 中央卡 左边 */}
      <path
        d="M 264 152 C 360 140 460 200 540 360"
        stroke="url(#wireGrad)"
        strokeWidth="1"
        fill="none"
        strokeDasharray="3 6"
        opacity="0.7"
      />
      {/* PostFire → 中央卡 左下 */}
      <path
        d="M 296 720 C 400 680 480 600 540 540"
        stroke="url(#wireGrad)"
        strokeWidth="1"
        fill="none"
        strokeDasharray="3 6"
        opacity="0.55"
      />
      {/* 中央卡 → Output */}
      <path
        d="M 940 440 C 1080 400 1180 280 1240 200"
        stroke="url(#wireGrad)"
        strokeWidth="1"
        fill="none"
        strokeDasharray="3 6"
        opacity="0.7"
      />
    </svg>
  );
}

/* ============== 品牌 mark ============== */

function BrandMark() {
  return (
    <span
      className="grid h-8 w-8 place-items-center rounded-[10px]"
      style={{
        background: "rgba(28,28,32,0.6)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px) saturate(140%)",
        WebkitBackdropFilter: "blur(12px) saturate(140%)",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="8" height="8" rx="2" stroke={PORT.model} strokeWidth="1.6" />
        <rect x="13" y="13" width="8" height="8" rx="2" stroke={PORT.image} strokeWidth="1.6" />
        <path d="M11 7 H 17 V 13" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" fill="none" />
      </svg>
    </span>
  );
}

/* ============== 图标 ============== */

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

function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 11v3.2h5.3c-.2 1.3-1.6 3.8-5.3 3.8-3.2 0-5.8-2.6-5.8-5.9S8.8 6.2 12 6.2c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.7 3.7 14.6 2.8 12 2.8 6.9 2.8 2.8 6.9 2.8 12s4.1 9.2 9.2 9.2c5.3 0 8.8-3.7 8.8-9 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.55-1.13-4.55-5.05 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.27 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.04.36.32.68.94.68 1.89 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49 3.97-1.36 6.84-5.2 6.84-9.73C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

function SsoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9" />
      <path d="M17 12v3" />
      <path d="M20 12v2" />
    </svg>
  );
}
