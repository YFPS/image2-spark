# 模型广场（Model Plaza）液态玻璃重设计 v2

- **日期**：2026-05-19
- **前置 spec**：`docs/specs/2026-05-18-model-plaza-redesign.md`（结构拆分 / mock 数据 / 4+4 卡片网格）
- **范围**：在前一版"结构骨架"基础上，把视觉表达对齐 `DESIGN.md v0.2`（灰阶 + 端口语义色 + 唯一电黄 CTA + WebGL2 嵌套式液态玻璃）
- **deliverable**：
  - `.tmp/model-plaza-mockup.html` — 可在浏览器打开的完整视觉 mockup（包含所有组件 + 设计标注卡）
  - `.tmp/plaza-mockup.png` — 1440×2300 全页截图
- **不在范围**：
  - 本次只做视觉设计稿，**不动 React 代码**
  - 不替换 8 张 webp 作品图（mockup 用 CSS 占位色块模拟）
  - 不接真实搜索 / 过滤逻辑

---

## 一、Brainstorming 决策记录

| 决策点 | 用户选择 | 备注 |
|---|---|---|
| 设计路线 | **A. 对齐 DESIGN.md 铁律** | 整体灰阶化，去掉 Hero 紫调与彩色 chip 装饰；颜色让给端口语义 + 唯一电黄 CTA |
| 液态玻璃投放范围 | **B. Hero + 4 旗舰卡全玻璃** | 5 个 WebGL shape；推荐卡 / 顶栏 / Filter / 分页用 CSS 玻璃仿色 |
| 信息架构调整 | **A. 保留骨架，仅重做视觉** | 顺序照旧：顶栏 → Hero → Filter → 4 旗舰 → 4 推荐 → 分页 |

---

## 二、关键视觉变化（vs 当前 `client/src/ModelPlaza.tsx`）

### 移除（违反 DESIGN.md 铁律的元素）

| 旧元素 | 文件 | 原因 |
|---|---|---|
| Hero 紫调 radial-gradient + 暖橙光晕叠层 | `plaza/HeroBanner.tsx` | DESIGN.md 不允许 CSS gradient 当装饰背景 |
| Hero 右侧 3D SVG 装饰（紫/蓝/橙立方体堆叠） | `plaza/HeroBanner.tsx` | 与"工具非落地页"调性冲突，仪式感过重 |
| FeaturedCard 第一张金色边框 + 金色 box-shadow | `plaza/FeaturedCard.tsx` | DESIGN.md "只有 Generate 有发光" |
| FeaturedCard 标题粉紫渐变 clip 字 | `plaza/FeaturedCard.tsx` | 同上 + "字体只用 400/500/600 字重 + 灰阶白色" |
| Chip 五色映射（紫 / 青 / 绿 / 电黄 / 粉） | `plaza/data.ts` + 各卡 | 颜色应该让给端口语义，不该按业务分类铺色 |
| RecommendCard hover 金色 box-shadow | `plaza/RecommendCard.tsx` | 同 Generate-only 发光规则 |

### 新增（液态玻璃落地的结构）

| 新元素 | 位置 | 实现要点 |
|---|---|---|
| WebGL2 液态玻璃父级 | Hero + 4 FeaturedCard | 复用 `LiquidGlass.tsx`，5 个独立 shape，`shapeRadius: 32` |
| 内层 `#1E1E22` 灰矩形 | 每个液态玻璃父级内部 | 实色，`rounded-[32px]`（与父级 shapeRadius 一致），无渐变 / 无内顶高光 |
| Hero 三栏统计条 | 替代原"装饰大横幅" | 在线模型 / 你的收藏 / 本周热门，22px 数字 + tabular-nums |
| Trending 角标（克制版） | FeaturedCard #1 右上 | 电黄 1px 空心圆点 + 11px 电黄字"trending"，无填充无发光 |
| FilterBar chip 灰阶化 | FilterBar | 激活态 = `glass-surface-hi` + 1px `accent-robot` 外环（不是金色） |

### Chip 颜色 → port 语义色映射（取代业务分类色）

| 原 chip 类型 | 映射到 port | 颜色 |
|---|---|---|
| 图像生成 | `port-image` | `#4CB1FF` 蓝 |
| 多模态 | `port-output` | `#FF7E87` 粉 |
| 对话模型 | `port-positive` | `#7CE38B` 绿 |
| 高速模型 / 专业版 | （不再独占颜色，灰阶 chip） | `text-secondary` |

---

## 三、组件规格

### 3.1 全局画布

```
背景层（z=0, 与节点画布共用同一张底）：
  - #0D0D0D 主底
  - dot-grid: radial-gradient circle 1px/1.4px @ 24px tile
  - 三色辉光雾（fixed div，blur 120px）：
      magenta rgba(255,80,200,0.18)  — 左上 (60,180) 520×520
      cyan    rgba(80,180,255,0.18)  — 右下 (720,1180) 580×580
      violet  rgba(140,100,255,0.16) — 右中 (1040,520) 420×420
```

### 3.2 TopBar（48px 高，完全透明）

| 元素 | 规格 |
|---|---|
| Logo | 28×28 hollow circle，无填充 |
| Mode tab | 32px pill；active = `glass-hi`，inactive = `glass-lo` |
| 搜索框 | flex-1，max 480px，`rgba(255,255,255,0.04)` + 1px `glass-border` |
| 通知 | 32×32 rounded-12，红点 6×6 `#FF5C5C` |
| 头像 | 32×32 conic-gradient（三 accent 色） |
| **+ 新建项目** | **唯一电黄**：`#F0FE2D` + `shadow: 0 0 24px rgba(240,254,45,0.35)` |

### 3.3 HeroBanner（160px 高，**液态玻璃 #1**）

```tsx
<LiquidGlass shape={{ radius: 32, /* shaderDefaults */ }}>
  <div className="rounded-[32px] bg-[#1E1E22] border border-white/[0.04] p-7
                  flex items-stretch">
    <div className="flex-1 flex flex-col justify-center">
      <h1 className="text-[22px] font-medium tracking-[-0.01em]">模型广场</h1>
      <p className="text-[13px] text-white/64">探索高质量创作模型 · 覆盖图像生成 / 对话 / 多模态</p>
      <p className="text-[11px] text-white/40 mt-1 tracking-wider">首页 / 模型广场</p>
    </div>
    <div className="flex items-center gap-8">
      <Stat label="在线模型" value="247" trend="+12 本周" trendClass="text-port-positive" />
      <Stat label="你的收藏" value="12"  trend="上次 3 天前" />
      <Stat label="本周热门" value="38"  trend="实时刷新" />
    </div>
  </div>
</LiquidGlass>
```

**圆角铁律**：父级 `shapeRadius=32` ↔ 内层 `rounded-[32px]`，必须用同一常量驱动。

### 3.4 FilterBar（32px 单行）

- chip 高 32px，padding 0 16px，圆角 pill
- 未激活：`bg-white/[0.04]`，text-secondary
- **激活**：`bg-white/[0.08]` + text-primary + `box-shadow: 0 0 0 1px var(--accent-robot)`
- "自定义 +" outline chip（1px `glass-border`），暗示可添加自定义筛选
- 右侧：排序下拉 + ▦/☰ 视图切换

### 3.5 FeaturedCard（240px 高，**液态玻璃 #2–#5**）

**外层（每张一个 WebGL shape）**：
- `308×240`（1fr × 4，gap 16，等宽）
- `shapeRadius: 32`

**内层灰卡（嵌套结构）**：
- `288×220`（外层 padding 10）
- `#1E1E22` + `rounded-[32px]` + 1px `rgba(255,255,255,0.04)`

**内层卡内部**：
```
┌──────────────────────────┐
│ [作品图 16:10]            │ 132px 高
├──────────────────────────┤
│ Title (14px medium)       │
│ chip (10px port 色)       │ 14px padding
│ stats (11px telemetry)    │
└──────────────────────────┘
```

**第一张 trending**：
- 右上角 `60×22` 电黄空心徽章：1px `border-foxo` + 透明填充
- 内含 8×8 电黄空心圆点 + 10px 电黄字"trending"
- **无金色发光、无金色边框**（这是与旧版最大的差异）

### 3.6 RecommendCard（16:9，CSS 玻璃仿色）

- aspect-ratio 16:9，`rounded-[14px]`
- 作品图作为整张卡背景
- 底部 60% 高度黑色渐隐 overlay：`linear-gradient(to top, rgba(0,0,0,0.85), transparent)`
- chip 改 port 语义色，hover 由"金色阴影"改为"1px accent-robot 外环"
- 右上 ⭐ 灰阶 → 收藏激活时变 `accent-foxo`（**唯一允许金色出现的内容元素**）

### 3.7 Paginator

- 居中 5 个页码 + 左右箭头，按钮 32×32 `rounded-[10px]`
- **当前页**：`bg-white/[0.08]` + 1px `accent-robot` 外环（**不用电黄**，页码不是动作）
- 右端 11px text-muted："共 5 页 · 247 个"，tabular-nums

---

## 四、落地代码改动清单（不在本次范围，仅供后续 plan 参考）

### 4.1 文件级改动

| 文件 | 改动 |
|---|---|
| `client/src/plaza/HeroBanner.tsx` | **重写**：去掉紫调 radial + 3D SVG；改为液态玻璃父级 + 内层灰矩形 + 三栏统计 |
| `client/src/plaza/FeaturedCard.tsx` | **重写**：去掉金色边框 / 渐变标题 / 内嵌大图；改为液态玻璃父级 + 内层灰矩形 + 上图下文双层结构 |
| `client/src/plaza/RecommendCard.tsx` | **改 hover 态**：金色 box-shadow → `accent-robot` 1px 外环 |
| `client/src/plaza/data.ts` | **chip 颜色映射**：业务分类 → port 语义色 |
| `client/src/plaza/FilterBar.tsx` | **激活态**：电黄填充 → `glass-hi` + `accent-robot` 外环 |
| `client/src/plaza/Paginator.tsx` | **当前页**：电黄填充 → `glass-hi` + `accent-robot` 外环 |
| `client/src/plaza/TopBar.tsx` | （已经 OK）保留电黄 + 新建项目 CTA — 这是页面唯一电黄出口 |

### 4.2 新增依赖

- `LiquidGlass.tsx` 复用现有组件（不动 shader 默认参数）
- Hero 和 4 旗舰卡需要 5 个独立 shape 实例 — 实测帧率，若 < 50fps 则缩减到 Hero + 第一张 trending 卡的"2-shape 方案"作为兜底

### 4.3 圆角统一约束

新增常量：
```ts
// client/src/plaza/constants.ts
export const PLAZA_GLASS_RADIUS = 32;
```

所有液态玻璃父级 + 内层灰矩形必须从这个常量取，避免漂移。

---

## 五、视觉验证清单

### 5.1 铁律对齐
- [x] UI 灰阶化（无 chip 五色装饰）
- [x] 唯一电黄 = 右上 "+ 新建项目" CTA
- [x] 无 CSS gradient 装饰背景（Hero 紫调已删）
- [x] 无金色边框 / 金色 box-shadow（trending 改为电黄空心徽章）
- [x] 真液态玻璃 = WebGL2（Hero + 4 旗舰）；其余 CSS 玻璃
- [x] 父子圆角必须一致：32
- [x] 内层卡禁止渐变 / 内顶高光（实色 `#1E1E22`）
- [x] 数字 tabular-nums（Hero 统计 / 卡内 stats / 分页页码）
- [x] 字号 ≤ 22px（Hero 标题 22 是上限）
- [x] 字重在 400 / 500 / 600（无 700 营销字重）

### 5.2 信息架构对齐
- [x] 顶栏 → Hero → Filter → 4 旗舰 → 4 推荐 → 分页（顺序未变）
- [x] mock 数据 4 旗舰 + 4 推荐沿用前一 spec
- [x] 点击行为仅 console.log 占位（同前一 spec）

---

## 六、后续步骤建议

1. **用户确认 mockup 视觉** → 用浏览器打开 `D:\webProject\image2\.tmp\model-plaza-mockup.html` 验证细节
2. 若用户认可视觉 → 进入 `writing-plans` 流程，拆 6 个原子任务对齐落地代码改动：
   - (a) 抽常量 `PLAZA_GLASS_RADIUS = 32`
   - (b) 重写 `HeroBanner.tsx`
   - (c) 重写 `FeaturedCard.tsx`
   - (d) 调 `RecommendCard.tsx` hover 态
   - (e) 调 `FilterBar.tsx` + `Paginator.tsx` 激活态
   - (f) 改 `data.ts` chip 色映射
3. **不要批量改 React**：每一步独立可跑、独立可验证，按 DESIGN.md "克制" 原则一步步过
