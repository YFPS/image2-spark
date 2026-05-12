# 后端 ML 抠图设计

## 迭代记录

- **v1**：rembg + u2netp 显著性分割。简单贴纸 OK；**多元素海报失败**（rembg 仅识别"最显著主体"，无法响应用户的 box prompt）
- **v2（当前）**：替换为 **OpenCV GrabCut + 用户矩形 box prompt**。真正按用户框出的区域做 FG/BG 分割，多元素海报也能精确抠

- **日期**：2026-05-12
- **范围**：
  - 新增后端 `POST /api/images/segment` 端点，用 `rembg` 跑显著性分割
  - 前端 cropper 把每个选区改成调后端拿透明 PNG（不再走纯前端阈值法）
  - 保留前端阈值法作 **fallback**（后端失败时不阻塞导出）
- **不在范围**：
  - SAM / Box-prompt 分割（rembg 不带 box prompt，但通过"扩展裁剪→分割"的工程组合也能利用用户矩形当 ROI）
  - GPU 加速（首版只跑 CPU）
  - 多实例分割（粘连物体仍可能合并为一个）

---

## 一、算法选择

| 候选 | 是否真用 box prompt | 简单贴纸 | 多元素海报 | 单图耗时 | 依赖 |
|---|---|---|---|---|---|
| rembg + u2netp（v1） | ❌ 仅 ROI 裁切，内部"显著性" | 良 | **失败** | 0.3–1.5 s | rembg + onnxruntime（80–200 MB 内存） |
| **OpenCV GrabCut（v2 当前）** | ✅ 矩形=FG 提示 | 良 | **良** | 0.3–2 s | opencv-python-headless（已被 rembg 间接拉入） |
| MobileSAM | ✅ | 优 | 优 | 0.5–2 s | onnx + 40 MB 模型 |
| SAM2 | ✅ | 优 | 优 | 3–10 s | 150 MB+ |

**决定**：v2 用 GrabCut。原因：

1. **真按 box prompt 工作**：用户框出的矩形 → 内部=可能前景、外部=确定背景，符合直觉
2. **零额外依赖**：cv2 已经在 v1 的依赖图里（pymatting/scikit-image 间接拉了 opencv-python-headless）
3. **CPU 几百毫秒**，无需 GPU 也无需模型下载
4. **简单贴纸场景也能处理**（颜色聚类对白底/纯背景天然友好）

v1 的 rembg 代码保留为 `segment_rembg`（可经 env `SEGMENT_BACKEND=rembg` 切回），但默认走 GrabCut。

---

## 二、API 设计

### 2.1 `POST /api/images/segment`

**Request body** (`application/json`)：

```json
{
  "url": "https://...",
  "x": 320,         // 用户矩形左上 x（源图自然像素）
  "y": 240,
  "w": 200,
  "h": 300,
  "padding_factor": 1.0   // 可选，默认 1.0；搜索窗 = userBox ± edge × padding_factor
}
```

**校验**：
- `url`：必须 https，hostname 不做白名单（开发环境）
- `x/y >= 0`，`w/h >= 16`
- `padding_factor` ∈ [0, 3]

**Response 200**：直接返回 `image/png` 字节流，带透明背景，紧贴物体 bbox（含 2 px 软边距）。

**Response 4xx/5xx**：

```json
{ "error": { "code": "upstream_error|validation_error|model_error|timeout", "message": "...", "upstream_status": 502 } }
```

### 2.2 已存在的端点不动

- `POST /api/images/generate` 保持不变
- `GET /api/images/proxy-image` 保持不变（cropper 显示源图仍依赖它）

---

## 三、后端实现

### 3.1 文件结构

```
server/
  requirements.txt          ← 新增 rembg / Pillow / numpy
  .env / .env.example       ← 新增 REMBG_MODEL（可选）
  app/
    config.py               ← 加 rembg_model 字段
    schemas.py              ← 加 SegmentRequest
    routers/
      images.py             ← 新加 /segment 路由
    segment_service.py      ← 新文件，封装 rembg session + 算法
```

### 3.2 算法流程（GrabCut v2 — Mask 模式）

注意：**不用 GC_INIT_WITH_RECT 而用 GC_INIT_WITH_MASK**。原因：

- `GC_INIT_WITH_RECT` 把矩形外强制设为"确定 BG"，5 次迭代不会改变 → 用户漏框边缘时**永远丢失**
- `GC_INIT_WITH_MASK` 允许我们三档分级：用户矩形内 = 可能 FG，矩形外但搜索窗内 = 可能 BG（**有机会升 FG**），搜索窗外 = 确定 BG

```
SegmentService.segment_grabcut(url, x, y, w, h):
  1. httpx fetch url；PIL.Image.open(bytes) → RGB → numpy
  2. 用户矩形钳到图边：(rx, ry, rx2, ry2)
  3. 搜索窗：用户矩形 + 50% padding（min 32 px），钳到图边
     pad = max(max(w, h) * 0.5, 32)
     (sx, sy, sx2, sy2)
  4. 构造初始 mask（H × W uint8）：
     - 全图 default = GC_BGD = 0          # 确定背景
     - mask[sy:sy2, sx:sx2] = GC_PR_BGD = 2  # 搜索窗内可能 BG（算法可升 FG）
     - mask[ry:ry2, rx:rx2] = GC_PR_FGD = 3  # 用户矩形内可能 FG（算法可降 BG）
  5. cv2.grabCut(img_bgr, mask, None, bgdModel, fgdModel, 5, GC_INIT_WITH_MASK)
     - 5 次迭代，GMM 高斯混合模型
     - 矩形内的白底像素被降为 BG（解决"框过大带白边"）
     - 矩形外搜索窗内的同色团像素被升为 FG（解决"框过小漏边"）
  6. alpha = mask ∈ {GC_FGD, GC_PR_FGD} ? 255 : 0
  6.1 填充孤岛 BG（_fill_inner_holes）：
      - 把 BG 视为前景作辅助 mask
      - cv2.floodFill 从 pad 角点开始扫，连到边界的是"真背景"
      - 剩下未连到边界的就是"内嵌孤岛"（贴纸眼白/鼻孔/字内孔等）
      - 把这些孤岛全部翻为 FG
      解决"小色块被同色背景吞掉"的典型 bug（如熊猫眼白）
  7. 找 alpha > 0 的紧凑 bbox + 4 px 软边距，RGBA 切片到 bbox
     若全 0（GrabCut 把所有像素判 BG）→ 兜底用用户矩形直接裁切（不带 alpha）
  8. PIL.save(BytesIO, format="PNG")
```

### 3.3 模型 session 复用

`rembg.new_session(model_name)` 加载模型耗时 ~500 ms（onnxruntime 初始化）。**必须复用**否则每次请求都重新加载。

实现：模块级单例：

```python
# segment_service.py
from rembg import new_session
_session = None

def get_session():
    global _session
    if _session is None:
        _session = new_session(get_settings().rembg_model)
    return _session
```

第一次请求会触发模型下载 + session 初始化（首请求 5–10 s），之后稳定快。

### 3.4 并发处理

rembg 默认是同步阻塞 CPU 调用。在 FastAPI async handler 里直接 `rembg.remove(...)` 会阻塞 event loop。

修法：用 `asyncio.to_thread(func, ...)` 把 CPU 调用扔到线程池，event loop 不阻塞。

```python
@router.post("/segment")
async def segment(req: SegmentRequest):
    img_bytes = await fetch_url(req.url)
    out_png = await asyncio.to_thread(do_segment_sync, img_bytes, req.x, req.y, ...)
    return Response(content=out_png, media_type="image/png")
```

### 3.5 错误处理

| 场景 | HTTP | error.code |
|---|---|---|
| url 非 https | 400 | validation_error |
| url fetch 失败 | 502 | upstream_error |
| 上游非 image/* | 400 | validation_error |
| PIL 解码失败 | 422 | validation_error |
| rembg 抛异常 | 500 | model_error |
| 处理超时（> 30s） | 504 | timeout |

---

## 四、前端改造

### 4.1 `api/gptImage.ts` 加 `segmentImage`

```typescript
export type SegmentRequest = {
  url: string;
  x: number; y: number; w: number; h: number;
  padding_factor?: number;
};

export async function segmentImage(req: SegmentRequest): Promise<Blob> {
  const res = await fetch("/api/images/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let apiError: ApiError = { code: "http_error", message: `HTTP ${res.status}` };
    try { const j = await res.json(); if (j.error) apiError = j.error; } catch {}
    throw new GenerateError(apiError);
  }
  return await res.blob();
}
```

### 4.2 `StickerCropperModal` 改造

#### 4.2.1 source URL 处理

cropper modal 现在用 `safeImageSrc(src)` 做代理；但调 `/api/images/segment` 时，需要把**原始** url 传给后端（让后端自己去 fetch），不是代理 url。

所以 `<StickerCropperModal>` 收到 `src` prop 时：
- 若是 `data:` URI → 当前请求不支持（rembg 后端要 url 输入），转 base64 上传或者保留前端阈值法。**本期 data: URI 走前端阈值法**（fallback），http(s) 走后端 ML。
- 若是 http(s) → 直接当 url 传 `/api/images/segment`

#### 4.2.2 exportSelection 流程

```typescript
async function exportSelection(srcImg, userSel, threshold, srcOriginalUrl) {
  if (srcOriginalUrl.startsWith("data:")) {
    return exportSelectionLocal(srcImg, userSel, threshold); // 旧的纯前端算法兜底
  }
  try {
    return await segmentImage({
      url: srcOriginalUrl,
      x: userSel.x, y: userSel.y, w: userSel.w, h: userSel.h,
      padding_factor: 1.0,
    });
  } catch (e) {
    console.warn("[cropper] backend segment failed, fallback to local:", e);
    return exportSelectionLocal(srcImg, userSel, threshold);
  }
}
```

#### 4.2.3 UI 反馈

- 顶栏"下载 ZIP"按钮在 `exporting` 期间已有 spinner，本期不动
- 右侧每行选区在导出时加一个浅 spinner 覆盖（在每张 PNG 完成前显示），让用户看到进度
- 提示 "AI 抠图（首次稍慢，模型加载中…）" 在前 10 s 显示

### 4.3 阈值滑条的语义变化

- 后端走 rembg 不需要 threshold（模型自己判断）
- 顶栏阈值滑条仍保留，仅作"fallback 兜底场景使用"，并加注 `仅 fallback 时生效`
- 或者：当前用户用的是 http url 源（走后端） → 阈值滑条灰显

本期：**保留显示但灰显**，文案说明。

---

## 五、依赖

`server/requirements.txt` 新增：

```
rembg==2.0.75              # Python 3.13 仅支持 >=2.0.62 系列
Pillow>=10.0.0
numpy>=2.0.0
onnxruntime>=1.18.0
```

> `rembg` 已包含 onnxruntime / Pillow / numpy / pymatting / scikit-image 作为间接依赖；
> 这里仅锁 `rembg` 主版本，间接依赖随 rembg 拉，避免 Python 3.13 上 numpy 与 opencv 的兼容性冲突。

`server/.env.example` 新增：

```
# rembg 模型名：u2netp（默认，5MB，快）/ u2net（170MB，慢但更精）/ silueta / isnet-general-use
REMBG_MODEL=u2netp
```

---

## 六、性能 / 资源

| 项 | 估值 |
|---|---|
| 首次请求（含模型下载 + session 初始化） | 5–15 s（看网速） |
| 稳定后单图（1024² 搜索窗，CPU i7） | 0.3–1.0 s |
| 内存：模型常驻 | ~80–200 MB |
| 3 个选区导出 | 1–3 s（无并发） |

如果需要更快：模型换 `silueta`（也很小 + 边缘锐利），或上 GPU（onnxruntime-gpu）。

---

## 七、验收清单

- [ ] `pip install -r requirements.txt` 在 server 目录干净安装
- [ ] 启动后访问 `GET /docs` 看到 `/api/images/segment` 路由
- [ ] 浏览器 cropper modal 框选 → 下载 ZIP → 解压 PNG **背景已透明**
- [ ] 故意框小一点：输出 PNG 包含完整物体（rembg 在搜索窗内自动识别）
- [ ] 故意框得过大（包大量白边）：输出 PNG 紧贴物体（rembg + tight bbox）
- [ ] 数据 URI 源图（b64_json 结果）：自动回退到前端阈值法
- [ ] 后端关闭 / 超时：前端走 fallback，不报"ZIP 失败"
- [ ] 浏览器 console 无业务报错
- [ ] 单图导出后 token 不变（不影响 generate 流程）

---

## 八、已知限制

- 首次请求会下载 ~5 MB 模型，需联网；离线则走 fallback
- rembg 不支持"box prompt"，多元素粘连仍按"显著性"算一块。若粘连，得用 SAM
- 服务端模型常驻 ~80–200 MB 内存
- data URI 源图（前端 b64 渲染）当前仍走 fallback，不享受 ML 提升。后续可加"接收 base64 上传"端点解决
- 没有缓存：同一图 + 同一框两次请求都会重算（可加 Redis / 内存 LRU）
