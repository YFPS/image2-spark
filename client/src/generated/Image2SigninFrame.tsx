type IconName =
  | "arrow-right"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "ellipsis"
  | "eye-off"
  | "github"
  | "key"
  | "orbit"
  | "play"
  | "settings";

type NodeCardProps = {
  title: string;
  className: string;
  portColor: string;
  children: React.ReactNode;
  portSide?: "left" | "right";
};

const colors = {
  canvas: "#0D0D0D",
  glass: "#1c1c2099",
  panel: "#1e1e22",
  field: "#27272a",
  blue: "#4CB1FF",
  yellow: "#F0FE2D",
  green: "#7CE38B",
  pink: "#FF7E87",
};

const stars = [
  ["left-[40px]", "top-[80px]", "h-0.5", "w-0.5", "opacity-30"],
  ["left-[180px]", "top-[50px]", "h-0.5", "w-0.5", "opacity-20"],
  ["left-[380px]", "top-[90px]", "h-[3px]", "w-[3px]", "opacity-35"],
  ["left-[1080px]", "top-[60px]", "h-0.5", "w-0.5", "opacity-25"],
  ["left-[1280px]", "top-[100px]", "h-[3px]", "w-[3px]", "opacity-35"],
  ["left-[1380px]", "top-[40px]", "h-0.5", "w-0.5", "opacity-20"],
  ["left-[60px]", "top-[820px]", "h-0.5", "w-0.5", "opacity-20"],
  ["left-[220px]", "top-[860px]", "h-[3px]", "w-[3px]", "opacity-30"],
  ["left-[1180px]", "top-[860px]", "h-[3px]", "w-[3px]", "opacity-35"],
  ["left-[1380px]", "top-[800px]", "h-0.5", "w-0.5", "opacity-25"],
];

export default function Image2SigninFrame() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-[#0D0D0D] font-sans text-white">
      <BackgroundScene />
      <TopBar />
      <main className="relative z-20 flex min-h-screen items-center justify-center px-4 py-24 sm:px-6 lg:py-0">
        <LoginPanel />
      </main>
      <Footer />
    </section>
  );
}

function BackgroundScene() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#0D0D0D]" />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(255,255,255,0.06) 1px, transparent 1.4px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="absolute -left-[150px] -top-[200px] h-[600px] w-[600px] rounded-full bg-[#FF50C8] opacity-[0.22] blur-[120px]" />
      <div className="absolute left-[68%] top-[60%] h-[620px] w-[620px] rounded-full bg-[#50B4FF] opacity-20 blur-[120px]" />
      <div className="absolute left-[39%] top-[53%] h-[460px] w-[460px] rounded-full bg-[#8C64FF] opacity-15 blur-[120px]" />

      <div className="hidden lg:block">
        <WorkflowNodes />
        {stars.map((star) => (
          <span
            key={star.join("-")}
            className={`absolute rounded-full bg-white ${star.join(" ")}`}
          />
        ))}
      </div>
    </div>
  );
}

function TopBar() {
  return (
    <header className="pointer-events-none absolute left-0 right-0 top-0 z-30 hidden h-[64px] px-6 pt-3 text-[13px] text-white/70 lg:block">
      <div className="relative flex h-9 items-center justify-between">
        <div className="pointer-events-auto flex items-center gap-3">
          <div className="relative grid h-7 w-7 place-items-center rounded-full border border-white/80">
            <Icon name="orbit" className="h-4 w-4 text-white/80" />
          </div>
          <TopPill active>Workflow</TopPill>
          <TopPill>Edit</TopPill>
          <TopPill>Help</TopPill>
        </div>

        <div className="pointer-events-auto absolute left-1/2 top-0 flex h-9 -translate-x-1/2 items-center justify-center gap-1">
          <IconButton label="Previous">
            <Icon name="chevron-left" className="h-3.5 w-3.5" />
          </IconButton>
          <button
            type="button"
            className="h-7 w-[120px] rounded-full bg-white/[0.04] text-white/90"
          >
            image2 &times;
          </button>
          <IconButton label="Next">
            <Icon name="chevron-right" className="h-3.5 w-3.5" />
          </IconButton>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <IconButton label="More">
            <Icon name="ellipsis" className="h-[18px] w-[18px]" />
          </IconButton>
          <IconButton label="Run">
            <Icon name="play" className="h-[18px] w-[18px]" />
          </IconButton>
          <IconButton label="Settings">
            <Icon name="settings" className="h-[18px] w-[18px]" />
          </IconButton>
          <button
            type="button"
            className="h-9 rounded-full bg-white px-4 text-[13px] font-medium text-[#0D0D0D]"
          >
            Sign up
          </button>
        </div>
      </div>
    </header>
  );
}

function TopPill({
  active = false,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rounded-full px-3.5 py-2 font-medium ${
        active ? "bg-white/[0.08] text-white/90" : "bg-white/[0.03] text-white/60"
      }`}
    >
      {children}
    </button>
  );
}

function WorkflowNodes() {
  return (
    <>
      <svg
        className="absolute left-[21.2%] top-[8.9%] h-[54%] w-[56%] overflow-visible"
        viewBox="0 0 800 485"
        fill="none"
      >
        <path d="M0 70 C230 5 415 -25 800 130" stroke="rgba(255,255,255,0.18)" strokeWidth="1.25" />
        <path d="M40 455 C270 315 525 365 760 35" stroke="rgba(255,255,255,0.18)" strokeWidth="1.25" />
      </svg>

      <NodeCard
        title="Model"
        className="left-[6.25%] top-[15.5%] h-[130px] w-[220px]"
        portColor={colors.yellow}
      >
        <div className="mt-2 flex h-9 items-center justify-between rounded-[8px] border border-white/[0.08] bg-[#27272a] px-3 text-[12px] text-white/65">
          <span>sd-3.5-large</span>
          <Icon name="chevron-down" className="h-3.5 w-3.5 text-white/50" />
        </div>
      </NodeCard>

      <NodeCard
        title="Positive"
        className="left-[9%] top-[60%] h-[120px] w-[220px]"
        portColor={colors.green}
      >
        <p className="mt-2 h-[54px] rounded-[8px] border border-white/[0.08] bg-[#27272a] p-2.5 text-[11px] leading-snug text-white/60">
          a serene mountain lake at golden hour, hyper-detailed
        </p>
      </NodeCard>

      <NodeCard
        title="Output"
        className="right-[7.6%] top-[22.2%] h-[200px] w-[230px]"
        portColor={colors.pink}
        portSide="left"
      >
        <div className="mt-2 h-[120px] overflow-hidden rounded-[8px] border border-white/[0.08]">
          <GeneratedPreview />
        </div>
        <span className="mt-2 inline-flex rounded-full bg-[#27272a] px-2 py-1 text-[11px] text-white/60">
          preview - 1024x1024
        </span>
      </NodeCard>

      <Collaborator
        name="Paul"
        color={colors.yellow}
        className="left-[23.6%] top-[57.8%]"
      />
      <Collaborator
        name="Mario"
        color={colors.pink}
        className="right-[3.6%] top-[20%]"
      />
    </>
  );
}

function NodeCard({ title, className, portColor, portSide = "right", children }: NodeCardProps) {
  return (
    <section
      className={`absolute rounded-[14px] border border-white/[0.08] bg-[#1c1c2099] p-1.5 ${className}`}
    >
      <div className="relative flex h-full flex-col rounded-[10px] border border-white/[0.04] bg-[#1e1e22] p-3.5">
        <div className="flex items-center gap-2 text-[14px] font-medium text-white/90">
          <span className="h-3 w-3 rounded-full border border-white/80" />
          {title}
        </div>
        {children}
      </div>
      <span
        className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-[#0D0D0D] ${
          portSide === "right" ? "-right-1.5" : "-left-1.5"
        }`}
        style={{ backgroundColor: portColor, boxShadow: `0 0 6px ${portColor}` }}
      />
    </section>
  );
}

function Collaborator({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className: string;
}) {
  return (
    <div className={`absolute flex items-start gap-0.5 ${className}`}>
      <span
        className="mt-0.5 h-0 w-0 border-y-[6px] border-r-[10px] border-y-transparent"
        style={{ borderRightColor: color }}
      />
      <span
        className="rounded-full px-2 py-0.5 text-[11px] font-medium text-[#0D0D0D]"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </div>
  );
}

function LoginPanel() {
  return (
    <div className="w-full max-w-[420px]">
      <section className="rounded-[32px] border border-white/[0.08] bg-[#1c1c2099] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-[18px]">
        <div className="mb-3 flex items-center gap-2.5 px-1 pb-0.5">
          <span className="h-3 w-3 rounded-full border-[1.5px] border-white/85" />
          <h1 className="text-[14px] font-medium text-white/90">Sign in to image2</h1>
          <span className="text-[10px] text-white/40">v0.2</span>
        </div>
        <p className="mb-3 text-[13px] text-white/60">
          Collaborative AI canvas - free for teams.
        </p>

        <div className="rounded-[32px] border border-white/[0.04] bg-[#1e1e22] p-[18px]">
          <div className="space-y-3.5">
            <Field label="Email" value="paul@image2.dev" />
            <Field label="Password" value="**********" rightLabel="Forgot?" icon="eye-off" />
          </div>
        </div>

        <button
          type="button"
          className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#F0FE2D] text-[13px] font-medium text-[#0D0D0D] shadow-[0_0_24px_rgba(240,254,45,0.35)]"
        >
          Sign in
          <Icon name="arrow-right" className="h-[13px] w-[13px]" />
        </button>

        <div className="my-3.5 flex items-center gap-3 px-1">
          <span className="h-px flex-1 bg-white/[0.08]" />
          <span className="text-[11px] text-white/40">or continue with</span>
          <span className="h-px flex-1 bg-white/[0.08]" />
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3">
          <SocialButton label="Google" mark="G" />
          <SocialButton label="GitHub" icon="github" />
          <SocialButton label="SSO" icon="key" />
        </div>

        <div className="mt-3.5 flex justify-center gap-1 pt-1 text-[12px]">
          <span className="text-white/40">No account?</span>
          <a className="font-medium text-[#4CB1FF]" href="#signup">
            Sign up -&gt;
          </a>
        </div>
      </section>

      <div className="flex items-center justify-center gap-2 pt-5 text-[11px] tracking-[0.02em] text-white/40">
        <span className="flex -space-x-1">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-[#0D0D0D] bg-[#F0FE2D]" />
          <span className="h-3.5 w-3.5 rounded-full border-2 border-[#0D0D0D] bg-[#4CB1FF]" />
          <span className="h-3.5 w-3.5 rounded-full border-2 border-[#0D0D0D] bg-[#FF7E87]" />
        </span>
        3 teammates online now
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  rightLabel,
  icon,
}: {
  label: string;
  value: string;
  rightLabel?: string;
  icon?: IconName;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[11px] text-white/40">
        <span>{label}</span>
        {rightLabel && <span className="text-[#4CB1FF]">{rightLabel}</span>}
      </span>
      <span className="flex h-9 items-center justify-between rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] text-white/90">
        <span className={label === "Password" ? "tracking-[0.2em]" : ""}>{value}</span>
        {icon && <Icon name={icon} className="h-3.5 w-3.5 text-white/40" />}
      </span>
    </label>
  );
}

function SocialButton({
  label,
  mark,
  icon,
}: {
  label: string;
  mark?: string;
  icon?: IconName;
}) {
  return (
    <button
      type="button"
      className="flex h-10 items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] text-[13px] font-medium text-white/90"
    >
      {mark && <span className="text-[14px] font-semibold">{mark}</span>}
      {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function GeneratedPreview() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#111116]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,#49f2ff_0_12%,transparent_28%),radial-gradient(circle_at_72%_25%,#ff50c8_0_14%,transparent_30%),radial-gradient(circle_at_60%_72%,#8c64ff_0_16%,transparent_34%),linear-gradient(135deg,#42e8ff,#f45cc8_45%,#2836ff)]" />
      <div className="absolute inset-0 opacity-70 mix-blend-screen [background:repeating-linear-gradient(135deg,transparent_0_12px,rgba(255,255,255,0.18)_13px_15px,transparent_16px_28px)]" />
    </div>
  );
}

function Footer() {
  return (
    <footer className="pointer-events-none absolute bottom-7 left-0 right-0 z-10 hidden text-center text-[10px] tracking-[0.02em] text-white/40 lg:block">
      &copy; 2024 image2 &middot; v0.2.1 &middot; Made for nodes, not forms.
    </footer>
  );
}

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/[0.04] text-white/70"
    >
      {children}
    </button>
  );
}

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const strokeProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {name === "orbit" && (
        <g {...strokeProps}>
          <circle cx="12" cy="12" r="3" />
          <path d="M3.6 9.3c2.2-5 7.4-7.1 11.5-4.7s5.5 8.3 3.3 13.3" />
          <path d="M20.4 14.7c-2.2 5-7.4 7.1-11.5 4.7S3.4 11.1 5.6 6.1" />
        </g>
      )}
      {name === "chevron-left" && <path {...strokeProps} d="m15 18-6-6 6-6" />}
      {name === "chevron-right" && <path {...strokeProps} d="m9 18 6-6-6-6" />}
      {name === "chevron-down" && <path {...strokeProps} d="m6 9 6 6 6-6" />}
      {name === "ellipsis" && (
        <g fill="currentColor">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </g>
      )}
      {name === "play" && <path fill="currentColor" d="M8 5v14l11-7z" />}
      {name === "settings" && (
        <g {...strokeProps}>
          <path d="M4 8h8M16 8h4M10 5v6M4 16h4M12 16h8M8 13v6" />
        </g>
      )}
      {name === "eye-off" && (
        <g {...strokeProps}>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
          <path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c5 0 8.5 4.2 9.6 6.2a2 2 0 0 1 0 1.6 15.2 15.2 0 0 1-2.3 3" />
          <path d="M6.4 6.9A15.8 15.8 0 0 0 2.4 11.2a2 2 0 0 0 0 1.6C3.5 14.8 7 19 12 19a9.9 9.9 0 0 0 3.4-.6" />
        </g>
      )}
      {name === "arrow-right" && (
        <g {...strokeProps}>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </g>
      )}
      {name === "github" && (
        <path
          fill="currentColor"
          d="M12 .7A11.3 11.3 0 0 0 8.4 22.8c.6.1.8-.3.8-.6v-2.1c-3.4.7-4.1-1.5-4.1-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2A11.2 11.2 0 0 1 12 4.7c1 0 2 .1 2.9.4 2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.2.7.8.6A11.3 11.3 0 0 0 12 .7z"
        />
      )}
      {name === "key" && (
        <g {...strokeProps}>
          <circle cx="7.5" cy="14.5" r="3.5" />
          <path d="M10.2 11.8 21 1M15 7h4v4" />
        </g>
      )}
    </svg>
  );
}
