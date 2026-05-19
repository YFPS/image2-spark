# image2 接口安全评估报告

> 评估时间：2026-05-19
> 评估对象：`server/app/` 下所有 FastAPI 路由 + `client/src/api/auth.ts`
> 评估范围：上游隔离、滥用面、登录注册漏洞、积分扣费、积分计费安全
> 评估方法：逐文件源码审计（无运行时渗透测试）

---

## TL;DR

| 议题 | 结论 | 严重度 |
|---|---|---|
| 1. 上游 endpoint / API key 是否暴露 | key 不外泄；CDN 域名 + 上游错误文本透传到前端 | 中 |
| 2. 第三方滥用面 | 3 个公开接口 + 全局零限流 + 注册零防护 | 高 |
| 3. 登录注册漏洞 | 核心算法 OK；缺邮箱验证 + 1 处枚举侧信道 + JWT 长期 + localStorage | 中 |
| 4. 积分能否安全扣出 | **完全未实现** —— images 路由零积分逻辑，是空壳 | 致命（商业化阻塞） |
| 5. 积分计费基础设施 | 表与流水模型 OK；缺扣费/退款/充值与幂等保护 | 高（设计前置） |
| 附加 | `.env` 含生产明文凭据；对话已泄漏；RDS 公网 root | 致命 |

---

## 1. 上游接口是否被前端可见

### 现状
- `server/app/openai_client.py:33,82` 上游 URL `https://feiyuai.icu/v1/...` 与 `Authorization: Bearer <KEY>` 仅在后端 httpx 客户端持有，**不会回传前端**。
- `server/app/routers/images.py:144` `_parse_upstream_images` 只抽取 `data[].url` 与 `usage`，不透传上游 JSON。
- 但 `image_urls` 存的是上游 CDN 真实 URL，原样写入 `message.image_urls` → 前端可见 → **上游 CDN 域名暴露**。
- `server/app/routers/images.py:185` 上游错误原文 `f"失败：upstream_error：{e}"` 写入 `message.text`，前端可读 → 错误细节（含上游域名片段、参数名、模型变体名）泄漏。

### 风险
中等。攻击者通过 image src 可探明用了哪个中转商 / 哪个 CDN；通过失败信息可拼接出上游错误码与模型版本。无法直接拿到 API key。

### 整改建议
- 生成成功后，把 `image_urls` 内每个 URL 改写为 `/api/images/proxy-image?url=<encoded>`，前端只见自家域名。
- 上游错误对外打码：分类映射为 `upstream_*` 短码，详细原文只写后端日志。

---

## 2. 第三方滥用面（CORS / 鉴权 / 限流）

### 鉴权矩阵

| 接口 | 鉴权 | 限流 | 滥用风险 |
|---|---|---|---|
| `POST /api/images/generate` | ✓ JWT | ✗ | 登录后无限调上游，烧 API key |
| `POST /api/images/edit` | ✓ JWT | ✗ | 同上 + 上传 |
| `GET  /api/images/proxy-image` | **✗** | ✗ | 任意 https URL 反代 → 吃带宽，弱 SSRF（DNS rebinding 攻击面） |
| `POST /api/images/segment` | **✗** | ✗ | 任意 URL → MobileSAM CPU 推理 → DoS |
| `POST /api/images/brush-cutout` | **✗** | ✗ | 上传 + ML 推理 → DoS，无大小硬限 |
| `POST /api/auth/register` | ✗（自然） | ✗ | 批量造号 + 拿赠送积分 |
| `POST /api/auth/login` | ✗（自然） | ✓ 失败计数 | OK |
| `/api/conversations/*` | ✓ | ✗ | 登录后无限创建，但落库即占额度 |

### CORS
`server/app/main.py:50` `allow_origins=["http://127.0.0.1:5173","http://localhost:5173"]`。**只对浏览器有效**，curl/脚本无视 CORS。CORS 不是反爬手段。

### 全局限流
- 仅登录失败有计数（Redis）。
- 无全局速率中间件（无 slowapi/无 nginx `limit_req`）。
- 无按用户 id 的并发节流。

### 整改优先级
1. **proxy-image** 加鉴权 + **host allowlist**（只接受当前上游 CDN 域名），防 SSRF。
2. **segment / brush-cutout** 加鉴权 + 上传大小硬限（建议 10 MB）。
3. **全局 IP 限流**：slowapi 或 nginx 层，按 IP 每分钟 60、每秒 5。
4. **用户级限流**：`/generate`、`/edit` 单用户每分钟最多 N 次（建议 6）。
5. **register** 加 IP 限流（每 IP 每小时 ≤ 3 次）+ 邮箱验证后才发放积分。

---

## 3. 登录注册漏洞

### ✅ 实现正确
- bcrypt 12 轮，密码 8–72 位 + 必含字母与数字（`server/app/schemas.py:106`）。
- JWT HS256 + 64 hex secret（256-bit 熵），jti + Redis 黑名单实现登出。
- 登录失败 Redis Lua 原子脚本（`server/app/auth_service.py:97`），INCR + EXPIRE + 锁定一次完成，无 race。
- 用户不存在与密码错误返回同一错误码 `invalid_credentials`，不泄漏注册状态。

### ❌ 问题清单

| # | 漏洞 | 位置 | 严重度 |
|---|---|---|---|
| 3.1 | 无邮箱验证 | `auth_service.py:155` 注册立即发 token | 高 |
| 3.2 | 无注册限流 | 全局缺速率 | 高 |
| 3.3 | disabled 账号区分泄漏 | `auth_service.py:219` 密码正确时返回 403 vs 200，可区分账号被禁用与否 | 低（需先知道密码） |
| 3.4 | JWT 7 天有效 + localStorage | `client/src/api/auth.ts:41` | 中 |
| 3.5 | 黑名单依赖 Redis 单点 | `deps.py:52` Redis 挂则黑名单失效 → 已签发 token 仍可用直到过期 | 低 |

### 整改建议
- 3.1+3.2：接邮件服务（见附录 D），注册后发激活码，未激活账号 24h 内不能调 `/generate` `/edit` 且没发放积分。
- 3.3：把 disabled 分支并入 `invalid_credentials` 返 401（不再单独告诉用户"已禁用"），消除区分。若需保留禁用提示，门槛已被"必须先知道密码"抬高，可暂缓。
- 3.4：JWT 改 24h，引入 refresh token（HttpOnly cookie 存 refresh，access 仍可放 memory）；最低限度先把过期改 1–2 天。
- 3.5：维持现状即可，黑名单本身就是 best-effort。

---

## 4. 积分能否被正常安全扣出

### 现状（关键）

**完全没有扣减逻辑。**

- `routers/images.py` 全文 grep `credits` / `CreditTransaction` = 0 命中。
- `/generate`、`/edit` 流程：鉴权 → 加载 conv → 写 pending message → 启动后台 task → 返回。后台 task 只回填 image_urls/status，**不动 `User.credits`**。
- `CreditReason` 枚举里 `generate`、`edit` 是预留值（`models.py:32`），代码从未写入。
- 注册赠送 5 积分（`auth_service.py:181`）写入 `signup_bonus` 流水，是唯一活跃的 credits 写入路径。
- 没有 recharge / admin_grant 端点。

### 结论

**积分系统是空壳。** 当前任何登录用户可以无限调用 `/generate`、`/edit`。前端 `UserBadge` 显示的 "123 积分" 没有实际扣减语义。

商业化前必须实现扣费流程。设计见 §5。

---

## 5. 积分计费基础设施安全性

### 已具备
- `User.credits` BIGINT UNSIGNED（`models.py:60`）。
- `CreditTransaction` 流水表字段完整：`delta`（有符号）/`balance_after`/`reason`/`ref_type`/`ref_id`/`note`（`models.py:82`）。
- 注册赠送写入是单事务（add user → flush → add tx → commit），失败回滚正确。

### ❌ 实施前必须解决的并发陷阱

| # | 风险 | 整改方案 |
|---|---|---|
| 5.1 | BIGINT UNSIGNED 减到负数 | 用条件 UPDATE：`UPDATE users SET credits = credits - :cost WHERE id = :uid AND credits >= :cost`；rowcount==0 视为余额不足 |
| 5.2 | ORM 读改写有 TOCTOU 并发丢更新 | 同上，单 SQL 原子；如必须读，用 `SELECT … FOR UPDATE` |
| 5.3 | 流水可能写重 | `CreditTransaction(user_id, ref_type, ref_id)` 加 UNIQUE 索引；ref_id 用 `message.id` 字符串 |
| 5.4 | 后台 task 失败未退款 | task 异常分支调用退款函数，写 `reason='refund'` 流水，ref 指向同一 message.id 幂等 |
| 5.5 | 扣费时机选择 | 推荐"先扣后跑"：在 `/generate` 同事务里扣 + 写 pending message；task 失败时退款 |
| 5.6 | 充值无验签 | 待实现充值接口时，用支付平台 HMAC + nonce + 时间戳 + 支付订单号做 ref_id 幂等 |

### 计费规则（建议）

```
generate: cost = ceil(n * price_per_image(quality, size))
edit:     cost = ceil(n * price_per_image(quality, size) * 1.2)
退款:     失败/超时全额退；moderation 拒绝按服务端口径决定退或不退
```

价格表放 config，先以"普通 1K low = 1 积分"标定。

---

## 附录 A：泄漏的凭据

> 以下值在源码审计中已被读取，且 `.env` 与 `.env.example` 内含明文/注释中的密码字面量。本对话 + 之前的 Anthropic 日志已可视为泄漏面。**请立即轮换**。

| 资源 | 备注 |
|---|---|
| 阿里云 RDS `rm-bp10cu5968qn9660kqo` root | 公网开放 + 简单密码 + 用 root，必须改密 + 限白名单 IP + 建业务账号 |
| NAS Redis（192.168.50.250:6380）密码 | 内网用，但密码与 RDS 复用 |
| 上游中转商 `feiyuai.icu` API key | 应立即在中转商后台旋转 |
| `JWT_SECRET` | 旋转后所有已发 token 失效（用户需重登），可接受 |
| `.env:11` 注释里写了真实密码 `Qq960225@` | 删除该行注释（`.env.example` 已是干净占位符，无需改） |

---

## 附录 B：bcrypt 同步阻塞

`auth_service.py:31` `hash_password` / `verify_password` 在 async 路由内同步调用 bcrypt（每次 ~100 ms / 12 rounds）。并发登录会卡事件循环。性能问题非安全问题，整改用 `await asyncio.to_thread(...)` 包装。

---

## 附录 C：本期不动的次要发现

- `proxy-image` 内 Content-Type 检查仅 `startswith("image/")`，攻击者可以从可信图床下载合法图片再让我们反代——可接受。
- `/conversations` 列表 `q` 参数 ILIKE 模糊匹配未做长度更严限制（已有 max_length=120），可接受。
- 软删除：`Conversation.deleted_at` 仅过滤展示，物理保留全部消息，可能积累存储成本但不是安全问题。

---

## 附录 D：自部署邮件服务选项

| 方案 | 性质 | 适用 | 备注 |
|---|---|---|---|
| **阿里云邮件推送 / 腾讯云 SES** | 托管 SMTP 服务 | **强烈推荐 MVP 阶段** | 几分钟接入，1 元/千封，反垃圾信誉无需自建 |
| **SendGrid / Resend / AWS SES** | 海外托管 SMTP | 国际化业务 | Resend 开发体验最好；SES 最便宜 |
| **Postal**（GitLab 出品） | 全自建 docker | 中量级（每日万级） | 单容器，API 友好，反垃圾一般 |
| **Mailcow dockerized** | 全栈邮件服务器 | 个人/小团队完整邮箱（含 IMAP） | 资源占用大（≥ 2 GB），不推荐仅做发信用 |
| **Mailu** | docker compose 全栈 | 同上 | 体量比 Mailcow 略小 |
| **Postfix + Dovecot + Rspamd** | 手工组装 | 老派最大可控 | 维护成本高 |

> 自建发件的最大坑是 **IP 信誉**：腾讯云出口 IP 默认在多个 RBL 黑名单，新 IP 发外网邮件几乎全进垃圾箱。SPF/DKIM/DMARC 配齐 + 反向解析（PTR）也只能解决一半，剩下要靠预热 + 主流邮箱白名单。**MVP 推荐用阿里云邮件推送或 Resend**，等业务量真上来再自建。

---

## 整改路线图（按急迫性）

| 阶段 | 动作 | 阻塞 |
|---|---|---|
| **P0（今天）** | 轮换上游 API key、RDS 密码、Redis 密码、JWT secret；删除 .env.example 内明文密码注释 | 无 |
| **P1（本周）** | proxy-image / segment / brush-cutout 加鉴权；全局 slowapi IP 限流；`/generate` `/edit` 用户级限流 | 无 |
| **P2（本周）** | 注册接邮件服务、加邮箱验证；disabled 枚举侧信道修补；JWT 改 24h | 选好邮件服务 |
| **P3（下周）** | 积分扣费 + 退款 + 幂等 UNIQUE；UserBadge 接真扣费数据 | 价格表确定 |
| **P4（之后）** | 充值流程；refresh token；admin 后台 admin_grant | 支付通道 |

---

## 附录 E：P1 实施记录（2026-05-19）

P1 阶段已落地，对应 commits 待 `qpush`。具体改动：

| 文件 | 改动 |
|---|---|
| `server/requirements.txt` | 加 `slowapi>=0.1.9` |
| `server/app/config.py` | 加 `proxy_image_host_allowlist`、`rate_limit_global / generate / segment / register`、`upload_max_bytes` |
| `server/app/rate_limit.py`（新增） | Limiter 单例 + `user_id_key`（直接解 JWT 提取 sub，因为 slowapi 中间件在 dependency 之前执行） |
| `server/app/main.py` | 装 `SlowAPIMiddleware` + 429 → `{"error":{"code":"rate_limited",...}}` 统一形状 |
| `server/app/routers/images.py` | proxy-image 加 host allowlist；segment/brush-cutout 加 `Depends(get_current_user)` 与 `@limiter.limit`；generate/edit 加用户级 `@limiter.limit`；edit/brush-cutout 加 10 MB 上传硬限；**删除 `from __future__ import annotations`**（slowapi wrapper + PEP 563 + pydantic 三方互斥，导致 schema 生成时 `GenerateRequest` 解析失败） |
| `server/.env.example` | 同步新字段 |
| `client/src/api/gptImage.ts` | `segmentImage` / `brushCutout` 改 `authFetch`；429 友好提示 |

### E2E 验证结果

| 用例 | 期望 | 实际 |
|---|---|---|
| `GET /api/images/proxy-image?url=https://example.com/x.png` | 403 host_not_allowed | ✅ 403 |
| `GET /api/images/proxy-image?url=https://feiyuai.icu/no-such.png` | 进入反代（上游 404 透传） | ✅ 400 上游错 |
| `POST /api/images/segment` 无 token | 401 invalid_token | ✅ 401 |
| `POST /api/images/segment` 有 token + 假 URL | 200/4xx（不再 401） | ✅ 400 validation_error |
| `POST /api/images/brush-cutout` 无 token | 401 | ✅ 401 |
| `POST /api/images/generate` × 8 连发 | 前 6 次 404，第 7 次后 429 | ✅ 完全符合 |
| 刷新页面 | UI 完整、UserBadge 正常 | ✅ 无 console error |

### 部署前必做

1. **生产 `.env` 内追加 `PROXY_IMAGE_HOST_ALLOWLIST`**：当前默认只允许 `OPENAI_BASE_URL` 同 host（feiyuai.icu）。如果上游 CDN 用了独立域名（OSS、七牛、AWS S3），历史 image_urls 加载会 403 破图。检查方法：
   ```sql
   SELECT DISTINCT SUBSTRING_INDEX(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(image_urls,'$[0]')), '/', 3), '://', -1) AS host
   FROM messages WHERE image_urls IS NOT NULL;
   ```
   把结果中所有非 feiyuai.icu 的 host 加入 `PROXY_IMAGE_HOST_ALLOWLIST` 逗号分隔。
2. **若多 worker 部署 uvicorn**，slowapi 默认内存存储会按 worker 各算各的；改 `Limiter(storage_uri="redis://...")` 共享 Redis 后端。
3. CORS 仍是 `127.0.0.1:5173/localhost:5173`，生产必须改成实际域名。

### 未实施（按本次范围选择 P1，留给 P2/P3）

- P2：邮箱验证、JWT 缩短到 24h、disabled 枚举侧信道修补
- P3：积分扣费/退款/幂等链路、UserBadge 接真扣费数据
- P0 凭据轮换：用户表示稍后自行处理

