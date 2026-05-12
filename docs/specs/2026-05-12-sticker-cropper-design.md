# 抠图工具（Sticker Cropper）设计

- **日期**：2026-05-12
- **范围**：
  - Generate 页结果图 hover 操作栏新增"抠图"按钮
  - 全屏 `StickerCropperModal`：在源图上鼠标框选矩形 → 每个矩形导出独立 PNG 带透明背景 → ZIP 打包下载
  - 后端新增 `/api/images/proxy-image` 反代上游 CDN 图，解决 canvas 跨域 taint
- **不在范围**：
  - AI 语义抠图（ML 分割模型）
  - 选区编辑后再次修改（拖拽 / 缩放选区）
  - 非白底图像的抠图（如复杂背景），本期仅以"白→透明阈值"覆盖白底贴纸场景

---

## 一、用户故事

1. 用户在 Generate 页点击右上角"抠图"按钮（hover 在结果图上时出现）
2. 全屏 modal 打开，中央是源图，右侧空选区列表
3. 用户在图上**拖动鼠标**画矩形，每画一个出现在右侧列表，名为 `sticker-1.png / sticker-2.png ...`
4. 用户可对单个选区点"×"删除
5. 顶栏有"白→透明阈值"滑条（默认 240，可在 200–250 调）
6. 顶栏有"下载 ZIP"按钮：把所有选区切片 + 白→透明处理 + JSZip 打包 → 浏览器下载 `stickers.zip`
7. ESC 或点关闭按钮关闭 modal，**选区状态丢弃**（不持久化）

---

## 二、入口按钮

`ResultImage` 组件 hover 时已有放大预览按钮。新增"抠图"按钮：

- 位置：放大预览按钮左侧（同 `right-3 top-3`，水平排开）
- 图标：剪刀 `<ScissorsIcon />`
- 行为：调用 `onCropper?.(src)` 回调（与现有 `onPreview` 类似）
- 父组件 SimpleGenerateView 维护 `cropperSrc: string | null` state；非空时挂载 `<StickerCropperModal>`

只有 `src` 可用（有 url 或 b64_json）时才显示该按钮。

---

## 三、StickerCropperModal 布局

```
┌──────────────────────────────────────────────────────────────────┐
│ 顶栏：✂ 抠图工具  |  阈值滑条 240  |  框选张数 3  | 下载 ZIP | ✕ │
├─────────────────────────────────────┬────────────────────────────┤
│                                     │  选区列表                  │
│   ┌───────┐                         │  ┌─────────┐ sticker-1     │
│   │选区1 │                         │  │ thumb   │ 256×256       │
│   └───────┘                         │  │         │  ×            │
│                                     │  └─────────┘               │
│   源图（max 70vw × 80vh，等比）     │  ┌─────────┐ sticker-2     │
│                                     │  │ thumb   │ 200×300       │
│   ┌─────────┐                       │  │         │  ×            │
│   │选区2   │                       │  └─────────┘               │
│   └─────────┘                       │                            │
│                                     │  ...                       │
└─────────────────────────────────────┴────────────────────────────┘
```

- **遮罩**：`fixed inset-0 z-[100] bg-black/82 backdrop-blur-md`，flex 居中布局
- **主面板**：`max-w-[1280px] max-h-[88vh]`，圆角 28，bg `#0E0E11`
- **顶栏**：高 56，下边界 1px white/[0.06]
- **中央画布区**：`<div ref={canvasWrapRef}>` 包含 `<img>`（背景）+ `<div>` 选区覆盖层（绝对定位）
- **右侧列表**：宽 280，overflow-y-auto，每行 80 高（缩略图 + 信息 + 删除）
- **缩略图生成方式**：用 `<div>` + 同源图 `background-image`，配合 `background-position` 与 `background-size` 实现 CSS 切片缩放，**不需要运行时 canvas**，性能好且实时。
- **导出 UX**：导出进行中（生成 zip 期间）顶栏"下载 ZIP"按钮换成 spinner + 文案"打包中…"，整个 modal 阻塞关闭（防止用户误关丢失状态）

---

## 四、框选交互

**坐标系**：相对于源图自然像素（natural pixels），UI 显示时按缩放比换算。

State：
```typescript
type Selection = { id: string; x: number; y: number; w: number; h: number };
const [selections, setSelections] = useState<Selection[]>([]);
const [drawing, setDrawing] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
```

事件：
- `onMouseDown` on 画布区：记录 startX/Y，进入 drawing 模式
- `onMouseMove`：更新 curX/Y，绘制临时矩形
- `onMouseUp`：若 `|w| ≥ 16 && |h| ≥ 16` 则提交为新选区（id = `crypto.randomUUID()` 或递增），否则取消
- `onMouseLeave`：取消 drawing
- 选区 framework：绝对定位 `<div>`，黄边 + 半透明黄底；右上角小 ✕ 删除

像素↔显示坐标换算：
- 显示图实际尺寸：`imgEl.offsetWidth` × `imgEl.offsetHeight`
- 源图自然尺寸：`imgEl.naturalWidth` × `imgEl.naturalHeight`
- 比例 = naturalW / offsetW
- 鼠标坐标 → 自然坐标：`(clientX - rect.left) * 比例`

---

## 五、导出（自动物体分割 + 白→透明 + ZIP）

### 设计原则

用户的矩形只是**种子提示**，不是最终裁剪边界。算法要做到：

1. **自行判断物体**：基于"非白"像素识别前景
2. **自动补全边缘**：即使矩形漏了部分边缘，也要把整个物体抠出来
3. **紧凑输出**：最终 PNG 的尺寸 = 物体真实 bbox（不含额外白边）

### 5.1 算法流程（segmentObject）

```
输入：srcImg、userSel（自然像素矩形）、threshold

Step 1 — 搜索窗：
  把 userSel 向四周各扩 max(rectEdge × 1.0, 64px)，钳到图边。
  这是 BFS 允许"溢出"用户矩形扩展的区域。

Step 2 — 像素读取：
  在 searchCanvas 上 drawImage(src, searchWindow → 0,0,sw,sh)，
  getImageData 得到 RGBA。

Step 3 — 前景判定 isFG(idx)：
  RGB 三通道最小值 < fgThreshold（fgThreshold = max(180, threshold - 20)）
  注：用比白→透明更松的阈值，确保反走样边缘像素也被计入前景，
  避免 BFS 在物体抗锯齿边缘断裂。

Step 4 — 连通分量种子 + 图遍历：
  在 searchData 内仅遍历 userSel 区域，每遇到 isFG 且未 visited 的像素，
  作为种子启动 4-邻接 遍历（用 number[] 数组 + push/pop 实现栈/DFS 语义，
  内存比 FIFO 队列更省），整张图共享一个 visited mask 与一个 bbox 聚合器。
  遍历可越出 userSel 边界但**不可越出 searchData 边界**，
  自然把所有"连到种子的前景像素"全部囊括，且 bbox 在出 pop 时流式累加 min/max。

Step 5 — 软边距 + 第二次裁剪：
  把 detectedBbox 向四周再扩 4px（钳到 searchData 边界），
  从 searchCanvas 裁剪到 finalCanvas（自然像素尺寸即输出像素）。

Step 6 — 白→透明（平滑过渡）：
  for each pixel in finalCanvas:
    minRGB = min(r, g, b)
    if minRGB >= threshold:
      dist = 255 - minRGB
      range = 255 - threshold
      alpha = round((dist / range) × 255)   // minRGB==threshold → 255, minRGB==255 → 0
    else:
      keep alpha
  putImageData。

Step 7 — toBlob("image/png") 返回。

兜底：若 Step 4 未找到任何前景种子（用户矩形完全落在白背景里），
回退到"按 userSel 直接裁剪 + 白→透明"。
```

### 5.2 参数一览

| 参数 | 值 | 说明 |
|---|---|---|
| `searchPadding` | `max(edge × 1.0, 64)` | 搜索窗扩展量，给 BFS 越界生长的空间 |
| `fgThreshold` | `max(180, threshold - 20)` | 前景判定阈值，比白→透明阈值更松 |
| `softPad` | `4 px` | 物体 bbox 再加的软边距 |
| `connectivity` | `4` | 4-邻接（上下左右） |

### 5.3 复杂度 / 性能

- 搜索窗大小 ~ `(userSel × 3)`，典型 sticker `≤ 1024 × 1024 ≈ 1M px`
- 图遍历 4-邻接 + Uint8Array visited mask，单选区耗时 **< 80ms**
- N 个选区线性叠加；ZIP 打包另需 ~100ms / 张
- 队列结构用 `number[]` push/pop 实现（DFS 语义，内存比 BFS 队列省）

### 5.4 单选区导出（伪代码 → TypeScript 实操）

```typescript
async function exportSelection(
  srcImg: HTMLImageElement,
  userSel: Selection,
  threshold: number,
): Promise<Blob | null> {
  // 1. 搜索窗（自然像素坐标）
  const pad = Math.max(Math.max(userSel.w, userSel.h) * 1.0, 64);
  const sx = Math.max(0, userSel.x - pad);
  const sy = Math.max(0, userSel.y - pad);
  const sx2 = Math.min(srcImg.naturalWidth, userSel.x + userSel.w + pad);
  const sy2 = Math.min(srcImg.naturalHeight, userSel.y + userSel.h + pad);
  const sw = Math.round(sx2 - sx);
  const sh = Math.round(sy2 - sy);

  // 2. 读 searchCanvas 像素
  const searchCanvas = document.createElement("canvas");
  searchCanvas.width = sw;
  searchCanvas.height = sh;
  const sctx = searchCanvas.getContext("2d");
  if (!sctx) return null;
  sctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, sw, sh);
  const imgData = sctx.getImageData(0, 0, sw, sh);

  // 3. BFS 连通分量，仅从 userSel 内部种子启动
  const userInData = {
    x0: Math.max(0, Math.floor(userSel.x - sx)),
    y0: Math.max(0, Math.floor(userSel.y - sy)),
    x1: Math.min(sw, Math.floor(userSel.x + userSel.w - sx)),
    y1: Math.min(sh, Math.floor(userSel.y + userSel.h - sy)),
  };
  const fgThreshold = Math.max(180, threshold - 20);
  const bbox = bfsBBox(imgData, userInData, fgThreshold);

  // 4. 兜底
  if (!bbox) return fallbackExport(searchCanvas, userInData, threshold);

  // 5. softPad + 二次裁剪到 finalCanvas
  const softPad = 4;
  const fx = Math.max(0, bbox.x0 - softPad);
  const fy = Math.max(0, bbox.y0 - softPad);
  const fx2 = Math.min(sw, bbox.x1 + softPad + 1);
  const fy2 = Math.min(sh, bbox.y1 + softPad + 1);
  const fw = fx2 - fx;
  const fh = fy2 - fy;
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = fw;
  finalCanvas.height = fh;
  const fctx = finalCanvas.getContext("2d");
  if (!fctx) return null;
  fctx.drawImage(searchCanvas, fx, fy, fw, fh, 0, 0, fw, fh);

  // 6. 白 → 透明
  whiteToAlpha(fctx, fw, fh, threshold);

  // 7. PNG blob
  return new Promise((res) => finalCanvas.toBlob((b) => res(b), "image/png"));
}
```

### 5.5 ZIP 打包

```typescript
import JSZip from "jszip";
const zip = new JSZip();
for (let i = 0; i < selections.length; i++) {
  const blob = await exportSelection(srcImg, selections[i], threshold);
  if (blob) zip.file(`sticker-${i + 1}.png`, blob);
}
const out = await zip.generateAsync({ type: "blob" });
// 触发下载（同前）
```

### 5.2 ZIP 打包

```typescript
import JSZip from "jszip";
const zip = new JSZip();
for (let i = 0; i < selections.length; i++) {
  const blob = await exportSelection(srcImg, selections[i], threshold);
  zip.file(`sticker-${i + 1}.png`, blob);
}
const out = await zip.generateAsync({ type: "blob" });
// 触发下载
const url = URL.createObjectURL(out);
const a = document.createElement("a");
a.href = url; a.download = "stickers.zip"; a.click();
URL.revokeObjectURL(url);
```

---

## 六、CORS / Taint 处理

`ctx.getImageData` 对跨域图片会抛 `SecurityError`（canvas 被 taint）。

- 当源图是 **`b64_json` 数据 URI** → 无 CORS 问题 ✅
- 当源图是 **上游 CDN url**（如 `pro.filesystem.site/...`）→ 需要 CORS 头

**方案**：后端新增 `GET /api/images/proxy-image?url=<encoded>`：
1. 接收编码 URL
2. 用 httpx 拉上游图片字节
3. 返回 `image/png` （或上游 Content-Type），加上 CORS 头（CORS middleware 已配置）
4. 前端 cropper 中 `<img crossOrigin="anonymous" src={proxyUrl}>` 加载

**安全**：限制 url 必须是 https 且包含已知 host 白名单（避免变 SSRF）：
- 白名单：`pro.filesystem.site`、`oaidalleapiprodscus.blob.core.windows.net`、`oai-images.openai.com`
- 或允许任意 https + 限制 Content-Type 必须是 `image/*`

本期：限制必须 `image/*`，host 不做白名单（开发环境用足够）。后续生产时白名单。

前端在 Cropper 入口时：
- 若 src 是 `data:` → 直接用
- 若是 http(s) → 包成 `/api/images/proxy-image?url=${encodeURIComponent(src)}`

---

## 七、依赖

`client/package.json` 新增：
- `jszip@^3.10.1`

不引入 `file-saver`，自己用 `URL.createObjectURL + <a download>` 触发。

---

## 八、UI 视觉风格

- 选区描边：1.5px solid `#CCFF00`（accent-foxo）+ 0.5px outline rgba(0,0,0,0.4) 保证在浅图上可见
- 选区填色：`rgba(204,255,0,0.10)`
- 当前正在拖的临时矩形：虚线描边
- 右侧列表项：`#141418 + 1px white/[0.04]` 卡片，悬停淡白
- 顶栏按钮组：与现有 Generate 页统一胶囊风格

---

## 九、性能 / 资源

- 上传过来的源图可能是 4K（3840×3840），canvas 操作需注意 OOM
  - 显示用 `<img>` 由浏览器自动缩放，无问题
  - 导出时 `canvas` 大小等于选区**自然像素**，最大不超过 3840×3840，4 通道约 60MB ImageData，仍在浏览器承受范围
- ZIP 生成可能 5–30 秒（取决于选区数 + 大小），导出期间禁用"下载 ZIP"按钮 + 显示 spinner

---

## 十、验收清单

- [ ] ResultImage hover 出现两个按钮：✂ 抠图 / 🔍 预览
- [ ] 点击抠图按钮打开全屏 modal，源图正确显示
- [ ] 鼠标拖动 → 出现黄色虚线矩形 → 释放后变实线矩形 + 进入右侧列表
- [ ] 拖动距离 < 16px 时不创建（防误点）
- [ ] 右侧列表每项：缩略图 + 文件名 + 自然尺寸 + 删除按钮
- [ ] 阈值滑条调整时仅影响**下一次导出**（不实时重绘选区）
- [ ] 点"下载 ZIP"：导出每选区为透明 PNG → 打包 → 触发 `stickers.zip` 下载
- [ ] **故意把用户矩形画得比物体小**：输出 PNG 仍包含整只物体（自动扩展到完整连通分量）
- [ ] **故意把用户矩形画得比物体大**：输出 PNG 紧贴物体 bbox（无大量白边）
- [ ] 用户矩形完全落在白背景里：兜底走简单裁切，不报错
- [ ] ESC / ✕ / 点遮罩 关闭 modal，状态清空
- [ ] CORS：cdn url 通过 `/api/images/proxy-image` 加载，canvas 不报 taint
- [ ] Generate 主页布局未被破坏（模态层不影响底层）
- [ ] 浏览器无新增 console 报错
- [ ] 打包中 ESC / ✕ 不会中断导出，按钮变 spinner

---

## 十一、已知限制

- 白底以外的复杂背景：阈值法失败，应替换为 ML 分割（下一阶段）
- 多物体粘连（共享非白像素，如紧贴的两只贴纸）：BFS 会把它们识别为一整块，输出为一个 PNG。需要用 ML 实例分割才能拆开。
- 物体跨越搜索窗边界（极端情况：物体宽度 > 用户矩形 3 倍）：BFS 会在搜索窗边沿截止，可能丢边。本期通过 `searchPadding = max(edge, 64)` 兜底；后续考虑"窗口触边自动再扩"
- 不支持选区拖拽 / 缩放：要改尺寸只能删除重画
- 不支持图片缩放与平移视图
- 已生成选区不保存，关闭即丢失
- 文件名固定为 `sticker-{i}.png`，不可自定义
- `/api/images/proxy-image` 未做 SSRF 白名单，仅限 `image/*` content-type 兜底
