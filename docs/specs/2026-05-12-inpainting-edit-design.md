# 局部精准编辑（Inpainting / Mask Edit）设计

- **日期**：2026-05-12
- **目标**：Generate 页结果图上点 ✎ 编辑 → 用画笔/套索涂出 mask → 写 prompt → 调 `gpt-image-2 /v1/images/edits` 重绘 mask 区域
- **范围**：
  - 后端新增 `POST /api/images/edit`（multipart 转发到上游 /edits）
  - 前端 `ImageEditModal`，复用 cropper 壳；工具：画笔 / 套索 / 橡皮擦 / 笔触大小
  - 编辑历史栈：右侧缩略图列表，可一键回退到任意版本（含原图）
  - mask 语义遵循 OpenAI：**alpha=0 区域=要 AI 重画**，alpha=255 区域=保留原样
- **不在范围**：
  - 魔棒（按颜色自动选区）
  - 撤销 / 重做单笔
  - 实时预览（仅在提交时调 API）

---

## 一、用户流程

1. Generate 出图 → hover 结果图 → 看到三个按钮：✂ 抠图 / ✎ 编辑 / 🔍 预览
2. 点 ✎ 编辑 → 全屏 `ImageEditModal`
3. 顶栏选工具（画笔默认）+ 调笔触大小
4. 在源图上**涂抹/围圈**要修改的区域 — 黄色半透明覆盖层显示选中区
5. 右侧底部输入 prompt（如"换成红苹果，保持光影"）
6. 点 **提交编辑** → 转 spinner + 顶部"思考中"
7. 上游返回新图 → 替换源图，新版本进入右侧历史列表
8. 用户可继续编辑这版，或点历史缩略图回到任意旧版
9. 关闭 modal：当前版本回写到 Generate 页 Results 卡

---

## 二、后端 API

### 2.1 `POST /api/images/edit`

`multipart/form-data`，字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | file (PNG/WebP) | ✓ | 源图，与 mask 同尺寸 |
| `mask` | file (PNG, alpha) | ✓ | alpha=0 区域=要重画；alpha=255=保留 |
| `prompt` | string | ✓ | 修改描述（重点描 mask 区） |
| `model` | string | — | 默认 `gpt-image-2`，后端按 size 自动选 vip / vip-4k |
| `n` | int | — | 默认 1 |
| `size` | string | — | 默认 `auto`，前端可传 `1024x1024` 等 |
| `quality` | string | — | 默认 `low` |

> `response_format` **不传**：gpt-image-2 官方语义是永远返回 `b64_json`；本中转可能返回 `url`，后端透传两种 case（同 generate 路由处理）。

**Response 200**（JSON，复用 generate 的形状）：

```json
{
  "images": [{"url": null, "b64_json": "..."}],
  "usage": { "input_tokens": ..., "output_tokens": ..., "total_tokens": ... },
  "model": "gpt-image-2"
}
```

**Response 4xx/5xx**：复用 `ErrorResponse` 形状。

### 2.2 实现要点

- FastAPI `UploadFile` 接收 image / mask；用 httpx multipart 转发到上游 `${OPENAI_BASE_URL}/images/edits`
- 复用 `openai_client` 的鉴权 + 超时 + 错误转换
- 模型 override：与 generate 一致，按 size 自动选 vip / vip-4k
- 不缓存（每次都是新内容）

---

## 三、前端

### 3.1 入口

`ResultImage` hover bar 从 2 按钮 → **3 按钮**（✂ 抠图 / ✎ 编辑 / 🔍 预览），间距与现有 `gap-2` 一致。新增 `EditIcon`（铅笔）。

`SimpleGenerateView` 新增 state：

```typescript
const [editSrc, setEditSrc] = useState<string | null>(null);
```

modal 关闭时调 `onCommit(newSrc?)`，把最终版本写回当前 `results[i]`（替换该位 image 的 url / b64）。

### 3.2 ImageEditModal 布局（复用 cropper 壳）

```
┌──────────────────────────────────────────────────────────────────┐
│ ✎ 编辑工具 │ [画笔][套索][橡皮] │ 笔触: ───●─── 32 │ 撤销选区 │ ✕ │
├─────────────────────────────────────┬────────────────────────────┤
│                                     │  历史版本                  │
│   源图 + 半透明黄色 mask 覆盖层     │  ┌─────┐ 原图              │
│                                     │  │ 缩  │                  │
│   [鼠标按下涂抹/围圈]                │  └─────┘ ★ active          │
│                                     │  ┌─────┐ v1                │
│                                     │  │ 缩  │ 红苹果替换         │
│                                     │  └─────┘                  │
│                                     │  ┌─────┐ v2                │
│                                     │  │ 缩  │ 改色为绿          │
│                                     │  └─────┘                  │
│                                     │                            │
│                                     ├────────────────────────────┤
│                                     │  Prompt 输入区             │
│                                     │  [描述对 mask 区域的修改]    │
│                                     │  [提交编辑 (黄按钮)]        │
└─────────────────────────────────────┴────────────────────────────┘
```

- 整体壳：`fixed inset-0 z-[100] bg-black/82 backdrop-blur-md`，主面板 `max-w-[1280px] max-h-[88vh]`，与 cropper 完全对齐
- 工具按钮：胶囊型，激活态用 `bg-white/[0.10] + ring`
- 笔触大小：滑条 4–80 px
- 历史列表：每行 thumb（CSS background-position 切图）+ 文件名/标题 + 点击切换

### 3.3 工具行为

#### 画笔
- `mousedown` → 进入绘制；记录起点
- `mousemove` → 在 mask canvas 上画圆形笔触线（lineWidth=笔触大小，lineCap=round）
- `mouseup` → 结束本笔
- 半透明黄色在屏幕上显示，但 **mask 输出 canvas** 上记录的是 **alpha 通道**（实际是 BG=255 + erase 出 alpha=0 区）

#### 套索
- `mousedown` → 开始；记录第一个点
- `mousemove` → 持续记录路径点（连成多边形预览）
- `mouseup` → 闭合多边形 → fill 到 mask
- 同一支 mask canvas，alpha 区累加

#### 橡皮擦
- 与画笔形态相同，但反向操作：在 mask canvas 上**补回 alpha**（取消选中）

#### 撤销选区
- 一次性清空整张 mask（不实现单笔撤销）

### 3.4 mask 生成

`maskCanvas` 与源图自然像素同尺寸：
- 初始：纯白不透明（RGBA = 255,255,255,255）→ 这是"全部保留"的语义
- 用户画笔涂抹：在涂抹处设置 `globalCompositeOperation = "destination-out"`，把 alpha 抹到 0 → 这块就是"要重画"
- 屏幕显示用一张 displayCanvas，跟 maskCanvas 同步但叠加黄色 tint，让用户能看见

提交时 `maskCanvas.toBlob("image/png")` → 直接是符合 OpenAI 语义的 mask（透明=改 / 不透明=保）。

### 3.5 历史栈

```typescript
type Version = {
  id: string;
  src: string;        // url or data: URI
  prompt?: string;    // 这版对应的 prompt（v0 = 原图，无 prompt）
  thumb?: string;     // 缩略图同 src
};

const [versions, setVersions] = useState<Version[]>([
  { id: "v0", src: initialSrc, prompt: undefined },
]);
const [activeIdx, setActiveIdx] = useState(0);
```

- 提交编辑成功 → push 新版本 → `setActiveIdx(versions.length)`
- 点历史缩略图 → 切换 activeIdx → 加载该版本图，**清空 mask**
- 在该版本继续编辑会基于该版本图新生成下一版（线性历史，不分支）

### 3.6 提交流程

```typescript
async function handleSubmit() {
  const currentImgBlob = await fetchAsBlob(activeSrc);    // 当前版本图
  const maskBlob = await new Promise<Blob>(res => maskCanvas.toBlob(res, "image/png"));
  const form = new FormData();
  form.append("image", currentImgBlob, "image.png");
  form.append("mask", maskBlob, "mask.png");
  form.append("prompt", prompt);
  form.append("size", "auto");
  form.append("quality", "low");
  const resp = await fetch("/api/images/edit", { method: "POST", body: form });
  // ... 解析响应、push 到 versions、setActiveIdx
}
```

### 3.7 modal 关闭语义

- 用户 ✕ 关闭 → 把**当前 active 版本**作为最终结果通过 `onCommit(activeSrc)` 回传父组件
- ESC 关闭 → 同上
- 父组件用此 src 替换 results 数组中当前正在编辑的那张

---

## 四、坐标系与尺寸

- 源图 `naturalSize` = 上游图原尺寸（如 1254×1254）
- 显示用 `<img>` 缩放到 max 70vh × 60vw（同 cropper）
- mask canvas 创建在 naturalSize（与源图同尺寸）
- 鼠标事件用 cropper 已有的 `screenToNatural` 换算

**注意**：OpenAI /edits 要求 image 与 mask 同尺寸。后端不做尺寸调整，前端必须保证 maskCanvas.size === sourceImg.naturalSize。

---

## 五、UI 视觉规范

- 笔触圆形 outline cursor（覆盖在源图上跟随鼠标）：黄色 1px outline，半径=笔触/2
- mask 覆盖层：`rgba(204, 255, 0, 0.32)` 半透明黄
- 套索预览路径：黄色虚线 1.5px
- 历史项 active：黄色左竖条 + 浅白 hover
- 提交按钮 disable 条件：mask 全空 OR prompt 为空 OR exporting

---

## 六、依赖

无新增。复用现有 jszip 不需要；canvas、FormData、Blob 都是浏览器内置。

后端无新增依赖（FastAPI `UploadFile` + httpx multipart 已经在依赖图里）。

---

## 七、性能 / 限制

- 单次 /edits 调用 = 一次完整的图像生成，耗时 ~30 s（同 generate）
- 4K 源图 mask canvas = 4K × 4 通道 = 60 MB，浏览器可承受
- 多次 edit 不会膨胀，每次都是替换式
- 历史栈仅保 src（url 或 data URI），不重复存图像数据

---

## 八、验收清单

- [ ] ResultImage hover 出现 3 个按钮（✂ ✎ 🔍）
- [ ] 点 ✎ 编辑打开 modal；源图加载（通过 proxy-image 解 CORS）
- [ ] 画笔工具：拖动鼠标涂出黄色 mask，圆形笔触跟随
- [ ] 套索工具：拖动画出多边形，松开闭合 + 填充
- [ ] 橡皮擦工具：在已涂区域擦除回原图
- [ ] 笔触大小 4–80 实时影响下一笔
- [ ] 撤销选区按钮一键清 mask
- [ ] 提交编辑：转 spinner + 顶部"思考中"动画
- [ ] 上游返回成功：源图替换为新图，历史多一项缩略图（active 自动切到新版）
- [ ] 历史缩略图点击：切回该版本图，mask 自动清空
- [ ] 关闭 modal：当前版本回写到 Generate Results 卡
- [ ] 浏览器无 console 报错；Generate 主页布局未变

---

## 九、已知限制

- 无单笔撤销（仅整体清 mask）
- 无图层化 mask（每次提交后旧 mask 被清空）
- 无实时预览（必须提交才看到改后效果）
- 历史最多保 20 版（超出旧版自动剔除，避免内存暴涨）
- size=auto 时上游决定输出尺寸；若不等于源图尺寸会出现"裁剪偏差"，但 OpenAI 的 /edits 默认尊重 image 尺寸所以一般不会有问题
