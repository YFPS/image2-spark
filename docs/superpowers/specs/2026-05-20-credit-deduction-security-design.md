# 积分扣费安全设计

- 日期：2026-05-20
- 范围：`/api/images/generate`、`/api/images/edit` 的积分预扣、幂等、退款、任务持久化、对账与生产入口安全基线
- 当前前提：邮箱验证功能审核中，本设计不依赖邮箱验证上线
- 关联文档：
  - `docs/specs/2026-05-19-security-audit.md`
  - `docs/superpowers/specs/2026-05-17-auth-foundation-design.md`

## 1. 目标

当前项目已经有用户表、积分余额字段、积分流水表、JWT 鉴权、会话归属校验和基础限流，但 `/generate`、`/edit` 仍未实际扣减积分。商业化前必须把接口设计成：即使第三方通过浏览器 DevTools 或抓包拿到 API 地址，也无法绕过服务端成本控制。

本设计目标：

- 生图/改图接口被抓到后仍必须登录、归属正确、余额足够、受限流约束。
- 积分扣减由服务端权威计价，前端不能传入或覆盖费用。
- 并发请求不能打穿余额。
- 客户端重试、刷新、超时不会重复扣费。
- 上游失败、超时、进程重启后能恢复或补偿。
- 积分余额与流水可对账、可审计、可定位异常。
- 生产后端端口不直接暴露公网，公网只通过 HTTPS 入口层访问。

## 2. 非目标

- 本期不实现邮箱验证。邮箱验证上线后只负责降低批量小号风险，不承担账本正确性。
- 本期不实现充值支付回调。充值是后续 `billing` 设计的范围。
- 本期不做双分录会计账本。当前阶段使用单用户余额快照 + 不可变流水，配合唯一键和对账即可。
- 本期不把 `segment`、`brush-cutout` 纳入积分扣费；它们继续依赖鉴权、限流和上传大小限制。

## 3. 推荐路线

采用“原子预扣 + 幂等流水 + 持久化任务 + 失败补偿”。

请求进入时先预扣积分，再把上游调用放入持久化 `image_jobs`。这样可以在调用上游前完成成本控制，避免余额不足用户烧 API key。后台任务成功时只完成消息与任务状态；失败时追加退款流水。进程重启后 worker 可从 `image_jobs` 继续恢复，不依赖裸 `asyncio.create_task`。

## 4. 生产入口安全基线

生产环境不直接暴露 FastAPI 内部端口。

部署要求：

- 公网只暴露 `443`。
- Nginx、Caddy、CDN 或 WAF 作为唯一公网入口。
- FastAPI 只监听 `127.0.0.1:<internal_port>` 或内网地址。
- 防火墙禁止公网直连后端端口、数据库、Redis。
- 入口层限制请求体大小、连接超时、读写超时。
- 入口层保留 IP 维度限流；应用层保留用户维度和成本维度限流。
- 生产 CORS 只允许真实前端域名。CORS 不是安全边界，真实安全边界仍是鉴权、扣费和限流。

## 5. 临时账号策略

邮箱验证上线前，生产环境不应注册即发放可消费积分。

配置建议：

```env
SIGNUP_BONUS_CREDITS=0
```

临时发放方式：

- 管理员对白名单测试账号手动发放积分。
- 手动发放写 `credit_transactions(reason='admin_grant')`。
- 邮箱验证上线后，再调整为“邮箱验证成功后发放 signup bonus”。

这能避免批量注册账号薅取注册送积分。邮箱验证未来上线时，不需要改变扣费核心链路。

## 6. 服务端计价

新增 `credit_service.py` 负责服务端权威计价。

计价输入：

- `operation`: `generate` 或 `edit`
- `model`
- `quality`
- `size`
- `n`
- `reasoning`
- `output_format`

前端不得传入 `cost`。前端可以展示预估费用，但最终费用由后端计算。

价格表由后端配置维护，并带版本号：

```python
CREDIT_PRICE_VERSION = "2026-05-20.v1"
```

建议初始规则：

| 操作 | 规则 |
|---|---|
| generate | `ceil(n * unit_price(quality, size, reasoning))` |
| edit | `ceil(n * unit_price(quality, size, reasoning) * 1.2)` |

最小扣费为 1 积分。`auto` 尺寸按默认 1K 档计价；如果未来上游返回实际成本，再进入“预授权上限 + 成功后差额退款”模式。

每条扣费流水必须记录：

- `price_version`
- `operation`
- `request_snapshot`
- `cost`

这样价格调整后仍能解释历史账。

## 7. API 契约变更

### 7.1 请求头

`POST /api/images/generate` 与 `POST /api/images/edit` 必须带：

```http
Idempotency-Key: <client-generated-uuid>
```

约束：

- 长度 16 到 128。
- 建议 UUID v4。
- 同一用户下唯一。
- 保存 TTL 至少 24 小时；数据库记录保留更久，用于审计。

### 7.2 成功响应

请求创建任务成功后返回 `202 Accepted` 或继续使用当前 `200`。为了减少前端改动，可以先保留 `200`，响应体扩展：

```json
{
  "id": 123,
  "role": "ai",
  "text": "生成中...",
  "status": "pending",
  "image_urls": null,
  "params": {
    "request": {},
    "billing": {
      "cost": 2,
      "balance_after": 8,
      "price_version": "2026-05-20.v1",
      "idempotency_key": "..."
    }
  },
  "created_at": "2026-05-20T10:00:00Z"
}
```

### 7.3 错误码

| HTTP | code | 场景 |
|---|---|---|
| 400 | `missing_idempotency_key` | 缺少 `Idempotency-Key` |
| 400 | `invalid_idempotency_key` | 幂等键格式不合法 |
| 400 | `invalid_image_params` | `edit` 参数越界或上传不合法 |
| 402 | `insufficient_credits` | 余额不足 |
| 404 | `conversation_not_found` | 会话不存在、不属于当前用户或已删除 |
| 409 | `idempotency_conflict` | 同一幂等键对应不同请求 |
| 429 | `rate_limited` | 频率或成本限流命中 |
| 500 | `billing_invariant_error` | 扣费事务出现账本不变量异常 |

## 8. 数据库变更

### 8.1 `credit_transactions` 扩展

新增字段：

```sql
ALTER TABLE credit_transactions
  ADD COLUMN event_key VARCHAR(96) NOT NULL,
  ADD COLUMN idempotency_key VARCHAR(128) NULL,
  ADD COLUMN request_hash CHAR(64) NULL,
  ADD COLUMN price_version VARCHAR(32) NULL,
  ADD COLUMN metadata JSON NULL;
```

新增唯一键：

```sql
CREATE UNIQUE INDEX uk_ctx_event_key
  ON credit_transactions(event_key);

CREATE UNIQUE INDEX uk_ctx_user_ref_reason
  ON credit_transactions(user_id, reason, ref_type, ref_id);
```

`event_key` 示例：

- `debit:message:123`
- `refund:message:123`
- `grant:user:42:manual:20260520-001`

流水不可修改，只能追加。退款不修改原扣费流水，而是追加 `reason='refund'`、`delta=+cost` 的补偿流水。

### 8.2 新增 `idempotency_keys`

```sql
CREATE TABLE idempotency_keys (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  ref_type VARCHAR(32) NOT NULL,
  ref_id VARCHAR(64) NOT NULL,
  status ENUM('pending','succeeded','failed') NOT NULL DEFAULT 'pending',
  response_snapshot JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_idem_user_key (user_id, idempotency_key),
  KEY idx_idem_user_created (user_id, created_at),
  CONSTRAINT fk_idem_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

`request_hash` 由规范化请求计算：

- `operation`
- `conversation_id`
- `prompt` 的 SHA-256
- `model`
- `size`
- `quality`
- `n`
- `background`
- `output_format`
- `reasoning`
- `edit` 的文件摘要与 mask 摘要

同一用户、同一 `Idempotency-Key`：

- `request_hash` 相同：返回第一次创建的 message。
- `request_hash` 不同：返回 `409 idempotency_conflict`。

### 8.3 新增 `image_jobs`

```sql
CREATE TABLE image_jobs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  message_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  operation ENUM('generate','edit') NOT NULL,
  status ENUM(
    'queued',
    'running',
    'succeeded',
    'failed',
    'refunded',
    'needs_review'
  ) NOT NULL DEFAULT 'queued',
  cost BIGINT UNSIGNED NOT NULL,
  price_version VARCHAR(32) NOT NULL,
  request_payload JSON NOT NULL,
  upstream_request_id VARCHAR(128) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  locked_by VARCHAR(64) NULL,
  locked_at DATETIME NULL,
  next_retry_at DATETIME NULL,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_image_jobs_message (message_id),
  KEY idx_image_jobs_claim (status, next_retry_at, id),
  KEY idx_image_jobs_user_created (user_id, created_at),
  CONSTRAINT fk_image_jobs_message FOREIGN KEY (message_id) REFERENCES messages(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_image_jobs_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

`request_payload` 不保存原始图片字节。`edit` 的文件字节仍由当前请求内传入 worker 时处理；如果要支持重启后完整恢复 edit job，后续需要先把上传文件落对象存储或本地私有存储，再在 `request_payload` 保存引用。

本期高标准目标建议同步实现临时文件持久化：

- 上传原图与 mask 先保存到私有目录或对象存储。
- 路径或 object key 写入 `image_jobs.request_payload`。
- worker 成功、失败退款或过期后清理文件。

否则 `/edit` 在进程重启后只能进入 `needs_review` 并人工退款，恢复能力不完整。

## 9. 扣费事务

`credit_service.reserve_credits_for_image()` 在单个数据库事务里完成：

1. 校验幂等键。
2. 创建 pending `Message`。
3. 原子扣减余额。
4. 写扣费流水。
5. 写 `idempotency_keys`。
6. 写 `image_jobs`。
7. 提交事务。

余额扣减必须使用单 SQL 条件更新：

```sql
UPDATE users
SET credits = credits - :cost
WHERE id = :user_id AND credits >= :cost;
```

规则：

- `rowcount == 0`：回滚事务，返回 `402 insufficient_credits`。
- 禁止 ORM “读余额、Python 内减、再写回”的两步扣减。
- 扣减后读取用户当前余额作为 `balance_after`。
- `CreditTransaction.delta = -cost`。
- `CreditTransaction.ref_type = 'message'`。
- `CreditTransaction.ref_id = str(message.id)`。

## 10. Worker 状态机

后台 worker 从 `image_jobs` 领取任务。

领取规则：

```sql
SELECT *
FROM image_jobs
WHERE status = 'queued'
  AND (next_retry_at IS NULL OR next_retry_at <= NOW())
ORDER BY id
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

领取后：

- `status='running'`
- `locked_by=<worker_id>`
- `locked_at=NOW()`
- `attempt_count=attempt_count+1`

状态转换：

| 当前 | 事件 | 下一状态 |
|---|---|---|
| queued | worker 领取 | running |
| running | 上游成功 | succeeded |
| running | 明确失败且可退款 | refunded |
| running | 明确失败但不退款 | failed |
| running | 超时或未知状态 | needs_review |
| running | worker 崩溃超时 | queued 或 needs_review |
| needs_review | 人工确认未产生上游成本 | refunded |
| needs_review | 人工确认已产生上游成本 | failed |

`running` 超过阈值后由回收任务处理：

- `attempt_count < max_attempts` 且确认请求未发出：回到 `queued`。
- 请求可能已发出但结果未知：进入 `needs_review`。

## 11. 退款补偿

退款只追加流水，不修改原扣费流水。

`credit_service.refund_image_job()` 必须幂等：

- 查找原扣费流水 `reason in ('generate','edit')`。
- 检查是否已存在 `event_key='refund:message:{message_id}'`。
- 若已存在，直接返回现有退款结果。
- 若不存在：
  - `UPDATE users SET credits = credits + :cost WHERE id = :user_id`
  - 写 `CreditTransaction(delta=+cost, reason='refund')`
  - `balance_after` 取退款后的余额
  - job 改 `refunded`
  - message 改 `failed`

失败分类：

| 失败类型 | 是否自动退款 | 说明 |
|---|---|---|
| 本地参数校验失败 | 不扣费 | 请求事务前拦截 |
| 上游返回 4xx 且未生成 | 是 | 明确失败 |
| 上游 moderation 拒绝 | 是 | 先按用户友好口径全额退 |
| 上游 5xx | 是 | 明确未成功时退款 |
| 上游超时，无法确认是否生成 | 否，进入 `needs_review` | 避免上游已产生成本但本地退款 |
| worker 崩溃 | 视阶段决定 | 未发上游可重试；已发未知则复核 |

## 12. 参数收口

`/generate` 继续使用 `GenerateRequest` 的限制。

`/edit` 必须补齐与 `/generate` 同等级校验：

- `n`: `1..10`
- `quality`: `auto|low|medium|high`
- `size`: `auto` 或合法 `WxH`
- `background`: `auto|opaque`
- `model`: 忽略前端传入或限制为后端白名单
- 上传图片数量上限，例如 4 张
- 单文件大小上限沿用 `UPLOAD_MAX_BYTES`
- 校验真实图片格式和像素总量
- mask 必须为 PNG，尺寸应与首张参考图对齐或可被明确转换

计价必须在参数收口之后执行。

## 13. 限流与风控

保留已有 slowapi 限流，同时新增成本维度限制。

建议规则：

| 维度 | 初始值 |
|---|---|
| 单用户 generate/edit | 6 次/分钟 |
| 单用户 pending job | 2 个 |
| 单用户每小时积分消耗 | 60 积分 |
| 单 IP 注册 | 邮箱上线前尽量低，保留 3 次/小时 |
| 单 IP generate/edit | 30 次/小时 |
| 单用户连续失败 job | 5 次后短暂冷却 |

限流命中统一返回 `429 rate_limited`。成本维度限流不是余额系统的一部分，不写积分流水。

## 14. 对账与告警

新增每日对账任务，也可手动触发。

检查项：

- 每个用户：`users.credits == SUM(credit_transactions.delta)`。
- 每个 `image_jobs.succeeded` 必须有一条扣费流水。
- 每个 `image_jobs.refunded` 必须有一条扣费流水和一条退款流水。
- `needs_review` 超过 30 分钟报警。
- `running` 超过阈值报警。
- 单用户短时间高消耗报警。
- 上游错误率突增报警。
- `credit_transactions.balance_after` 与按时间累加结果不一致报警。

异常不自动修账。自动修账只允许通过 `credit_service` 追加 `adjust` 流水，并记录原因。

## 15. 前端影响

前端生成请求新增 `Idempotency-Key`。

生成时：

- 每次用户点击生成，创建一个 UUID 幂等键。
- 如果同一操作因网络失败重试，复用同一个键。
- 用户主动修改参数再次点击，生成新键。
- pending message 的 `params.billing` 用于更新 UserBadge 中的余额。

余额刷新：

- 请求创建成功后，前端可用响应里的 `balance_after` 立即更新余额。
- 页面刷新后，`GET /api/auth/me` 返回真实余额。
- 对话详情里的 message billing 仅用于展示，不作为余额真相来源。

## 16. 测试计划

### 16.1 单元测试

- 价格表计算：不同 `operation/quality/size/n/reasoning` 的成本正确。
- 请求规范化：同一语义请求 hash 稳定。
- 幂等冲突：同 key 不同 hash 返回冲突。
- 退款函数重复调用只写一条退款流水。

### 16.2 集成测试

- 余额充足：创建 pending message、扣余额、写扣费流水、写 job。
- 余额不足：返回 402，message/job/流水均不创建。
- 并发 10 个请求、余额只够 3 个：只有 3 个成功扣费。
- 同一 `Idempotency-Key` 重试：返回同一 message，不重复扣费。
- 同一 `Idempotency-Key` 不同参数：409。
- 上游成功：message done，job succeeded，不退款。
- 上游明确失败：message failed，job refunded，余额恢复。
- 上游超时未知：job needs_review，不自动退款。
- `/edit` 参数越界：请求被拒，不扣费。

### 16.3 对账测试

- 人工构造不一致余额，对账任务能报错。
- 人工构造 refunded job 缺退款流水，对账任务能报错。
- 正常扣费 + 退款链路对账通过。

## 17. 迁移与上线顺序

1. 新增 migration：扩展 `credit_transactions`，新增 `idempotency_keys`、`image_jobs`。
2. 新增 `credit_service.py` 和测试，不接路由。
3. 新增 `job_service.py` 和 worker 领取逻辑。
4. 接入 `/generate` 预扣与 job 创建。
5. 接入 `/edit` 参数校验、文件持久化、预扣与 job 创建。
6. 前端增加 `Idempotency-Key` 与余额刷新。
7. 开启对账任务和告警日志。
8. 生产将 `SIGNUP_BONUS_CREDITS=0`，管理员手动发测试积分。
9. 小流量灰度，只给白名单账号开放扣费链路。
10. 确认对账稳定后全量启用。

## 18. 验收标准

- `/generate`、`/edit` 无余额时不能调用上游。
- 并发请求不会让 `users.credits` 变负。
- 同一幂等键重复提交不会重复扣费。
- 上游明确失败会自动退款且只退一次。
- 服务重启后 queued job 可继续处理。
- `needs_review` job 可被对账或人工流程发现。
- 每日对账能证明 `users.credits` 与流水总和一致。
- 生产后端端口不可公网直连。
- 邮箱验证未上线时，新注册账号不会自动得到可消费积分。

