---
version: alpha
name: image2
description: 协作式 AI 节点画布。深近黑 #0D0D0D 画布 + 极淡 dot-grid + 半透明深玻璃节点 + 彩色端口语义色 + 电黄胶囊唯一动作色 #F0FE2D。UI 灰阶化，颜色全部让给语义（端口数据类型 / 协作者光标 / 生成结果本身）。Outfit 一家字体通吃，靠字重拉层级。心智模型是"装配工作流"而非"填表生成图"。

colors:
  canvas: "#0D0D0D"          # 主表面（节点画布、节点底色）
  ink: "#FFFFFF"             # 反表面（白按钮、活跃高亮）
  accent-robot: "#4CB1FF"    # 天蓝 —— 协作者 Kate / image 端口 / link
  accent-foxo: "#F0FE2D"     # 电黄 —— Generate 唯一 CTA / 协作者 Paul / model 端口
  accent-ptext: "#FF7E87"    # 珊瑚粉 —— 协作者 Mario / negative 端口
  port-model: "#F0FE2D"
  port-positive: "#7CE38B"   # 正向端口绿（语义派生）
  port-negative: "#FF7E87"
  port-image: "#4CB1FF"
  port-output: "#FF7E87"
  glass-surface: "rgba(28, 28, 32, 0.6)"     # 节点玻璃底
  glass-surface-lo: "rgba(255, 255, 255, 0.04)"
  glass-surface-hi: "rgba(255, 255, 255, 0.08)"
  glass-border: "rgba(255, 255, 255, 0.08)"
  glass-border-strong: "rgba(255, 255, 255, 0.14)"
  text-primary: "rgba(255, 255, 255, 0.92)"
  text-secondary: "rgba(255, 255, 255, 0.64)"
  text-muted: "rgba(255, 255, 255, 0.40)"
  text-disabled: "rgba(255, 255, 255, 0.24)"
  text-on-foxo: "#0D0D0D"     # 电黄按钮上的文字
  text-on-ink: "#0D0D0D"      # 白按钮上的文字
  grid-dot: "rgba(255, 255, 255, 0.06)"
  glow-magenta: "rgba(255, 80, 200, 0.25)"   # 大模糊辉光：洋红
  glow-cyan: "rgba(80, 180, 255, 0.20)"      # 大模糊辉光：青
  glow-violet: "rgba(140, 100, 255, 0.18)"   # 大模糊辉光：紫
  wire-default: "rgba(255, 255, 255, 0.18)"  # 节点连线默认
  wire-active: "rgba(76, 177, 255, 0.7)"     # 节点连线高亮
  danger: "#FF5C5C"
  success: "#7CE38B"

typography:
  display-md:
    fontFamily: "Outfit, system-ui, -apple-system, sans-serif"
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.01em
  node-title:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0
  body:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  body-strong:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: 0
  caption:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 0
  button:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: 0
  telemetry:
    fontFamily: "Outfit, ui-monospace, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 0.02em
    fontFeatureSettings: "\"tnum\" on"   # tabular-nums，遥测数字对齐
  port-label:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: 0
  fine-print:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: 0.02em

rounded:
  none: 0px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 14px
  xl: 18px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  section: 48px

shadow:
  none: "none"
  node: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.5)"
  dock: "0 8px 32px rgba(0,0,0,0.45)"
  generate-glow: "0 0 24px rgba(240, 254, 45, 0.35)"

motion:
  ease-out: "cubic-bezier(0.2, 0.8, 0.2, 1)"
  ease-spring: "cubic-bezier(0.34, 1.56, 0.64, 1)"
  duration-fast: 120ms
  duration-base: 200ms
  duration-slow: 320ms
  press-scale: 0.97

components:
  global-topbar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-primary}"
    typography: "{typography.button}"
    height: 48px
    padding: 0 16px

  mode-tab:
    backgroundColor: "{colors.glass-surface-lo}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 8px 14px

  mode-tab-active:
    backgroundColor: "{colors.glass-surface-hi}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"

  project-tab:
    backgroundColor: "{colors.glass-surface-lo}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 6px 12px

  button-generate:
    backgroundColor: "{colors.accent-foxo}"
    textColor: "{colors.text-on-foxo}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 7px 14px
    shadow: "{shadow.generate-glow}"

  button-share:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.text-on-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 8px 16px

  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 8px 14px

  button-icon-square:
    backgroundColor: "{colors.glass-surface-lo}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    size: 32px

  node-card:
    backgroundColor: "{colors.glass-surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 14px
    border: "1px solid {colors.glass-border}"
    shadow: "{shadow.node}"
    backdropFilter: "blur(18px) saturate(140%)"

  node-card-focused:
    border: "1px solid {colors.glass-border-strong}"
    shadow: "0 0 0 1px {colors.accent-robot}, {shadow.node}"

  port-dot:
    size: 10px
    rounded: "{rounded.full}"
    border: "2px solid {colors.canvas}"
    glow: "0 0 6px currentColor"

  wire:
    stroke: "{colors.wire-default}"
    strokeWidth: 1.25
    activeStroke: "{colors.wire-active}"

  user-presence-flag:
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 8px

  input-field:
    backgroundColor: "{colors.glass-surface-lo}"
    textColor: "{colors.text-primary}"
    placeholderColor: "{colors.text-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 8px 10px
    border: "1px solid {colors.glass-border}"

  dropdown:
    backgroundColor: "{colors.glass-surface-lo}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 6px 10px
    border: "1px solid {colors.glass-border}"

  stepper:
    backgroundColor: "{colors.glass-surface-lo}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    border: "1px solid {colors.glass-border}"
    height: 28px

  prompt-dock:
    backgroundColor: "{colors.glass-surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 14px 18px
    border: "1px solid {colors.glass-border}"
    backdropFilter: "blur(20px) saturate(140%)"
    shadow: "{shadow.dock}"

  canvas-tool:
    backgroundColor: "{colors.glass-surface-lo}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    size: 32px

  telemetry-block:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.telemetry}"

  output-action-bar:
    backgroundColor: "{colors.glass-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    padding: 6px 10px
    border: "1px solid {colors.glass-border}"
---

## 概览

`image2` 是协作式 AI 节点画布工作流编辑器，类型上参照 ComfyUI × Figma × Linear。整套设计的三条铁律：

1. **UI 必须灰阶。** 标题、正文、图标、按钮默认全部走灰阶白（60–92% 不透明度）。颜色专属于语义。
2. **颜色只有三处可以出现：**（a）节点端口 = 数据类型；（b）协作者光标旗 = 用户身份；（c）唯一动作色 `#F0FE2D` 电黄 = "Generate"。
3. **深度来自玻璃和辉光，不来自阴影。** 卡片 = 半透明玻璃 + 极细描边；画面"暖意"来自背景大模糊色块（洋红 / 青 / 紫），不来自 CSS 渐变叠层。

心智模型是**装配工作流**：用户在画布上摆节点、拉连线、运行队列、看结果，而不是"填表 → 点生成 → 等图"。所有视觉/交互决策都要回到这一句话。

**关键签名：**
- 近纯黑画布 + 极淡 dot-grid 圆点底纹。
- 半透明深玻璃节点 + 1px 极淡白描边，**无投影层级**。
- 端口色 = 数据类型语义：黄 model / 绿 positive / 红 negative / 蓝 image / 粉 output。
- 协作 multiplayer 是一等公民：实时光标 + 三色名牌旗（黄/蓝/粉）。
- 单一动作色：电黄 `#F0FE2D` 胶囊 + 极轻外发光，只用在 Generate。
- Outfit 一家字体通吃，全屏几乎没有 ≥18px 文本，**信息密度 > 仪式感**。
- 右下角遥测块（T 时长 / I 迭代 / N 步数 / S 种子）—— 给硬核用户的"仪表盘"。

## 颜色

> 三个 accent 在品牌规范页里的命名是 `#ROBOT / #FOXO / #PTEXT` —— 这本身就是产品的态度：玩感、不严肃。落到 token 里写作 `accent-robot / accent-foxo / accent-ptext`，但你应该把它们当**人**来记，而不是当颜色：Robot 是 Kate / Foxo 是 Paul / PText 是 Mario。

### 主表面
- **画布 `#0D0D0D`**：全屏背景，节点底色的基色（玻璃透下来看到的就是它）。比纯黑略亮一档，避免 OLED 上"塌黑"。
- **反表面 `#FFFFFF`**：仅用于 "Share" 等推广动作按钮，强对比但低频出现（一屏不超过 2 个）。

### 三 accent
- **`#4CB1FF` accent-robot**（天蓝）—— 协作者 1、image 端口、所有**链接 / 选中 / 焦点环**。
- **`#F0FE2D` accent-foxo`**（电黄 / 偏荧光）—— **Generate 胶囊是唯一允许的填充使用场景**。协作者 2 名牌、model 端口可以用同色但缩到 10px 圆点。
- **`#FF7E87` accent-ptext**（珊瑚粉）—— 协作者 3、negative / output 端口。**不要**当 destructive 用，destructive 走另一个 `#FF5C5C` 更暗的红。

### 玻璃层
- `glass-surface` —— 节点底，`rgba(28,28,32,0.6)`，配 `backdrop-filter: blur(18px) saturate(140%)`。
- `glass-surface-lo` / `glass-surface-hi` —— 按钮/输入框底；hi 用于 hover 或选中。
- `glass-border` / `glass-border-strong` —— 1px 极细白描边；strong 仅用于聚焦节点。

### 辉光
**三色高斯模糊雾**作为画布底色的呼吸：洋红 `glow-magenta` / 青 `glow-cyan` / 紫 `glow-violet`，每个都是大半径 (`filter: blur(120px)`) 的 fixed 色块。它们提供画面的"暖意"，并和生成结果图的棱镜光对应。

### 文字
- 正文用 `text-primary` (`white/0.92`)，副文用 `text-secondary` (`0.64`)，提示用 `text-muted` (`0.40`)。**不要用纯白**——会刺眼，破坏画面的"玻璃感"。
- 电黄按钮上的文字用 `#0D0D0D`，是整套设计里**唯一**反色文字使用场景。

### 不允许
- ❌ 任何 CSS gradient 直接叠在卡片上做"漂亮背景"。装饰光只能来自背景的高斯模糊色块。
- ❌ 第二个 CTA 颜色。Generate 是唯一电黄；其它动作走白色（Share / Make Public）或灰阶 ghost。
- ❌ 用 `accent-ptext` 表达"危险/删除"——它是协作者色，不是 destructive。

## 字体

### 字族
**Outfit** —— 几何无衬线、可变字重、Google Fonts 免费。整套设计的唯一字体，包括标题、正文、按钮、提示词、遥测数字。

CDN 接入：
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

### 层级

| Token | Size | Weight | LH | LS | 用途 |
|---|---|---|---|---|---|
| `display-md` | 22px | 500 | 1.2 | -0.01em | 工作流标题（"image generation v.3"） |
| `node-title` | 14px | 500 | 1.2 | 0 | 节点标题（"Model" / "Image Generator"） |
| `body-strong` | 13px | 600 | 1.45 | 0 | 关键参数标签 |
| `body` | 13px | 400 | 1.45 | 0 | 提示词正文、节点参数值 |
| `button` | 13px | 500 | 1.0 | 0 | 所有按钮 |
| `caption` | 12px | 400 | 1.3 | 0 | 节点参数说明、协作者名牌 |
| `port-label` | 11px | 400 | 1.0 | 0 | 端口名（model / positive） |
| `telemetry` | 11px | 400 | 1.3 | 0.02em | 右下角 T/I/N/S，**tabular-nums** |
| `fine-print` | 10px | 400 | 1.2 | 0.02em | 版权 / 版本号小尾 |

### 规则
- **不要用 16px+ 的标题塞页面。** 工作流名 22px 已经是全屏最大。产品的层级靠**画布缩放**和**节点高亮**来做，不靠字号。
- **字重梯度只用 400 / 500 / 600。** 300 仅在希望"轻盈感"的少数标签处出现；700 几乎不用（会破坏几何感）。
- **数字必须 tabular-nums.** 节点参数值、遥测、版本号——任何会变化的数字都要让它们等宽。
- **sentence case。** 按钮、标题、菜单一律 "Make public" 而不是 "MAKE PUBLIC"，也不是 "Make Public"。

## 形状

| Token | Value | 用途 |
|---|---|---|
| `rounded.xs` 6 | 极小元素（端口圆点的外环） |
| `rounded.sm` 8 | 输入框、dropdown、stepper |
| `rounded.md` 12 | 画布工具按钮、小图标按钮 |
| `rounded.lg` 14 | **节点卡 / Dock**（整套设计的"骨"圆角） |
| `rounded.xl` 18 | 弹层、预览卡（少数情况） |
| `rounded.pill` 9999 | 所有按钮 / tab / 协作者名牌 |

**铁律：**
- 按钮无一例外胶囊。
- 节点和容器统一 14。**不要混用 12 / 16 / 20**，那会破坏画布的"节奏感"。
- 端口圆点是真圆 + 2px `#0D0D0D` 外环，让它在玻璃上能"切"出来。

## 间距

base = 4。结构线：**14（节点内边距）/ 16（容器间距）/ 24（节点之间）/ 48（画布到 viewport 边界）**。

不要无意义地用 5、7、9、11、13。这是设计的纪律性，不是"差不多就行"。

## 深度与高光

| 层 | 处理 |
|---|---|
| 画布层 | `#0D0D0D` 底 + 24px 间距 dot-grid + 三色高斯模糊辉光雾 |
| 玻璃层 | `glass-surface` + `backdrop-filter: blur(18px) saturate(140%)` + 1px `glass-border` |
| 聚焦层 | 同上 + 1px `accent-robot` 外环（`box-shadow: 0 0 0 1px ...`） |
| 动作层 | Generate 胶囊 + `0 0 24px rgba(240,254,45,0.35)` 外发光 |
| 结果层 | 生成图自带棱镜光晕，**不要叠任何 CSS 修饰**，让作品本身发光 |

**只有 Generate 按钮有发光阴影。其它一切都没有。**

## 组件

### 顶部条 (`global-topbar`)
高 48，分四段，从左到右：
1. **品牌 + 模式 tab**（"Workflow / Edit / Help"）—— `mode-tab` 胶囊 + `mode-tab-active`。
2. **左中：协作者头像堆**（圆形 24px，重叠 -8，最后一个 "+N" 灰圈）。
3. **中间：项目 tab**（"Black bear" + × 关闭 + ← →）—— 用 `project-tab`。
4. **右：运行控制**（`Queue ▶` + ⌃⌄ + × + 复制 + 菜单）+ **Share / Make public** 两个白胶囊。

### 节点卡 (`node-card`)
- 14px 内边距，14px 圆角，半透明深玻璃 + 1px 极淡白描边。
- 顶部一行：**彩色圆点状态** + 节点标题 (`node-title`) + 右上端口圆点（如果是输出节点）。
- 中部：参数列表 / 提示词输入框，每行 `port-label` 左 + 控件右。
- 端口圆点贴在卡的左/右边缘，**视觉上"刺穿"卡边**，1/2 在卡内、1/2 在卡外。
- 聚焦：用 `node-card-focused`，多 1px 天蓝外环。

### 端口 + 连线
- **端口圆点 10px** + 2px 画布色外环 + 同色 6px glow（`box-shadow: 0 0 6px currentColor`）。
- 颜色 = 数据类型；同色之间才可连接（视觉上"自带类型检查"）。
- **连线** 是 SVG path，`stroke-width: 1.25`，默认 `wire-default`；当连线对应的节点被选中或数据正在流动时切到 `wire-active` 天蓝。

### 协作者名牌 (`user-presence-flag`)
- 跟随光标一起飞，胶囊形 + 三色之一（`accent-robot / -foxo / -ptext`）。
- 文字用 `caption` + `text-on-ink`（深色）。
- 节点被某协作者编辑时，节点右下角"贴"一个同款名牌（如截图里的 Paul / Mario）。

### 提示词 Dock (`prompt-dock`)
- 屏幕底部浮条，宽约 720，居中。
- 左：**当前 prompt 摘要卡片**（多行截断 + "Prompt" 标签）。
- 右：工具图标横排（⏱ 历史 / 📌 收藏 / 📦 资产 / 📚 库 / ☀ 主题 / ⚙ 设置）。
- 内边距 14×18，14 圆角，玻璃 + 描边 + 大模糊 + `shadow.dock`。

### 画布工具栏 (`canvas-tool` 集合)
- 右侧竖排浮在 viewport 边缘（绝对定位）。
- 自上而下：+ / − / 全屏 / 👁 切显示 / 🤚 抓手。
- 每个 32×32，`rounded.md`，玻璃底，hover 切到 `glass-surface-hi`。

### Generate CTA (`button-generate`)
- **整套设计里唯一的电黄填充**。胶囊、7×14 内边距、`text-on-foxo` 深色字。
- 外发光 `shadow.generate-glow` 是签名特征，**不要去掉**。
- 触发后切到"运行中"态：胶囊保留黄，但内部叠 1.5px 的进度环或脉冲，禁止把整个按钮变灰。

### Share / Make public (`button-share`)
- 纯白底 + 深色字 + 胶囊 + 8×16 内边距。
- 一屏最多两个，且都在右上集群里，**不可在画布主区出现**。

### 输出操作栏 (`output-action-bar`)
- 放在 Preview 节点底部，胶囊容器内放 5–6 个图标按钮 + 中间一个 dropdown（"2× / PNG"等）。
- 操作：⤢ 放大 / 🔖 收藏 / 📋 复制 / 🔄 重生 / 倍数 / 格式 / ↓ 下载。

### 遥测块 (`telemetry-block`)
- 固定右下角，竖排四行：`T: 0.00s / I: 0 / N: 10 (10) / S: 60.24`。
- `text-muted` 颜色 + tabular nums。运行时数字逐帧刷新。

## 交互与动效

- **按下缩放 0.97**：所有可点击元素（按钮 / tab / icon）默认 `active:scale-[0.97]`，时长 120ms。
- **聚焦环**：天蓝 `accent-robot`，1px 外环 + 24% 同色 4px 模糊。
- **连线绘制**：从端口拖出时实时贝塞尔预览，目标端口与源端口同色才高亮 + 吸附。
- **节点拖动**：跟随光标 + 极轻惯性（`ease-out` 200ms 收尾）。
- **运行流动**：连线沿路径有 1px 高亮"流动光点"，方向从源到目标，频率 2Hz（直观看到数据流方向）。
- **不要做**：弹跳、3D 翻卡、过度 spring 效果。Linear 式克制。

## 画布底纹

```css
.canvas {
  background:
    radial-gradient(60% 60% at 20% 30%, rgba(255, 80, 200, 0.18), transparent 60%),
    radial-gradient(70% 70% at 80% 70%, rgba(80, 180, 255, 0.18), transparent 60%),
    radial-gradient(50% 50% at 50% 90%, rgba(140, 100, 255, 0.14), transparent 60%),
    radial-gradient(circle at center, rgba(255, 255, 255, 0.06) 1px, transparent 1.4px) 0 0 / 24px 24px,
    #0D0D0D;
}
```

辉光雾用 fixed 大模糊 div 也可以，看实现选哪条路：

```html
<div class="fixed inset-0 -z-10 bg-canvas">
  <div class="absolute -top-32 left-1/4 h-[480px] w-[480px] rounded-full bg-[#FF50C8]/25 blur-[120px]" />
  <div class="absolute bottom-0 right-1/4 h-[520px] w-[520px] rounded-full bg-[#50B4FF]/20 blur-[120px]" />
  <div class="absolute top-1/3 right-10 h-[360px] w-[360px] rounded-full bg-[#8C64FF]/18 blur-[120px]" />
</div>
```

## 响应式

- **画布优先**：移动端不是核心场景。≤ 1024px 时不要试图把节点画布"塞进"小屏；改为只读预览 + 摘要列表。
- **真正的断点：**
  - 1440px+：完整节点编辑 + 全部协作能力。
  - 1280–1440px：保留所有功能，右侧画布工具栏可折叠为单个 ⫶ 按钮。
  - 1024–1280px：顶部协作头像堆收成单个"+N"。
  - ≤ 1024px：进入只读 / 移动检视模式（不支持编辑）。
- **不需要**手机 / 平板的完整设计稿。这是桌面优先的创作工具。

## Do's and Don'ts

### Do
- 颜色让给语义：端口色、协作者色、Generate 电黄。其它一切灰阶。
- 节点卡用玻璃 + 极细描边构层；聚焦才上天蓝外环。
- Outfit 一家通吃，字号 ≤ 22px，字重在 400/500/600 之间。
- 数字一律 tabular。
- 按下 `scale(0.97)` 是全站微交互签名。
- 三色辉光雾固定在画布背景层（z 最低）。

### Don't
- 不要给卡 / 按钮加阴影做层级。**只有 Generate 有发光**。
- 不要叠 CSS gradient 当装饰背景。
- 不要把协作粉色当"删除"色。
- 不要混用圆角值（节点统一 14，按钮统一胶囊）。
- 不要用 16px+ 的"营销标题"。这是工具，不是落地页。
- 不要做 hover 状态的大幅变形；hover 改透明度或描边，不改尺寸。
- 不要把白胶囊用在画布主区。Share / Make public 仅限右上角集群。

## 落地映射（Tailwind）

```js
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        canvas: "#0D0D0D",
        ink: "#FFFFFF",
        accent: {
          robot: "#4CB1FF",
          foxo: "#F0FE2D",
          ptext: "#FF7E87",
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
        sans: ["Outfit", "system-ui", "-apple-system", "sans-serif"],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "14px",
        xl: "18px",
      },
      boxShadow: {
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
    },
  },
};
```

## 已知空白

- 错误态 / 加载态在截图里没有出现，需要后续补：建议沿用 `glass-surface` 卡 + `accent-ptext` 不超过 1 处。
- 移动端没有正式设计，按"只读检视"实现即可。
- 节点市场 / 模型市场 / 社区流（Make public 的另一面）UI 未给出，需要先做产品决策再补设计。
- 评论 / 注释 UI 未给出。建议沿用协作者名牌的胶囊形态扩展。

---

# v0.2 增补 —— 嵌套式液态玻璃卡片

> 本节是对原 v0.1 alpha 的补丁，确立"父级液态玻璃 + 内层灰色矩形 + **圆角必须父子一致**"作为节点卡片的标准结构。原 v0.1 中泛泛的"半透明深玻璃节点"由这套更具体的规则取代。

## 1. 关键原则

1. **真液态玻璃只用于父级容器**，不用于内层卡片。
2. **液态玻璃用 WebGL2 着色器实现**，不要用 CSS `backdrop-filter` 假装——CSS 永远做不出折射 / 色散 / 菲涅尔。
3. **内层卡片是实心灰矩形**，无渐变、无浮雕、无内顶高光。
4. **父子圆角必须完全一致**（同一像素值）——这是这套设计的视觉签名，不容妥协。

## 2. 父级：液态玻璃容器（`liquid-glass-parent`）

由 WebGL2 多通道着色器渲染（移植自 `liquid-glass-studio`：bgPass → vBlurPass → hBlurPass → mainPass）。父级是一个透明的 DOM 定位壳；视觉上的"玻璃卡"完全由全屏 WebGL canvas 在它的位置渲染。

### 2.1 着色器参数（已落地为 image2 默认值）

```ts
{
  // 折射
  refThickness: 20,
  refFactor: 1.4,            // 折射率
  refDispersion: 7,          // 色散（红/绿/蓝边缘错位强度）

  // 菲涅尔（沿整个边缘的均匀白边）
  refFresnelRange: 30,
  refFresnelHardness: 0.20,
  refFresnelFactor: 0.20,

  // 斜向高光 —— 关闭！避免顶部出现"自发光边缘"
  glareFactor: 0,            // ← 设为 0
  glareRange: 30,            // （保留但不生效）
  glareHardness: 0.20,
  glareConvergence: 0.50,
  glareOppositeFactor: 0.80,
  glareAngle: -45,           // -π/4，未来如需开启的默认

  // 背景模糊
  blurRadius: 1,
  blurEdge: true,

  // 形状
  shapeRoundness: 2.5,       // 超椭圆指数 —— 接近标准圆弧，与内层 CSS 圆角形状一致
  shapeRadius: 32,           // 默认圆角，**所有内层 CSS 卡必须用同一值**

  // 下方软投影
  shadowExpand: 25,
  shadowFactor: 0.15,
  shadowPosition: [0, -10],

  // 染色
  tint: [1, 1, 1, 0],        // alpha=0，无染色（让背景原色透过）
}
```

### 2.2 关键决策记录

- **`glareFactor: 0`** —— 默认必须关闭。开启会在顶部左/右沿打出强斜光，破坏"嵌套灰卡"的纯净感。如某天确需做"产品截图样式"开启，必须改全局默认。
- **`shapeRoundness: 2.5`**（不是 5）—— 原 liquid-glass-studio 默认 5（明显超椭圆），与内层 CSS `rounded-[Npx]`（标准圆弧）形状不一致。降到 2.5 后曲线接近圆弧，父子边角拟合度大幅提升。
- **`shapeRadius: 32`** —— 我们的默认。不同节点可改，但必须**同步**改内层卡。

### 2.3 圆角统一约束

父级液态玻璃形状的 `shapeRadius` 与所有直接子级内层卡的 CSS `rounded-[Npx]` **必须使用同一像素值**。

代码中应通过同一个常量驱动，避免漂移：

```tsx
const CARD_RADIUS = 32;

// 父级（WebGL）
<LiquidGlass shape={{ ...rest, radius: CARD_RADIUS }} />

// 子级（DOM）
<div style={{ borderRadius: CARD_RADIUS }} className="bg-[#1e1e22] border border-white/[0.04]" />
```

## 3. 内层：灰色矩形（`inner-card`）

| 项 | 值 | 说明 |
|---|---|---|
| 背景 | `#1e1e22` | 实色，**不允许渐变** |
| 边框 | `1px rgba(255,255,255,0.04)` | hairline，仅为定义边界 |
| 圆角 | **= 父级 `shapeRadius`** | 必须一致 |
| 内边距 | `p-4`（16px） | 默认；可按内容微调 |
| 阴影 | `none` | **不允许 `box-shadow: inset 0 1px 0 ...` 这种浮雕假深度** |

### 不允许（铁律）

- ❌ `linear-gradient(180deg, #2a2a2e, #1c1c20)` 上亮下暗的浮雕——破坏"父液态、子矩形"的层次清晰度
- ❌ `box-shadow: inset 0 1px 0 rgba(255,255,255,X)` 顶部内高光——同上
- ❌ 内层 `backdrop-filter: blur`——内层是实心矩形，不参与玻璃
- ❌ 内层圆角 ≠ 父级圆角

### 为什么内层必须扁平

液态玻璃父级已经提供"立体深度感"（折射 + 菲涅尔 + 投影）。如果内层也加渐变/内高光，视觉上就有两层"立体感"互相打架，画面变脏。**让父级负责所有玻璃质感，子级只承担信息密度。**

## 4. 标准组件：嵌套式节点卡

```tsx
type NestedCardProps = {
  width: number;
  height: number;
  radius: number;          // CARD_RADIUS
  shapePos: { x: number; y: number };  // 屏幕中心，feed 给 LiquidGlass
  title: string;
  children: ReactNode;     // 内层灰卡组成的内容
};
```

### 4.1 标题行（外层 padding 内）

- 容器：`p-5`（20px 边距），紧贴外层左上
- 内容：**空心白圆环**（`h-3 w-3 rounded-full border-[1.5px] border-white/85`） + 节点名 (`text-[14px] font-medium text-white/95`)
- 与下方第一块内层卡的间距：`pb-4`（16px）

> 空心圆环表示"节点激活状态"，**不要用实心圆**（实心圆是端口的视觉语言，会语义混淆）。

### 4.2 内层卡之间的间距

`mt-3`（12px）—— 比内层 padding 略小，让内层卡群有"成簇"感，与外层 padding（20px）拉开层级。

## 5. 端口位置（嵌套式节点）

- 端口圆点（彩色 + 同色 6px glow）贴在**内层灰卡的右内侧**，不外露刺穿
- 这是与 v0.1 "端口半在卡内半在卡外"的修订——嵌套式节点不外露端口
- Wire（节点连线）的 SVG 锚点仍在父级液态玻璃的右边缘 + 端口行的 y 高度

## 6. Wire（节点连线）

- 颜色：统一 **`rgba(255,255,255,0.22)`** 极细灰，**不跟端口色变化**
- 粗细：`strokeWidth: 1`
- 不加任何 `drop-shadow` / glow / 颜色发光
- 这与 v0.1 "连线颜色 = 端口色" 的描述冲突 —— 以本节为准

## 7. 顶部条（修订 v0.1）

参考图修订：顶部条**完全透明**，无 `border-b`，无 `backdrop-blur`，dot grid 透过来。所有顶部按钮直接漂在画布上。

### 7.1 左集群
- **抽象螺旋 logo**（28×28 SVG 单色描边）
- 三胶囊 tab：`Workflow`（激活：`bg-white/[0.08]`）/ `Edit` / `Help`（非激活：`bg-white/[0.03]`）

### 7.2 中央项目导航（绝对居中）
- `‹` 方按钮 + `Black bear ×` 胶囊 + `›` 方按钮
- 用 `absolute left-1/2 -translate-x-1/2`，不被左右挤压

### 7.3 右集群（运行控制）
按从左到右：
1. `⋮` 三点垂直
2. `▶ Queue ⌄` 胶囊
3. 上下小步进器（17×24px ×2）
4. `×` 关闭
5. 相机图标
6. `≡` 菜单

### 7.4 通用尺寸
- 方按钮：36×36，`rounded-[10px]`，背景 `bg-white/[0.04]`，hover `bg-white/[0.08]`
- 胶囊按钮：`rounded-full`，padding `px-4 py-2` / `px-5 py-2`，text-[13px] medium

## 8. 鼠标光标

全站使用自定义 SVG 光标 `/cursor.svg`：

- 形状：Figma 风格箭头，沿用 `accent-foxo` 黄色填充 + canvas 色 1.2px 描边
- 滤镜：`<feGaussianBlur stdDeviation="2.5">` 渲染一份同形状半透明黄色作光晕底
- SVG 画布：32×32，热点 `(8, 6)` 在箭头左上尖端
- CSS：`cursor: url("/cursor.svg") 8 6, auto;`
- 例外：`input` / `textarea` 保持系统 `text` 光标，不影响选词

### 协作者名牌（静态）

DOM 上的 `<PaulCursor>` 仍可作为**设计陈列示意**保留（黄三角 + Paul 圆角名牌），与浏览器实际光标视觉一致。

## 9. Generate 行为迁移

v0.1 把 Generate 放在顶部右集群。v0.2 改为：

- **顶部 `▶ Queue ⌄` 即生成入口** —— 节点画布的工作流编辑器里，"运行队列"就是"生成"
- 不再单独保留电黄 `Generate` 胶囊，但电黄仍保留作为：
  - 协作者 Paul 的身份色
  - 节点的 `model` 端口语义色
  - 鼠标光标主色

## 10. 改动清单（v0.1 → v0.2）

| 项 | v0.1 | v0.2 |
|---|---|---|
| 节点卡结构 | 单层"半透明深玻璃" | 父液态玻璃（WebGL）+ 子灰矩形 |
| 玻璃实现 | `backdrop-filter` CSS | WebGL2 多通道着色器 |
| 内层卡背景 | 半透明白叠加 | 实心 `#1e1e22` |
| 内层卡浮雕 | 默认允许 | **禁止**（无渐变/无内高光） |
| 父子圆角 | 各自定义 | **必须一致**（同一像素值） |
| 端口位置 | 半在卡内半在卡外 | 仅在内层卡右内侧（不外露） |
| 连线颜色 | 跟端口色 | 统一 `rgba(255,255,255,0.22)` 灰 |
| 顶部条 | 半透明 + 底分割线 | 完全透明，无 border |
| Generate | 顶部右胶囊 | 改为 `▶ Queue ⌄` |
| 光标 | 系统 | 自定义黄色 Paul SVG |
