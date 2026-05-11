/** @type {import('tailwindcss').Config} */
// 按 DESIGN.md 三铁律：UI 灰阶 / 颜色让给语义 / 深度来自玻璃与辉光。
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0D0D0D",
        ink: "#FFFFFF",
        accent: {
          robot: "#4CB1FF", // 协作者 Kate / image 端口 / 焦点环
          foxo: "#F0FE2D", // Generate 唯一 CTA / 协作者 Paul / model 端口
          ptext: "#FF7E87", // 协作者 Mario / negative / output 端口
        },
        port: {
          model: "#F0FE2D",
          positive: "#7CE38B",
          negative: "#FF7E87",
          image: "#4CB1FF",
          output: "#FF7E87",
        },
      },
      fontFamily: {
        // Outfit 一家通吃
        sans: ["Outfit", "system-ui", "-apple-system", "sans-serif"],
      },
      borderRadius: {
        // 严格按 DESIGN.md rounded 表
        sm: "8px",
        md: "12px",
        lg: "14px",
        xl: "18px",
      },
      boxShadow: {
        // 整套设计仅 3 个 shadow token
        node: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.5)",
        dock: "0 8px 32px rgba(0,0,0,0.45)",
        "generate-glow": "0 0 24px rgba(240,254,45,0.35)",
      },
      backgroundImage: {
        "dot-grid":
          "radial-gradient(circle at center, rgba(255,255,255,0.06) 1px, transparent 1.4px)",
      },
      backgroundSize: {
        "grid-24": "24px 24px",
      },
      backdropBlur: {
        glass: "18px",
      },
    },
  },
  plugins: [],
};
