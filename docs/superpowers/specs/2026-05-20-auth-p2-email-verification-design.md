# Auth P2 邮箱验证安全设计

- 日期：2026-05-20
- 范围：邮箱验证、注册赠送积分发放时机、`disabled` 登录枚举侧信道、JWT 默认有效期缩短到 24h
- 状态：已获用户批准，待实现计划
- 关联文档：
  - `docs/specs/2026-05-19-security-audit.md`
  - `docs/superpowers/specs/2026-05-17-auth-foundation-design.md`
  - `docs/superpowers/specs/2026-05-20-credit-deduction-security-design.md`

## 1. 背景

P1 已完成基础限流、host allowlist 等加固。认证体系仍有三类 P2 风险：

- 注册后立即获得可消费积分，批量造号可以薅取 signup bonus。
- 没有邮箱验证，无法证明账号邮箱归属。
- `disabled` 用户在登录时返回独立 `403 account_disabled`，攻击者在知道密码时可区分账号状态。
- JWT 默认 7 天有效，泄露后的可用窗口偏长。

P3 扣费设计已经规定：邮箱验证上线前生产环境 `SIGNUP_BONUS_CREDITS=0`；邮箱验证上线后，signup bonus 改为验证成功后发放。本设计补齐该前提。

## 2. 目标

- 注册后必须验证邮箱，才允许调用 `/api/images/generate` 和 `/api/images/edit`。
- signup bonus 只在邮箱验证成功后发放，且对同一用户最多发放一次。
- 验证 token 明文只通过邮件发送，不落库；数据库只保存 hash。
- 重发验证邮件、验证接口、注册响应不制造新的邮箱枚举入口。
- 登录时不再通过 `disabled` 分支泄露账号禁用状态。
- JWT 默认有效期改为 24 小时。
- 邮件发送通过 provider 抽象，首版默认阿里云邮件推送，保留 Resend/SMTP 替换点。

## 3. 非目标

- 本期不实现 refresh token 和 HttpOnly cookie。它们属于后续 P2.5 会话安全设计。
- 本期不实现找回密码。已有 `docs/email-templates/04-password-reset.html` 只是模板草稿，不纳入本设计。
- 本期不做完整后台用户管理 UI。
- 本期不把邮箱验证作为账本正确性的边界；扣费、退款和对账仍按 P3 设计独立保证。
- 本期不自建邮件服务器。审计文档已指出自建发信受 IP 信誉、SPF/DKIM/DMARC 和投递率影响较大，MVP 不采用。

## 4. 推荐路线

采用“`EmailProvider` 抽象 + 阿里云邮件推送默认实现 + 事务内发放 signup bonus”。

选择依据：

- 阿里云邮件推送官方建议邮件推送使用子域名，避免影响企业邮箱收发；新发信域名需要 SPF、DKIM、DMARC、MX 等验证通过。参考：https://help.aliyun.com/zh/direct-mail/user-guide/how-to-configure-sending-domain-names
- Resend 也要求使用自有域名，并配置 SPF、DKIM，可增加 DMARC 记录提升可信度。参考：https://resend.com/docs/dashboard/domains/introduction
- 业务代码只依赖 `EmailProvider.send_verification_email()`，不会绑定具体供应商。

首版 provider：

- `EMAIL_PROVIDER=aliyun_directmail`
- 本地开发允许 `EMAIL_PROVIDER=console`，只把验证链接写日志，不真实发信。
- 未来可新增 `resend` 或 `smtp`，不改验证 token、用户状态和积分发放逻辑。
- 生产环境由 `APP_ENV=production` 标识；生产启动时禁止 `EMAIL_PROVIDER=console` 或 `EMAIL_PROVIDER=null`。

## 5. 数据模型

### 5.1 `users` 扩展

```sql
ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME NULL,
  ADD COLUMN signup_bonus_granted_at DATETIME NULL;
```

字段语义：

- `email_verified_at IS NULL`：邮箱未验证。
- `email_verified_at IS NOT NULL`：邮箱已验证，可调用需要 verified user 的业务接口。
- `signup_bonus_granted_at IS NULL`：尚未发放验证后的注册赠送积分。
- `signup_bonus_granted_at IS NOT NULL`：已发放或已确认不再发放 signup bonus。

约束：

- 发放 signup bonus 时必须在同一事务里检查 `signup_bonus_granted_at IS NULL`。
- 不允许只依赖应用内内存状态判断是否已发放。

### 5.2 新增 `email_verification_tokens`

```sql
CREATE TABLE email_verification_tokens (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  purpose ENUM('verify_email') NOT NULL DEFAULT 'verify_email',
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_evt_token_hash (token_hash),
  KEY idx_evt_user_created (user_id, created_at),
  KEY idx_evt_expires (expires_at),
  CONSTRAINT fk_evt_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

token 规则：

- 明文 token 使用 `secrets.token_urlsafe(32)` 生成。
- 落库前计算 `sha256(token)`，只保存 `token_hash`。
- token 有效期固定 24 小时。
- 同一用户可以有多个未使用 token；任一有效 token 验证成功后，该用户其他未使用 token 立即置为 `used_at=NOW()`。
- 清理任务删除已过期超过 7 天或已使用超过 7 天的 token。

### 5.3 旧数据迁移

当前仓库已有开发期用户和 `signup_bonus` 流水。迁移时按 legacy user 处理：

```sql
UPDATE users
SET email_verified_at = COALESCE(email_verified_at, created_at)
WHERE email_verified_at IS NULL;

UPDATE users u
SET signup_bonus_granted_at = COALESCE(signup_bonus_granted_at, u.created_at)
WHERE signup_bonus_granted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM credit_transactions ct
    WHERE ct.user_id = u.id AND ct.reason = 'signup_bonus'
  );
```

上线要求：

- 生产公开注册前执行迁移。
- 如果生产已有真实用户，迁移前需要导出 legacy 用户列表并人工确认是否应视为已验证。
- 迁移不新增积分，不补发流水，只补齐状态字段。

## 6. 后端服务边界

### 6.1 `email_provider.py`

新增 provider 协议：

```python
class EmailProvider(Protocol):
    async def send_verification_email(
        self,
        *,
        to_email: str,
        nickname: str,
        verify_url: str,
        expires_hours: int,
    ) -> None:
        raise NotImplementedError
```

实现：

- `ConsoleEmailProvider`：开发环境使用，记录验证链接到日志。
- `AliyunDirectMailProvider`：生产默认实现。
- `NullEmailProvider`：测试使用，不发送外部请求。

配置：

```env
EMAIL_PROVIDER=aliyun_directmail
APP_ENV=production
EMAIL_FROM_ADDRESS=noreply@mail.example.com
EMAIL_FROM_ALIAS=image2
EMAIL_VERIFY_BASE_URL=https://example.com/verify-email
EMAIL_VERIFY_TOKEN_TTL_HOURS=24
EMAIL_RESEND_COOLDOWN_SECONDS=60
EMAIL_VERIFY_DAILY_LIMIT=5
```

阿里云配置：

```env
ALIYUN_DIRECTMAIL_ACCESS_KEY_ID=<aliyun-access-key-id>
ALIYUN_DIRECTMAIL_ACCESS_KEY_SECRET=<aliyun-access-key-secret>
ALIYUN_DIRECTMAIL_ACCOUNT_NAME=noreply@mail.example.com
ALIYUN_DIRECTMAIL_REGION=cn-hangzhou
```

生产启动校验：

- `EMAIL_PROVIDER=aliyun_directmail` 时，上述阿里云和发件人配置必须非空。
- `EMAIL_VERIFY_BASE_URL` 必须是 `https://`。
- `APP_ENV=production` 时不允许使用 `console` 或 `null` provider。

### 6.2 `email_verification_service.py`

新增职责：

- `create_verification_token(session, user)`：生成 token，落库 hash，返回明文 token。
- `send_verification_email(user, token)`：组装验证 URL 并调用 provider。
- `verify_email_token(session, token)`：校验 token、设置用户已验证、发放 signup bonus。
- `resend_verification(session, email)`：按防枚举规则重发。
- `require_verified_user(user)`：供生图和改图路由使用。

该服务不负责密码登录、JWT 签发和图片任务扣费。

## 7. API 契约

### 7.1 `POST /api/auth/register`

请求不变：

```json
{ "email": "foo@example.com", "password": "abc12345", "nickname": "Foo" }
```

响应仍为 `201`，`TokenResponse` 扩展 `verification_email_sent` 字段；用户初始积分为 `0`：

```json
{
  "access_token": "<jwt-access-token>",
  "token_type": "Bearer",
  "expires_in": 86400,
  "verification_email_sent": true,
  "user": {
    "id": 1,
    "email": "foo@example.com",
    "nickname": "Foo",
    "role": "user",
    "credits": 0,
    "email_verified_at": null,
    "last_login_at": null,
    "created_at": "2026-05-20T10:00:00Z"
  }
}
```

注册事务：

1. 归一化邮箱。
2. 创建 `users`，`credits=0`，`email_verified_at=NULL`，`signup_bonus_granted_at=NULL`。
3. 创建邮箱验证 token hash。
4. 提交事务。
5. 事务提交后发送验证邮件。
6. 签发 JWT 并返回。

如果邮件发送失败：

- 用户仍然注册成功。
- 返回 `201`，但响应体中 `verification_email_sent=false`。
- 前端提示用户稍后点击重发。
- 后端记录 warning 日志，不回滚已创建账号，避免邮箱服务短暂故障导致重复注册歧义。

### 7.2 `POST /api/auth/verify-email`

请求：

```json
{ "token": "<email-token>" }
```

成功响应：

```json
{
  "ok": true,
  "user": {
    "id": 1,
    "email": "foo@example.com",
    "nickname": "Foo",
    "role": "user",
    "avatar_url": null,
    "credits": 5,
    "email_verified_at": "2026-05-20T10:05:00Z",
    "verification_required": false,
    "last_login_at": null,
    "created_at": "2026-05-20T10:00:00Z"
  }
}
```

成功事务：

1. 计算 token hash。
2. 使用 `SELECT * FROM email_verification_tokens WHERE token_hash=:token_hash FOR UPDATE` 查找 token hash 对应记录。
3. 锁定对应 user。
4. 若 token 已使用或已过期，且 user 已验证，返回 `200 ok`，不发放积分。
5. 若 token 已使用或已过期，且 user 未验证，分别返回 `verification_token_invalid` 或 `verification_token_expired`。
6. 若 `email_verified_at IS NULL`，设置为 `NOW()`。
7. 若 `signup_bonus_granted_at IS NULL` 且 `SIGNUP_BONUS_CREDITS > 0`：
   - `UPDATE users SET credits = credits + :bonus, signup_bonus_granted_at = NOW()`
   - 写 `credit_transactions(reason='signup_bonus', delta=+bonus, balance_after=:balance_after)`
8. 标记该用户所有未使用验证 token 为已使用。
9. 提交事务。

幂等规则：

- 同一个 token 第二次使用时，如果用户已验证，返回 `200 ok`，但不再次发放积分。
- 同一用户使用另一个旧 token 时，如果用户已验证，返回 `200 ok`，但不再次发放积分。
- 未验证用户提交已使用 token 返回 `400 verification_token_invalid`。
- 未验证用户提交过期 token 返回 `400 verification_token_expired`。

### 7.3 `POST /api/auth/resend-verification`

请求：

```json
{ "email": "foo@example.com" }
```

响应固定：

```json
{ "ok": true }
```

防枚举规则：

- 邮箱不存在：返回 `200 ok`，不发邮件。
- 邮箱已验证：返回 `200 ok`，不发邮件。
- 邮箱未验证：若未命中限流，创建新 token 并发邮件。
- 不在响应体区分上述状态。

限流：

- 单 IP：`5/hour`。
- 单 email：`3/hour`。
- 单用户重发冷却：60 秒。
- 单用户每日最多发送 5 封验证邮件，对应 `EMAIL_VERIFY_DAILY_LIMIT=5`。

### 7.4 `GET /api/auth/me`

`UserPublic` 新增：

```json
{
  "email_verified_at": "2026-05-20T10:05:00Z",
  "verification_required": false
}
```

`verification_required = email_verified_at IS NULL`。

### 7.5 `/api/images/generate` 和 `/api/images/edit`

在现有 JWT 鉴权和会话归属校验后增加 verified user 检查：

- `email_verified_at IS NULL`：返回 `403 email_not_verified`，不调用上游，不创建图片任务，不扣费。
- `email_verified_at IS NOT NULL`：继续执行原业务流程。

P3 扣费实现时，该检查必须发生在预扣积分之前。

## 8. 错误码

| HTTP | code | 场景 |
|---|---|---|
| 400 | `verification_token_invalid` | token 不存在、已使用、格式非法 |
| 400 | `verification_token_expired` | token 已过期 |
| 403 | `email_not_verified` | 未验证邮箱访问生图/改图 |
| 429 | `verification_resend_limited` | 已登录用户主动重发时命中冷却或频率限制 |
| 500 | `email_provider_error` | 管理员测试发信接口失败；公开注册不直接暴露该错误 |

公开 `resend-verification` 默认不返回 `verification_resend_limited`，仍返回 `200 ok`，避免成为枚举通道。已登录用户在个人中心点击重发时可以返回 `429 verification_resend_limited`，因为用户已证明自己持有该账号 session。

## 9. `disabled` 侧信道修补

登录流程改为：

1. Redis `login:lock:{email}` 存在，返回 `429 too_many_attempts`。
2. 用户不存在，记录失败，返回 `401 invalid_credentials`。
3. 密码错误，记录失败，返回 `401 invalid_credentials`。
4. 密码正确但 `disabled=1`，记录失败，返回 `401 invalid_credentials`，不签发 JWT，不清除失败计数。
5. 密码正确且未禁用，清除失败计数，更新 `last_login_at`，签发 JWT。

说明：

- 登录接口不再返回 `account_disabled`。
- `get_current_user` 仍在 token 校验后查询 `disabled`，已登录账号被禁用后访问 `/me` 或业务接口返回 `403 account_disabled`。
- 前端登录页不显示“账号已停用”，只显示通用登录失败文案。

## 10. JWT 有效期

配置从天改为小时：

```env
JWT_EXP_HOURS=24
```

兼容规则：

- 新代码优先读取 `JWT_EXP_HOURS`。
- 若未配置 `JWT_EXP_HOURS` 但配置了旧的 `JWT_EXP_DAYS`，启动时允许读取旧值并记录 deprecation warning。
- `.env.example` 和部署文档只保留 `JWT_EXP_HOURS=24`。
- 现有已签发 token 按原 `exp` 自然过期，不做批量吊销。

`expires_in` 应接近 `86400` 秒。

## 11. 前端影响

`client/src/api/auth.ts`：

- `UserPublic` 增加 `email_verified_at` 和 `verification_required`。
- 增加 `verifyEmail(token)`。
- 增加 `resendVerification(email)` 或已登录态 `resendMyVerification()`。

UI：

- 注册成功后进入已登录状态，但显示邮箱待验证提示。
- 未验证用户点击生成或改图时，若后端返回 `email_not_verified`，显示验证提示和重发入口。
- 验证链接打开后调用 `/api/auth/verify-email`，成功后刷新 `/api/auth/me`。

本期不改 token 存储位置，仍沿用 localStorage。后续 P2.5 再设计 access token memory + refresh token HttpOnly cookie。

## 12. 安全与风控细节

- 验证链接必须使用 HTTPS 生产域名。
- 邮件内容不得包含密码、JWT、余额等敏感信息。
- token 明文只出现在邮件链接和应用日志的开发 console provider 中；生产日志不得记录明文 token。
- `resend-verification` 必须使用统一响应，避免邮箱存在性枚举。
- 邮件发送失败不影响注册事务，避免用户反复注册造成状态不一致。
- 重发邮件的 token 创建和发送要记录审计日志：`user_id`、email hash、provider、结果、错误码。
- provider API key 不得进入前端，不得写入仓库。

## 13. 测试计划

### 13.1 单元测试

- token 生成只落 hash，不落明文。
- token 过期返回 `verification_token_expired`。
- token 重复使用不重复发放 signup bonus。
- 同一用户多个 token，任一验证成功后其他 token 失效。
- `disabled` 用户密码正确时登录返回 `401 invalid_credentials`。
- `JWT_EXP_HOURS=24` 时 `expires_in` 约等于 86400。
- `JWT_EXP_DAYS` 兼容读取时仍能签发 token，并记录 warning。

### 13.2 集成测试

- 注册成功：用户 `credits=0`，`email_verified_at=NULL`，创建 token，返回 token。
- 验证成功：设置 `email_verified_at`，发放 signup bonus，写一条 `signup_bonus` 流水。
- 验证重复提交：不重复发放积分。
- 未验证用户访问 `/generate`：返回 `403 email_not_verified`，不调用上游。
- 未验证用户访问 `/edit`：返回 `403 email_not_verified`，不保存上传文件，不调用上游。
- 重发验证：不存在邮箱、已验证邮箱、未验证邮箱均返回同样公开响应。
- 邮件 provider 失败：注册仍 201，响应标记 `verification_email_sent=false`。
- 已登录 token 的用户被禁用后访问 `/me`：仍返回 `403 account_disabled`。

### 13.3 不测

- 阿里云邮件推送自身投递率。
- 收件方垃圾邮件判定。
- SPF/DKIM/DMARC 解析传播速度。
- PyJWT 和 Redis 客户端库内部行为。

## 14. 上线顺序

1. 配置发信子域名，完成 SPF、DKIM、DMARC、MX 验证。
2. 配置 `EMAIL_PROVIDER=console` 在本地验证完整流程。
3. 新增数据库 migration。
4. 新增 `EmailProvider` 与 `email_verification_service`。
5. 改注册流程：初始积分 0，提交后发验证邮件。
6. 新增验证和重发接口。
7. 改 `/generate` 和 `/edit` verified user 检查。
8. 修补 `disabled` 登录侧信道。
9. 改 JWT 默认有效期到 24h。
10. 前端接入验证提示、验证页和重发入口。
11. 生产配置阿里云 provider，小流量验证。
12. 观察注册、验证邮件发送、验证成功率、`email_not_verified` 命中率。

## 15. 验收标准

- 新注册用户未验证前积分为 0。
- 邮箱验证成功后才获得 signup bonus。
- signup bonus 对同一用户不能重复发放。
- 未验证用户不能调用 `/generate` 和 `/edit`。
- 公开重发接口不泄露邮箱是否存在或是否已验证。
- 登录接口对 `disabled` 用户不再返回 `account_disabled`。
- 已登录 token 在账号被禁用后仍被受保护接口拒绝。
- 新签发 JWT 默认 24 小时过期。
- 生产环境不允许 `EMAIL_PROVIDER=console`。
- 邮件 provider 可以替换，不影响用户验证状态、积分发放和业务接口鉴权。
