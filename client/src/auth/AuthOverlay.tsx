// 全屏登录/注册页 —— hero 风格还原设计稿
// 注意：此页面经用户确认破例使用多色渐变（非全局 DESIGN.md 灰阶铁律）。
import { useState, type FormEvent, type ReactNode } from "react";
import { AuthApiError } from "../api/auth";
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
  account_disabled: "账号已停用，请联系管理员",
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

export function AuthOverlay() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col items-center overflow-y-auto px-6 py-8"
      style={{
        // 黑底 + 顶部粉紫光晕 + 右下电黄光晕 + 微点阵
        background:
          "radial-gradient(900px 520px at 50% -10%, rgba(168,40,140,0.34), transparent 70%)," +
          "radial-gradient(700px 480px at 95% 95%, rgba(247,200,11,0.18), transparent 70%)," +
          "radial-gradient(circle at center, rgba(20,20,24,1) 0%, rgba(6,6,8,1) 70%)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.045) 1px, transparent 0)," +
          "radial-gradient(900px 520px at 50% -10%, rgba(168,40,140,0.34), transparent 70%)," +
          "radial-gradient(700px 480px at 95% 95%, rgba(247,200,11,0.18), transparent 70%)," +
          "linear-gradient(180deg, #0a0a0d 0%, #050507 100%)",
        backgroundSize: "22px 22px, auto, auto, auto",
      }}
    >
      {/* 顶部 logo */}
      <div className="w-full max-w-[1480px] shrink-0 px-2 pb-6 pt-2">
        <div className="flex items-center gap-3">
          <span
            className="block h-9 w-9 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 35% 35%, #ffe28a 0%, #f7c80b 35%, #c0357a 70%, #5a1750 100%)",
              boxShadow: "0 0 28px rgba(247,200,11,0.45), 0 0 18px rgba(192,53,122,0.4)",
            }}
          />
          <div className="leading-tight">
            <div className="text-[16px] font-semibold text-white">图像生成</div>
            <div className="text-[11px] text-white/45">借助 AI 创作画面</div>
          </div>
        </div>
      </div>

      {/* 中间大玻璃卡 */}
      <div
        className="relative w-full max-w-[1480px] shrink-0 overflow-hidden rounded-[28px] border border-white/[0.08]"
        style={{
          background: "linear-gradient(180deg, rgba(22,22,28,0.85) 0%, rgba(14,14,18,0.85) 100%)",
          boxShadow:
            "0 60px 120px -40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(255,255,255,0.03)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
          {/* 左：hero */}
          <HeroSide />

          {/* 右：表单 */}
          <div className="flex flex-col px-10 py-12 lg:px-16 lg:py-14">
            {/* tab 切换 */}
            <div className="mx-auto flex w-full max-w-[420px] rounded-full border border-white/[0.06] bg-black/30 p-1">
              <TabPill active={tab === "login"} onClick={() => switchTab("login")}>
                登录
              </TabPill>
              <TabPill active={tab === "register"} onClick={() => switchTab("register")}>
                注册
              </TabPill>
            </div>

            <form onSubmit={onSubmit} autoComplete="on" className="mx-auto mt-10 w-full max-w-[420px]">
              <Field label="邮箱 / 用户名">
                <InputWithIcon icon={<UserIcon />}>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="请输入邮箱或用户名"
                    className="w-full bg-transparent text-[14px] text-white/90 placeholder:text-white/30 focus:outline-none"
                  />
                </InputWithIcon>
              </Field>

              {tab === "register" && (
                <Field label="昵称（可选）">
                  <InputWithIcon icon={<UserIcon />}>
                    <input
                      type="text"
                      autoComplete="nickname"
                      maxLength={32}
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder="不填则取邮箱前缀"
                      className="w-full bg-transparent text-[14px] text-white/90 placeholder:text-white/30 focus:outline-none"
                    />
                  </InputWithIcon>
                </Field>
              )}

              <Field label="密码">
                <InputWithIcon
                  icon={<LockIcon />}
                  suffix={
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="text-white/40 hover:text-white/70"
                      aria-label={showPwd ? "隐藏密码" : "显示密码"}
                    >
                      {showPwd ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                  }
                >
                  <input
                    type={showPwd ? "text" : "password"}
                    required
                    minLength={8}
                    maxLength={72}
                    autoComplete={tab === "login" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={tab === "register" ? "8–72 位，含字母与数字" : "请输入密码"}
                    className="w-full bg-transparent text-[14px] text-white/90 placeholder:text-white/30 focus:outline-none"
                  />
                </InputWithIcon>
              </Field>

              <div className="mt-4 flex items-center justify-between text-[12px]">
                <label className="flex cursor-pointer items-center gap-2 text-white/65 select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#f7c80b]"
                  />
                  记住我
                </label>
                <button
                  type="button"
                  className="font-medium text-[#f7c80b] hover:underline"
                >
                  忘记密码？
                </button>
              </div>

              {err && (
                <div className="mt-4 text-[13px] leading-relaxed text-[#ff6b6b]">{err}</div>
              )}

              {/* 登录按钮 —— 黄→粉→紫渐变胶囊 */}
              <button
                type="submit"
                disabled={busy}
                className="relative mt-6 w-full overflow-hidden rounded-full py-3.5 text-[15px] font-semibold text-white transition-all hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
                style={{
                  letterSpacing: 4,
                  background:
                    "linear-gradient(90deg, #ffe066 0%, #f5b942 22%, #ec4899 65%, #a855f7 100%)",
                  boxShadow:
                    "0 18px 40px -10px rgba(236,72,153,0.55), 0 8px 20px -6px rgba(168,85,247,0.45), inset 0 1px 0 rgba(255,255,255,0.35)",
                }}
              >
                {busy ? "处理中…" : tab === "login" ? "登 录" : "注 册"}
              </button>

              {/* 第三方登录区（纯展示） */}
              <div className="mt-7 flex items-center justify-center text-[12px] text-white/45">
                或使用以下方式登录
              </div>
              <div className="mt-4 flex items-center justify-center gap-4">
                <SocialBtn label="Google"><GoogleIcon /></SocialBtn>
                <SocialBtn label="Discord"><DiscordIcon /></SocialBtn>
                <SocialBtn label="Apple"><AppleIcon /></SocialBtn>
                <SocialBtn label="WeChat"><WeChatIcon /></SocialBtn>
              </div>

              <p className="mt-7 text-center text-[11px] leading-relaxed text-white/45">
                未注册的邮箱将自动创建账号，登录即代表你同意
                <br />
                <a className="font-medium text-[#f7c80b] hover:underline" href="#">《用户协议》</a>
                <span className="mx-1">和</span>
                <a className="font-medium text-[#f7c80b] hover:underline" href="#">《隐私政策》</a>
              </p>
            </form>
          </div>
        </div>
      </div>

      {/* 页脚 */}
      <div className="mt-8 shrink-0 pb-2 text-center text-[12px] text-white/35">
        © 2024 图像生成平台 · 借助 AI 创造无限可能
      </div>
    </div>
  );
}

/* ---------------- 子组件 ---------------- */

// 左侧 hero 的 5 张 unsplash 占位图
const HERO_IMAGES = [
  { url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=520&q=70", glow: "rgba(247,200,11,0.55)" },
  { url: "https://images.unsplash.com/photo-1567016526105-22da7c13161a?w=520&q=70", glow: "rgba(255,255,255,0.40)" },
  { url: "https://images.unsplash.com/photo-1505144808419-1957a94ca61e?w=520&q=70", glow: "rgba(82,138,255,0.55)" },
  { url: "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=520&q=70", glow: "rgba(236,72,153,0.55)" },
  { url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=520&q=70", glow: "rgba(244,114,182,0.40)" },
];

function HeroSide() {
  return (
    <div className="relative flex flex-col justify-between overflow-hidden px-10 py-12 lg:px-16 lg:py-14">
      <div>
        <h1 className="text-[36px] font-bold leading-tight text-white">
          AI 创作，
          <span style={{ color: "#f7c80b", textShadow: "0 0 24px rgba(247,200,11,0.45)" }}>
            想象成真
          </span>
        </h1>
        <p className="mt-3 text-[14px] text-white/55">输入灵感，AI 为你生成无限可能的艺术作品</p>
      </div>

      {/* 中间倾斜图片堆 —— 渐缩 + rotateY 形成纵深扇形 */}
      <div
        className="relative my-6 flex h-[320px] items-center justify-center"
        style={{ perspective: "1100px", perspectiveOrigin: "50% 50%" }}
      >
        <div className="pointer-events-none absolute" style={{ left: "6%", top: "44%", color: "#fff", textShadow: "0 0 12px rgba(255,255,255,0.95)", fontSize: 16 }}>✦</div>
        <div className="pointer-events-none absolute" style={{ right: "8%", top: "32%", color: "rgba(255,255,255,0.65)", fontSize: 11 }}>✦</div>
        <div className="pointer-events-none absolute" style={{ left: "18%", bottom: "12%", color: "rgba(255,255,255,0.55)", fontSize: 9 }}>✦</div>

        <div className="relative h-full w-full" style={{ transformStyle: "preserve-3d" }}>
          {HERO_IMAGES.map((img, i) => {
            const baseW = 156;
            const baseH = 280;
            const scale = Math.pow(0.86, i);
            const w = baseW * scale;
            const h = baseH * scale;
            const rotate = -10 - i * 6;
            let xOffset = -160;
            for (let k = 0; k < i; k++) xOffset += 60 + k * -4;
            const yOffset = i * 4;
            return (
              <div
                key={i}
                className="absolute left-1/2 top-1/2 overflow-hidden rounded-[18px] border border-white/15 transition-transform duration-300"
                style={{
                  width: `${w}px`,
                  height: `${h}px`,
                  transform: `translate3d(calc(-50% + ${xOffset}px), calc(-50% + ${yOffset}px), 0) rotateY(${rotate}deg)`,
                  transformOrigin: "50% 50%",
                  boxShadow: `0 0 0 1.5px ${img.glow}, 0 22px 48px -8px ${img.glow}, 0 16px 32px rgba(0,0,0,0.7)`,
                  zIndex: 20 - i,
                }}
              >
                <img src={img.url} alt="" className="h-full w-full object-cover" draggable={false} loading="lazy" />
              </div>
            );
          })}
        </div>

        <svg
          className="pointer-events-none absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2"
          width="620" height="200" viewBox="0 0 620 200" fill="none" style={{ zIndex: 40 }}
        >
          <ellipse cx="310" cy="100" rx="280" ry="46" stroke="url(#orbit)" strokeWidth="1.2" strokeDasharray="2 5" opacity="0.7" />
          <defs>
            <linearGradient id="orbit" x1="0" y1="0" x2="620" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="rgba(247,200,11,0)" />
              <stop offset="0.5" stopColor="rgba(255,255,255,0.85)" />
              <stop offset="1" stopColor="rgba(236,72,153,0)" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* 底部三特性 */}
      <div className="flex items-start gap-10">
        <Feature icon={<SparkleIcon />} title="智能生成" desc="精准理解你的描述" />
        <Feature icon={<SlidersIcon />} title="多样风格" desc="多种风格任你选择" />
        <Feature icon={<BoltIcon />} title="高效创作" desc="瞬间生成高质量作品" />
      </div>
    </div>
  );
}

function Feature(props: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="grid h-9 w-9 place-items-center rounded-[10px]"
        style={{
          background: "linear-gradient(180deg, #ffe066 0%, #f5b942 100%)",
          color: "#1a1a1f",
          boxShadow: "0 8px 18px -6px rgba(247,200,11,0.55), inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        {props.icon}
      </div>
      <div className="mt-1 text-[13px] font-semibold text-white">{props.title}</div>
      <div className="text-[11px] text-white/50">{props.desc}</div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2z" />
      <path d="M19 14l.8 2.4L22 17l-2.2.6L19 20l-.8-2.4L16 17l2.2-.6L19 14z" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M4 7h10M18 7h2" />
      <circle cx="16" cy="7" r="2" fill="currentColor" />
      <path d="M4 17h4M12 17h8" />
      <circle cx="10" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

function TabPill(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex-1 rounded-full py-2 text-[14px] font-medium transition-all"
      style={
        props.active
          ? {
              background:
                "linear-gradient(180deg, rgba(247,200,11,0.18) 0%, rgba(247,200,11,0.08) 100%)",
              color: "#f7c80b",
              boxShadow: "inset 0 0 0 1px rgba(247,200,11,0.45), 0 0 18px rgba(247,200,11,0.18)",
            }
          : { color: "rgba(255,255,255,0.55)" }
      }
    >
      {props.children}
    </button>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <label className="mb-2 block text-[13px] font-medium text-white/80">{props.label}</label>
      {props.children}
    </div>
  );
}

function InputWithIcon(props: { icon: ReactNode; suffix?: ReactNode; children: ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 rounded-[14px] border border-white/[0.06] bg-black/30 px-4 py-3 transition-colors focus-within:border-[#f7c80b]/45 focus-within:ring-2 focus-within:ring-[#f7c80b]/15"
    >
      <span className="text-white/40">{props.icon}</span>
      <div className="min-w-0 flex-1">{props.children}</div>
      {props.suffix && <span>{props.suffix}</span>}
    </div>
  );
}

function SocialBtn(props: { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/80 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08]"
    >
      {props.children}
    </button>
  );
}

/* ---------------- 图标 ---------------- */

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6.5 0 10 6 10 6a17.6 17.6 0 0 1-3.3 4M6.1 6.1C3.6 7.7 2 12 2 12s3.5 7 10 7c2 0 3.7-.6 5.1-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#EA4335" d="M12 11v3.2h5.3c-.2 1.3-1.6 3.8-5.3 3.8-3.2 0-5.8-2.6-5.8-5.9S8.8 6.2 12 6.2c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.7 3.7 14.6 2.8 12 2.8 6.9 2.8 2.8 6.9 2.8 12s4.1 9.2 9.2 9.2c5.3 0 8.8-3.7 8.8-9 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#5865F2">
      <path d="M20.3 4.4A18.5 18.5 0 0 0 15.7 3l-.2.4a14 14 0 0 0-6.9 0L8.3 3a18.5 18.5 0 0 0-4.6 1.4C1 8.9.3 13.3.7 17.6a18.7 18.7 0 0 0 5.6 2.8l1.1-1.7a12 12 0 0 1-1.8-.9l.4-.3a13 13 0 0 0 12 0l.5.3a12 12 0 0 1-1.8.9l1.1 1.7a18.7 18.7 0 0 0 5.6-2.8c.4-5-.7-9.3-3.2-13.2zM8.7 15.1c-1.1 0-2-1-2-2.3 0-1.2.9-2.3 2-2.3 1.2 0 2.1 1 2 2.3 0 1.3-.8 2.3-2 2.3zm6.6 0c-1.1 0-2-1-2-2.3 0-1.2.9-2.3 2-2.3s2.1 1 2 2.3c0 1.3-.9 2.3-2 2.3z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="20" viewBox="0 0 24 24" fill="#fff">
      <path d="M16.4 12.7c0-2.9 2.4-4.3 2.5-4.4-1.4-2-3.5-2.3-4.3-2.3-1.8-.2-3.6 1.1-4.5 1.1-.9 0-2.4-1.1-4-1-2 0-3.9 1.2-5 3-2.1 3.7-.5 9.1 1.5 12.1 1 1.4 2.2 3 3.8 3 1.5-.1 2.1-1 3.9-1 1.8 0 2.4 1 4 1 1.6 0 2.7-1.4 3.7-2.9 1.2-1.7 1.6-3.3 1.7-3.4-.1 0-3.3-1.3-3.3-5zM13.7 4.2c.8-1 1.4-2.4 1.2-3.8-1.2 0-2.6.8-3.4 1.8-.7.9-1.4 2.3-1.2 3.6 1.3.1 2.6-.7 3.4-1.6z" />
    </svg>
  );
}

function WeChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#07C160">
      <path d="M8.7 3C4.6 3 1.4 5.7 1.4 9c0 1.9 1.1 3.6 2.8 4.7-.2.5-.6 1.7-.6 1.9 0 .2.1.4.4.4.1 0 .3-.1.4-.1l2-1.2c.7.2 1.5.3 2.3.3.2 0 .4 0 .6-.1A6 6 0 0 1 9 13c0-3.3 3.2-5.9 7.1-5.9.4 0 .8 0 1.2.1C16.4 4.5 12.9 3 8.7 3zm-2.6 3a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm5.3 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm5 2.6c-3.5 0-6.3 2.3-6.3 5.1 0 2.9 2.8 5.2 6.3 5.2.7 0 1.4-.1 2-.3l1.7 1c.1 0 .2.1.3.1.2 0 .3-.1.3-.3 0-.1-.3-1.1-.4-1.5 1.3-.9 2.2-2.3 2.2-4 0-2.9-2.8-5.3-6.1-5.3zm-2 2.1a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zm4.3 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z" />
    </svg>
  );
}
