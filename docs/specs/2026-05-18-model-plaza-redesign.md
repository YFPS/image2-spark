# 模型广场（Model Plaza）重写设计

- **日期**：2026-05-18
- **范围**：
  - 彻底重写 `client/src/ModelPlaza.tsx`，对齐新提供的设计图（右侧主体）
  - 拆分单文件为入口 + 6 个子组件 + 1 个数据/类型模块 + 1 个素材目录
  - 推荐卡视觉形态从横向紧凑卡 → 纵向 16:9 大图封面卡
  - 把 Filter chip 行从 Hero 内部移出，作为独立一行
  - 用 AI 现场生成 8 张 webp 素材（4 旗舰 + 4 推荐）
- **不在范围**：
  - 左侧导航 Shell（用户已明确不做）
  - 真实搜索 / 过滤逻辑（mock 数据量不足，仅 UI 占位）
  - 模型卡点击跳转节点画布（推后）
  - 接真实后端 API
  - 收藏状态持久化
  - 响应式拆段以下 480px（最低支持到 480px）

---

## 一、背景

`client/src/ModelPlaza.tsx`（520 行）已存在，通过 `main.tsx` 内 hash 路由 `#/plaza` 暴露。覆盖了顶栏 / Hero / 4 旗舰卡 / 4 推荐卡 / 分页器，但与新设计图相比有三处明显偏离：

1. **推荐卡形态错位**：当前是 96px 高的横向 list 卡（图 72×72 在左 + 文字在右），设计图是纵向 16:9 大图封面卡（图为主 + 底部黑色玻璃膜叠白字）
2. **Filter 位置错位**：当前 Filter chip 行嵌在 Hero banner 内部，设计图中 Filter 是 Hero 下方的独立一行
3. **单文件臃肿**：520 行单文件包含数据、所有子组件、所有 SVG icon，扩展和维护成本高

本次工作只动「右侧主体」，对齐设计图并完成架构清理。

---

## 二、关键决策记录

通过 brainstorming 已确认的决策：

| 决策点 | 选择 | 备注 |
|---|---|---|
| 改造范围 | **彻底重写** | 用户选 C，推翻当前 ModelPlaza 重新搭 |
| 数据源 | **Mock 常量** | 写在 `plaza/data.ts`，后续可平滑替换为 API |
| 素材生成 | **AI 现场生图** | 用 `draw-ui` skill 生成 8 张 webp 存到 `client/src/assets/plaza/` |
| 点击行为 | **仅 console.log** | 不接路由、不接业务逻辑，占位即可 |
| 左侧导航 Shell | **不做** | 仅做右侧主体页面效果 |

---

## 三、目标架构与文件结构

### 3.1 目录布局

```
client/src/
├─ ModelPlaza.tsx                     # 入口（~80 行）：组装 + state（filter/page/search）
├─ plaza/
│   ├─ types.ts                       # Featured / Recommend / Chip 类型
│   ├─ data.ts                        # FEATURED[] / RECOMMEND[] / FILTERS 常量
│   ├─ icons.tsx                      # 集中放 SVG icons
│   ├─ TopBar.tsx                     # 顶栏（搜索 / 筛选按钮 / 新建项目 CTA / 通知 / 头像）
│   ├─ HeroBanner.tsx                 # Hero 大标题 + 副标题 + 3D 装饰
│   ├─ FilterBar.tsx                  # Hero 下方独立 Filter chip 行
│   ├─ FeaturedGrid.tsx               # 4 张旗舰卡 grid 容器
│   ├─ FeaturedCard.tsx               # 单张旗舰卡（含 featured 高亮变体）
│   ├─ RecommendGrid.tsx              # 4 张推荐卡 grid 容器
│   ├─ RecommendCard.tsx              # 单张推荐封面卡（本次最大改动）
│   └─ Paginator.tsx                  # 分页器
└─ assets/plaza/
    ├─ featured-gpt.webp              # GPT IMAGE2（紫色星云）
    ├─ featured-banana.webp           # BANANA（暖橙香蕉）
    ├─ featured-nano.webp             # NANO（绿色赛车）
    ├─ featured-pro.webp              # PRO（粉紫雕塑）
    ├─ rec-vision.webp                # VISION XL
    ├─ rec-dreamer.webp               # DREAMER
    ├─ rec-chat.webp                  # CHAT MASTER
    └─ rec-multi.webp                 # MULTI MODAL
```

### 3.2 组件职责（每个 < 120 行）

| 文件 | 职责 |
|---|---|
| `ModelPlaza.tsx` | 持有 3 个 state（activeFilter / page / searchQuery），组装 6 个子组件，处理跨组件回调 |
| `TopBar.tsx` | 纯展示 + 受控 props（`searchQuery`, `onSearchChange`, `onNewProject`） |
| `HeroBanner.tsx` | 纯静态展示，含 SVG 3D 装饰 |
| `FilterBar.tsx` | 受控（`activeFilter`, `onFilterChange`, `options`） |
| `FeaturedGrid.tsx` | 接 `items` 渲染 4 个 `FeaturedCard`，处理 grid 布局 |
| `FeaturedCard.tsx` | 接 `card`、`onClick`；内部根据 `featured` 走金色高亮变体 |
| `RecommendGrid.tsx` | 接 `items` 渲染 4 个 `RecommendCard` |
| `RecommendCard.tsx` | 接 `m`、`onClick`、`onFavorite`；本次重做核心 |
| `Paginator.tsx` | 接 `page`、`total`、`onPageChange`；边界处禁用箭头 |

### 3.3 渲染顺序

```
┌─────────────────────────────────────────────────────────┐
│ <TopBar/>                                               │ ~56px
├─────────────────────────────────────────────────────────┤
│ <HeroBanner/>                                           │ ~220px
├─────────────────────────────────────────────────────────┤
│ <FilterBar/>                                            │ ~40px
├─────────────────────────────────────────────────────────┤
│ <FeaturedGrid items={FEATURED}/>                        │ ~260px
├─────────────────────────────────────────────────────────┤
│ 推荐模型 + 换一批                                       │
│ <RecommendGrid items={RECOMMEND}/>                      │ ~158px（16:9 大图）
├─────────────────────────────────────────────────────────┤
│ <Paginator page={page} total={5}/>                      │ ~40px
└─────────────────────────────────────────────────────────┘
```

外层容器：`mx-auto max-w-[1280px] px-8 py-6 bg-[#070708] text-white`。

---

## 四、数据 schema

### 4.1 类型定义（`plaza/types.ts`）

```ts
export type Chip = { label: string; color: string };

export type Featured = {
  id: string;
  title: string;            // "GPT IMAGE2"
  chip: Chip;
  desc: string;             // 支持 \n 多行
  stats: { hot: string; fav: string; calls?: string; speed: string };
  image: string;            // 本地 webp 路径
  featured?: boolean;       // 第一张高亮（金色边框 + 旗舰角标）
  badge?: string;           // 角标文字（仅 featured 用）
};

export type Recommend = {
  id: string;
  title: string;            // "VISION XL"
  chip: Chip;
  desc: string;
  hot: string;
  speed: string;
  image: string;
};
```

### 4.2 Mock 常量（`plaza/data.ts`）

沿用当前 ModelPlaza.tsx 的文案与统计数字（GPT IMAGE2 / BANANA / NANO / PRO + VISION XL / DREAMER / CHAT MASTER / MULTI MODAL），只把 `bg` / `thumb` 改成 `image: '/src/assets/plaza/xxx.webp'`（Vite 通过 `import bgGpt from '../assets/plaza/featured-gpt.webp'` 方式引入，方便构建期处理）。

### 4.3 Chip 颜色一致性

| chip.label | color |
|---|---|
| 图像生成 | `#A78BFA`（紫） |
| 对话模型 | `#67E8F9`（青） |
| 高速模型 | `#7CE38B`（绿） |
| 专业版 | `#F0FE2D`（电黄） |
| 多模态 | `#FF7E87`（粉） |

---

## 五、视觉规格

### 5.1 顶栏 `TopBar`

| 元素 | 规格 |
|---|---|
| 高度 | 40px（h-10） |
| 页面标题 | 22px 粗体，`bg-gradient-to-r from-white to-white/55 bg-clip-text text-transparent` |
| 搜索框 | flex-1 居中，胶囊圆角，左侧 search icon |
| 筛选/排序按钮 | h-10 圆角胶囊，灰边框 |
| 新建项目 CTA | 金黄填充 + 黑字，`shadow-[0_0_24px_rgba(240,254,45,0.35)]` |
| 通知 | h-10 w-10 圆形，右上红点 |
| 头像 | h-10 w-10 圆形，`conic-gradient` |

### 5.2 Hero `HeroBanner`

| 元素 | 规格 |
|---|---|
| 高度 | 220px |
| 圆角 | 20px |
| 背景 | 紫调 radial-gradient + 右上橙色光晕叠层 |
| 主标题 | 26px 粗白字，drop-shadow 紫色光晕 |
| 副标题 | 13px 白 55% |
| 3D 装饰 | 内嵌 SVG，右侧 40% 区域，紫色立方体堆叠 |
| **不包含** | Filter chip 行（已移出） |

### 5.3 FilterBar

| 元素 | 规格 |
|---|---|
| 容器 | 独立一行，gap-2，pt-1 |
| chip（未激活） | h-8 圆角胶囊，灰边框，白 70% |
| chip（激活） | 金黄填充 + 黑字，金色光晕 |

### 5.4 FeaturedCard

| 元素 | 规格 |
|---|---|
| 容器 | h-[260px] 圆角 16px，背景 = `<img>` 铺满 |
| Grid 列宽 | `1.42fr 1fr 1fr 1fr`（第一张更宽） |
| 底部渐隐 | `from-black/85 via-black/35 to-transparent` |
| 标题 | featured: 26px 粉紫渐变 clip 字；普通: 22px 白字 |
| chip | 卡片下半部 |
| 描述 | 12px 白 65% |
| stats | 11px 白 55%，icon + 标签 + 数值 |
| featured 专属 | 左上"热门推荐"胶囊、右侧"旗舰模型 👑"角标、底部金黄发丝细线、金色边框 |

### 5.5 RecommendCard（本次最大改动）

| 元素 | 规格 |
|---|---|
| 容器 | 16:9 横版，aspect-[16/9]，圆角 14px |
| 背景 | `<img>` 铺满 + 黑色底部渐隐 |
| 顶层叠加 | `from-black/85 via-black/40 to-transparent` |
| 标题位置 | 左下角内边距 12px |
| 标题 | 16px 粗白字，drop-shadow 黑色阴影增加可读 |
| chip | 标题上方一行（小尺寸 chip） |
| 描述 | 11px 白 65%，单行截断（`truncate`） |
| 收藏 ⭐ | 右上角，白 35% → hover 金黄，stopPropagation |
| 状态条 | 底部 1px 浅金色细线，opacity-0 → hover 时 opacity-100 |
| Hover | 卡片 `scale-[1.02]` + 金色 box-shadow |

### 5.6 Paginator

| 元素 | 规格 |
|---|---|
| 按钮 | h-8 w-8 圆角 10px |
| 当前页 | 金黄填充 + 黑字 |
| 非当前页 | 透明边框 + 白 70% |
| 箭头 | 边界处 opacity-30 + disabled |

---

## 六、交互与边界

### 6.1 state 管理（入口）

```ts
const [activeFilter, setActiveFilter] = useState<string>("全部");
const [page, setPage] = useState(1);
const [searchQuery, setSearchQuery] = useState("");
```

**边界规则**：
- `activeFilter` 受控为 `FILTERS` 数组成员
- `page` 强制 `Math.max(1, Math.min(TOTAL_PAGES, p))`
- `searchQuery` 仅 input 受控，**不参与过滤逻辑**

### 6.2 点击行为

| 元素 | 行为 |
|---|---|
| FeaturedCard | `console.log('[plaza] featured selected', card.id)` |
| RecommendCard | `console.log('[plaza] recommend selected', card.id)` |
| RecommendCard 右上 ⭐ | `stopPropagation()` + `console.log('[plaza] favorite toggled', card.id)` |
| FilterBar chip | `setActiveFilter(chip)` |
| Paginator | `setPage(n)` |
| "+ 新建项目" CTA | `console.log('[plaza] new project')` |
| 顶栏头像/通知 | `console.log` 占位 |
| 推荐区"换一批" | `console.log('[plaza] refresh recommend')` |

### 6.3 视觉/数据边界与回退

| 场景 | 处理 |
|---|---|
| 图片加载失败 | `<img onError>` 切到 CSS 渐变 fallback（按 chip.color 染色），文字仍可读 |
| 图片加载中 | 容器先有低饱和度渐变占位 + `loading="lazy"`（首屏 4 旗舰图 eager） |
| RECOMMEND 数组为空 | RecommendGrid 渲染"暂无推荐"占位（不崩溃） |
| 窄屏（< 1024px） | 旗舰卡 grid 退为 2 列；推荐卡 2 列；顶栏 search 收成图标 |
| 窄屏（< 768px） | 旗舰卡 / 推荐卡都 1 列 |
| 超宽屏（> 1600px） | 整体 `max-w-[1280px] mx-auto` 居中 |
| 键盘可达 | 所有可点击的 `<article>` 用 `<button>` 或 `role="button" tabIndex={0} + onKeyDown(Enter/Space)` |
| chip 对比度 | 浅 chip（电黄）配 12% 黑底，对比度 ≥ 4.5:1 |

### 6.4 性能

- 8 张 AI 图压到 webp，旗舰 800×600 ≤ 250KB，推荐 640×360 ≤ 150KB
- `<img decoding="async" />`，前 4 张旗舰 `loading="eager"`，推荐 `loading="lazy"`
- 不引入新依赖
- 所有动画走 CSS transition

### 6.5 不破坏现有项目

- 不动 `App.tsx`、`main.tsx`、hash 路由
- 沿用 `tailwind.config.js` 中的 `accent-foxo` / `accent-ptext`
- 不影响 `AuthGate` 包装

---

## 七、验证清单

### 7.1 视觉对照
- [ ] 顶栏间距、搜索框宽度、CTA 圆角胶囊与设计图一致
- [ ] Hero 高 ~220px，右侧 3D 装饰可见，**Hero 内不含 Filter 行**
- [ ] FilterBar 在 Hero 下方独立一行
- [ ] 4 旗舰卡比例为 `1.42 : 1 : 1 : 1`，第一张更宽 + 金色高亮
- [ ] 推荐卡**纵向 16:9 大图卡**（不是横向 list），底部黑色玻璃膜叠白字
- [ ] 分页器：当前页金黄填充 + 黑字

### 7.2 交互
- [ ] 切换 filter chip，激活样式切换
- [ ] 切换分页，活动页码切换；边界处箭头禁用
- [ ] 点击模型卡，console 输出对应 id
- [ ] 点击推荐卡右上 ⭐，不触发整卡点击
- [ ] 搜索框可输入

### 7.3 响应式
- [ ] 1440px 桌面：4 列布局完整
- [ ] 1024px：4 列收缩 padding，文字不溢出
- [ ] 768px：旗舰卡 2 列，推荐卡 2 列
- [ ] 480px：全 1 列

### 7.4 健壮性
- [ ] 临时改一张图 src 为不存在路径，验证渐变 fallback 生效
- [ ] 临时把 RECOMMEND 清空，页面不崩溃
- [ ] DevTools 无 React warning，无 404，无 console.error

### 7.5 集成
- [ ] `/` 仍能进入节点画布（App.tsx 未受影响）
- [ ] `/#/plaza` 进入新版广场
- [ ] AuthGate 仍然正常拦截未登录

### 7.6 验证工具

用 `web-e2e-testing-with-chrome-devtools-mcp` skill 自动化验证：
1. 启动 dev server（`npm run dev` on 5173）
2. 在浏览器导航到 `http://localhost:5173/#/plaza`
3. 截图对照设计图
4. 触发点击事件，验证 console 输出
5. 调整 viewport 验证响应式

---

## 八、Hash 路由与素材接入

### 8.1 路由（无变化）

`main.tsx` 现有逻辑保持：
```ts
if (hash.startsWith("#/plaza")) return <ModelPlaza />;
return <App />;
```

### 8.2 素材生成步骤

1. 用 `draw-ui` skill（内置 GPT Image 2）按 8 张 prompt 生成：
   - `featured-gpt`：紫色星云背景，神秘几何元素，1024×768
   - `featured-banana`：暖橙色香蕉静物，电影感打光，1024×768
   - `featured-nano`：翠绿赛车，速度感模糊，1024×768
   - `featured-pro`：希腊雕塑头像，粉紫氛围光，1024×768
   - `rec-vision`：写实人像特写，1024×576
   - `rec-dreamer`：梦幻超现实场景，1024×576
   - `rec-chat`：神秘人像/AI 拟人，1024×576
   - `rec-multi`：多模态视觉拼贴，1024×576
2. 用 sharp 或在线工具压成 webp，目标尺寸 ≤ 250KB（旗舰）/ ≤ 150KB（推荐）
3. 存到 `client/src/assets/plaza/`
4. `plaza/data.ts` 用 ES module import 引用：
   ```ts
   import bgGpt from '../assets/plaza/featured-gpt.webp';
   ```

### 8.3 素材生成失败的兜底

若 AI 生图阶段失败，可临时复用现有 ModelPlaza 的 CSS 渐变占位（注释保留替换点），不阻塞结构落地。

---

## 九、实施顺序（writing-plans 输入）

建议拆 7 个原子任务，顺序如下：

1. 建 `client/src/plaza/` 目录与 `types.ts` + 空 `data.ts`
2. 把现有 mock 数据迁到 `data.ts`（保留渐变作为图片 fallback，先不接图）
3. 抽 SVG 到 `icons.tsx`
4. 拆出 `TopBar` / `HeroBanner` / `FilterBar` / `Paginator`
5. 拆 `FeaturedGrid` / `FeaturedCard`（视觉不动）
6. **重写** `RecommendGrid` / `RecommendCard`（纵向 16:9 封面卡）
7. AI 生 8 张素材 → 接入 `data.ts` → 验证清单 7.1–7.5

每一步结束都能跑起来，可单独验证。
