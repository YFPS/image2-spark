// 鉴权门：根据 AuthContext 状态决定渲染 overlay / 主应用 / 加载
import { type ReactNode } from "react";
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
    return <AuthOverlay />;
  }

  return (
    <>
      {children}
      <UserBadge />
    </>
  );
}
