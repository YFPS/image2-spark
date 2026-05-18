import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./auth/AuthGate";
import "./index.css";

// 模型广场已嵌入 App 主壳的左侧栏 activeNav==='models' 分区。
// 之前的 #/plaza hash 路由已废弃。

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
);
