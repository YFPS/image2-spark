<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-home.png">
    <img src="docs/screenshot-home.png" alt="image2" width="800">
  </picture>
</p>

<h1 align="center">image2</h1>

<p align="center">
  <strong>AI 图像生成工作流 · 节点画布编辑器</strong>
</p>

<p align="center">
  <a href="https://image2.destinys.cn/" target="_blank">🌐 在线演示</a>
  &nbsp;·&nbsp;
  <a href="#-功能特性">特性</a>
  &nbsp;·&nbsp;
  <a href="#-快速开始">快速开始</a>
  &nbsp;·&nbsp;
  <a href="#-技术栈">技术栈</a>
  &nbsp;·&nbsp;
  <a href="#-项目结构">项目结构</a>
</p>

---

**image2** 是一个基于 AI 的图像生成 SaaS 平台，采用**节点画布编辑器**的交互范式。用户通过搭建可视化工作流来驱动图像生成、编辑与后期处理，而非传统的表单填表模式。

前端使用 React + WebGL2 实现**液态玻璃**（Liquid Glass）光学渲染节点界面，后端通过 FastAPI 代理 OpenAI 兼容的图像生成上游服务。

---

## ✨ 功能特性

### 🎨 节点画布工作流
- **可视化节点编辑**：拖拽连接图像生成、编辑、参考图等节点，构建复合工作流
- **液态玻璃 UI**：基于 WebGL2 多通道着色器（高斯模糊 + 折射 + 色散 + 菲涅尔反射），实现真正的光学玻璃质感
- **灰阶设计系统**：颜色全部让给语义（端口数据类型色），唯一电黄 `#F0FE2D` CTA

### 🤖 多模型图像生成
- 支持 **gpt-image-2**、**Gemini**、**Cloudflare Workers AI**、**Pollinations.ai** 等多上游接入
- **文生图**：通过提示词生成高质量图像
- **图生图 / Inpainting**：以上传图片为基础进行编辑修改
- **多参考图编辑**：支持多张参考图同时输入

### 🛠 工具链
- **智能抠图**：支持 grabcut / rembg / SAM / MobileSAM 四种后端
- **PSD 导出**：生成分层 PSD 文件以便后期编辑
- **对话历史**：完整的生成记录与管理

### 🔐 用户系统
- 邮箱注册/登录 + JWT 鉴权
- 积分计费体系
- 邮箱验证与密码重置
- Cloudflare Turnstile 人机验证
- 管理员后台：渠道管理、公告管理、用户管理

---

## 🚀 快速开始

### 前置条件

- Node.js 18+
- Python 3.10+
- MySQL 8.0+
- Redis

### 前端

```bash
cd client
npm install
npm run dev      # 开发服务器 → http://127.0.0.1:5173
```

### 后端

```bash
cd server
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入数据库连接、API Key 等配置

uvicorn app.main:app --reload --port 8000
```

后端固定端口 **8000**，前端 Vite 开发服务器通过 proxy 转发 `/api` 请求。

---

## 🧱 技术栈

| 层 | 技术 |
|------|--------|
| **前端框架** | React 18 + TypeScript |
| **构建工具** | Vite |
| **样式** | Tailwind CSS + PostCSS |
| **WebGL** | 自研 WebGL2 多通道液态玻璃着色器 |
| **后端框架** | FastAPI (Python) |
| **数据库** | MySQL 8.0 (SQLAlchemy async + Alembic) |
| **缓存/限流** | Redis |
| **AI 上游** | OpenAI 兼容 API（gpt-image-2 / Gemini / Cloudflare 等） |
| **鉴权** | JWT + bcrypt |

---

## 📁 项目结构

```
image2/
├── client/                    # React 前端
│   ├── src/
│   │   ├── api/               # 后端 API 封装
│   │   ├── auth/              # 登录/注册/鉴权
│   │   ├── components/        # 通用组件
│   │   ├── conversation/      # 对话历史
│   │   ├── pages/             # 页面（Admin 等）
│   │   ├── plaza/             # 模型广场
│   │   ├── shaders/           # WebGL GLSL 着色器
│   │   └── App.tsx            # 节点画布主逻辑
│   ├── index.html
│   └── package.json
│
├── server/                    # FastAPI 后端
│   ├── app/
│   │   ├── routers/           # 路由（auth/images/admin 等）
│   │   ├── middleware/        # 中间件
│   │   ├── config.py          # 配置入口
│   │   ├── models.py          # SQLAlchemy 模型
│   │   ├── schemas.py         # Pydantic 请求/响应
│   │   ├── openai_client.py   # 上游 API 客户端
│   │   └── main.py            # 应用入口
│   ├── .env.example
│   └── requirements.txt
│
├── scripts/                   # 工具脚本
├── DESIGN.md                  # 设计系统规范
└── README.md
```

---

## 📄 设计系统

详见 [`DESIGN.md`](DESIGN.md) — 包含完整的色彩体系、排版规范、间距系统和交互模式。

核心设计原则：
- **灰阶 UI**：界面使用中性灰色调，颜色保留给语义
- **液态玻璃**：节点使用真正的 WebGL 光学玻璃效果（折射背景），非 CSS backdrop-filter
- **电黄 CTA**：唯一亮色动作按钮 `#F0FE2D`，引导用户操作

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。

---

<p align="center">
  <a href="https://image2.destinys.cn/" target="_blank">🌐 在线演示</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/YFPS/image2-spark/issues">🐛 反馈问题</a>
</p>
