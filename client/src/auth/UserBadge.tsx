// 右上角"头像 + 昵称 + 积分"胶囊；点击展开下拉含"登出"
// 用 fixed 定位浮在画布之上，不需要修改 App.tsx
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";

export function UserBadge() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!user) return null;

  const initial = (user.nickname || user.email).slice(0, 1).toUpperCase();

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: 14,
        right: 18,
        zIndex: 900,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px 6px 6px",
          borderRadius: 999,
          background: "rgba(28,28,32,0.6)",
          backdropFilter: "blur(18px) saturate(140%)",
          WebkitBackdropFilter: "blur(18px) saturate(140%)",
          border: "1px solid rgba(255,255,255,0.06)",
          color: "#e7e7ea",
          fontSize: 13,
          cursor: "pointer",
          outline: "none",
        }}
        title={user.email}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#4a4a55 0%,#2c2c33 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#e7e7ea",
            fontWeight: 600,
            fontSize: 12,
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {initial}
        </span>
        <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {user.nickname}
        </span>
        <span style={{ color: "#9b9ba3", fontSize: 11, marginLeft: 4 }}>
          {user.credits} 积分
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: 44,
            right: 0,
            minWidth: 180,
            padding: 8,
            borderRadius: 10,
            background: "rgba(20,20,24,0.85)",
            backdropFilter: "blur(20px) saturate(140%)",
            WebkitBackdropFilter: "blur(20px) saturate(140%)",
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            color: "#e7e7ea",
            fontSize: 13,
          }}
        >
          <div style={{ padding: "6px 10px", color: "#9b9ba3", fontSize: 11 }}>
            {user.email}
          </div>
          <div style={{ padding: "2px 10px 8px", color: "#7a7a82", fontSize: 11 }}>
            角色：{user.role}
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 0" }} />
          <MenuItem onClick={() => void logout()}>登出</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem(props: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: 6,
        background: "none",
        border: "none",
        color: "#e7e7ea",
        cursor: "pointer",
        fontSize: 13,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {props.children}
    </button>
  );
}
