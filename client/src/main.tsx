import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ModelPlaza from "./ModelPlaza";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./auth/AuthGate";
import "./index.css";

// 极简 hash 路由：#/plaza → 模型广场；其它 → 节点画布
function Root() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  if (hash.startsWith("#/plaza")) return <ModelPlaza />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <Root />
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
);
