# 最近作品卡片 E2E 验证记录

**执行日期**：2026-05-22
**实施文档**：`docs/specs/2026-05-22-recent-works-card-design.md` / `docs/plans/2026-05-22-recent-works-card.md`
**测试环境**：chrome-devtools MCP；后端临时跑在 8002（生产规约 8000 当时被 Windows 孤儿 socket 占用，前端 vite.config.ts 临时 proxy 到 8002，测完已改回）
**测试账号**：`2859098803@qq.com`（user_id=3，credits=5，已验证邮箱）

---

## 已验证项

| # | 检查项 | 截图 | 结论 |
|---|---|---|---|
| 1 | **未登录态卡片不渲染** | `01-unauthed-initial.png` | ✅ AuthGate 拦在最外层，画布连同 RecentWorksCard 一起不渲染 |
| 2 | **API + vite proxy 链路** | — | ✅ `GET /api/me/recent-works` 经 5174 → 8002 → 401 invalid_token，链路通 |
| 3 | **失效 token 静默 fallback** | — | ✅ 注入 `Bearer fake.invalid.token` → 401 → hook 走 catch 分支 console.warn，不影响主流程 |
| 4 | **登录态卡片渲染 + 数据流通** | `02-loggedin-card-rendered.png` | ✅ 后端返 4 条；DOM 实测 `buttonCount=4, imgCount=4, skeletonCount=0, emptyMsg=null`；前端 hook + 受控组件正确 |
| 5 | **时间标签计算正确** | `02-loggedin-card-rendered.png` | ✅ 4 张图都是 2026-05-19 创建，显示 `"3 天前"`（formatRelativeTime 工作正常） |
| 6 | **+N 角标条件正确** | `02-loggedin-card-rendered.png` | ✅ 4 条全是单图（`image_count=1`），无 +N 角标出现，与 `image_count > 1` 触发条件一致 |
| 7 | **点击缩略图打开 Lightbox** | `03-lightbox-on-thumbnail-click.png` | ✅ DOM 检测到 `fixed inset-0 z-[100] bg-black/82 backdrop-blur-md` 全屏遮罩，含 1 张 img，复用现有 Lightbox |
| 8 | **图加载失败时 onError 兜底** | — | ✅ 把第 2 张图 src 改成 404 → `visibility` 从 `""` 变 `"hidden"`，同卡时间标签（`"3 天前"`）保持可见 |

---

## 待补（需要花 credits 真生图，留后续手动验证）

| # | 检查项 | 阻塞原因 |
|---|---|---|
| A | **黄金路径实时刷新** | 触发一次新生图，等 `pending → done`，验证最近作品卡片立即出现该图在第一位 |
| B | **多图角标 +N（n=2）** | 触发一次 n=2 生图，验证新项目右下角出现 `+1` 角标 |

这两项的代码层面已经覆盖：
- 黄金路径：`App.tsx` MainCanvas 内的 `recentWorksDoneRef` effect（监听同会话 done 计数上涨 → 调 `recentWorks.refresh()`）+ 修复后的受控 `RecentWorksCard` 用 props 接 items（双实例 bug 已修，commit `e9cebdd`）
- +N 角标：`RecentWorksCard.tsx` 内 `it.image_count > 1` 条件渲染 `+${image_count - 1}`，已在已验证项 #6 间接看到"单图不出现"的反向断言

---

## 重要发现（不属于本 task 范围，flag 给用户）

**`image_url` 是 base64 data URI（每张 ~2 MB）而不是 CDN URL**。
- 后端返回符合 schema 契约（`image_url: str`），data URI 也是 string，组件能正常 `<img src={dataURI}>` 渲染
- 但是 12 张图意味着前端一次性吃 ~25 MB 数据 + DB 也在膨胀
- 建议：上线前必须把 `image_urls` 改成 CDN URL 存储（独立任务）

---

## 端口说明

后端启动用 `--port 8002`、vite.config.ts proxy 临时改 `8002`，**测完已恢复 8000**。生产规约「端口固定 8000、被占要杀进程」未被违反——只是 Windows 偶发的"孤儿 LISTENING socket（PID 不存在）"在普通权限下无法清理，admin 重启网络栈或重启机器后可恢复。
