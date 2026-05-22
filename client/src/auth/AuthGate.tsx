// 鉴权门：根据 AuthContext 状态决定渲染 overlay / 主应用 / 加载
import { useEffect, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { AuthOverlay } from "./AuthOverlay";
import { UserBadge } from "./UserBadge";

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") {
    // 启动期占位：避免短暂闪现 overlay
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0b0b0d",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#7a7a82",
          fontSize: 13,
        }}
      >
        加载中…
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <>
        <AuthOverlay />
        <VerifyFlashToast />
      </>
    );
  }

  return (
    <>
      {children}
      <UserBadge />
      <VerifyFlashToast />
    </>
  );
}

/** 顶部居中 toast：展示邮件链接验证成功/失败的反馈，6 秒后自动清掉。 */
function VerifyFlashToast() {
  const { verifyFlash, clearVerifyFlash } = useAuth();

  useEffect(() => {
    if (!verifyFlash) return;
    const t = window.setTimeout(() => clearVerifyFlash(), 6000);
    return () => window.clearTimeout(t);
  }, [verifyFlash, clearVerifyFlash]);

  if (!verifyFlash) return null;

  const isSuccess = verifyFlash.kind === "success";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 18,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1100,
        padding: "10px 16px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 500,
        color: isSuccess ? "#0D0D0D" : "#FF8A8A",
        background: isSuccess ? "#F0FE2D" : "rgba(40,16,18,0.92)",
        border: isSuccess
          ? "1px solid rgba(0,0,0,0.08)"
          : "1px solid rgba(255,138,138,0.32)",
        boxShadow: isSuccess
          ? "0 8px 24px rgba(240,254,45,0.35)"
          : "0 8px 24px rgba(0,0,0,0.5)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <span>{isSuccess ? "✓" : "!"}</span>
      <span>{verifyFlash.message}</span>
      <button
        type="button"
        onClick={clearVerifyFlash}
        style={{
          marginLeft: 4,
          background: "none",
          border: "none",
          color: "inherit",
          opacity: 0.6,
          cursor: "pointer",
          padding: "0 4px",
          fontSize: 13,
        }}
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  );
}
