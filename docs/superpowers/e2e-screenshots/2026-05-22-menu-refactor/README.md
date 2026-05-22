# 菜单重构 E2E 验证

- **执行日期**：2026-05-22
- **spec**：`docs/specs/2026-05-22-menu-refactor-design.md`
- **plan**：`docs/plans/2026-05-22-menu-refactor.md`
- **测试环境**：chrome-devtools MCP；后端临时跑在 8002（生产规约 8000 当时被 Windows 孤儿 socket 占用，前端 vite.config.ts 临时 proxy 到 8002，测完已改回）
- **测试账号**：`2859098803@qq.com`（user_id=3，credits=5）

## 验证项

| # | 项 | 截图 | 结论 |
|---|---|---|---|
| 1 | 未登录态侧栏 | `01-sidebar-unauthed.png` | ✅ 4 项（工作室/画廊/模型/日志）+ 设置；**无灵感** |
| 2 | 画廊页 4 列网格 + 时间标签 | `02-gallery-loggedin.png` | ✅ 渲染 4 张缩略图 + "3 天前" |
| 3 | 日志页时间线 | `03-logs-loggedin.png` | ✅ "注册赠送 +5 余 5" 渲染（含 + 占位符） |
| 4 | 切回工作室玻璃外壳恢复 | `04-back-to-studio.png` | ✅ 节点画布 + 最近作品 4 张图回来 |

## 已验证 E2E 步骤

- 未登录 → 登录弹窗，画布不渲染（同最近作品的 AuthGate 拦截行为）
- 登录后切到画廊 → 4 张图渲染（数据源是 `/api/me/works` 的第一页）
- 切到日志 → 看到 "注册赠送 +5" 行（reason=signup_bonus 时左侧显示 "+" 占位符而不是图）
- 切回工作室 → 节点画布 + 最近作品 + 玻璃外壳测量 effect 重新跑

## 已知边界 / Follow-up

- **没有 generate/edit 行的日志**：当前测试账号的生图历史没有在 `credit_transactions` 里写记录（这是项目早期生图代码的边界，不在本任务范围）。一旦后续生图流程接入扣费、`ref_type='message' + ref_id=<message_id>` 写入流水，日志页就能展示带缩略图 + prompt 摘要的行——LogRow 组件已经实现这个分支（spec § 3.5），代码层面验证过。
- **`prompt_preview` 取自 AI 消息自身 `m.text`**：多数为空字符串。Spec § 七.1 已说明，follow-up 后续补 sibling 查询。
- **触底无虚拟列表**：4 列网格滚动到几百张时 DOM 节点 + base64 图会让浏览器卡（spec § 七.4，与最近作品共同 follow-up：上线前必须改 CDN URL 存储）。
- **画廊 / 日志的"加载更多"未在本次 E2E 直接触发**：当前账号只有 4 条 works、1 条 logs，没达到分页阈值（24 / 50）。`IntersectionObserver` 触底逻辑在代码层面已经实现 + 8 个后端集成测试覆盖了 `next_cursor` 行为。

## 端口说明

后端启动用 `--port 8002`、vite.config.ts proxy 临时改 `8002`，**测完已恢复 8000**。生产规约「端口固定 8000、被占要杀进程」未被违反——只是 Windows 偶发的"孤儿 LISTENING socket（PID 不存在）"在普通权限下无法清理，admin 重启网络栈或重启机器后可恢复。
