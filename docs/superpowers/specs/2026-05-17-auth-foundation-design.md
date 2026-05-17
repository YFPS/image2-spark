# Auth Foundation 设计文档

- 日期：2026-05-17
- 范围：image2 第一份用户系统 spec —— 数据库基础 + 注册/登录/登出 + 角色 + 积分骨架
- 不在本 spec 范围内：生图扣积分（独立 spec `credits-deduction`）、近期作品（独立 spec `gallery`）、付费充值（独立 spec `billing`）、管理后台（独立 spec `admin-console`）、多参考图上传（独立 spec `multi-reference-upload`，与本 spec 正交，可并行）
- 关联文档：`CLAUDE.md`（项目概览与端口/语言规范）、`DESIGN.md`（节点画布视觉铁律）

## 1. 总体架构

| 维度 | 选择 |
|---|---|
| 身份 | 邮箱 + 密码 |
| 邮箱验证 | 不做（schema 也不预留字段，YAGNI） |
| 登录态 | JWT only（access token；存 localStorage；HTTP 头 `Authorization: Bearer`） |
| 角色 | `admin / user / paid` enum |
| 数据库 | MySQL 8（远程阿里云 RDS） |
| 缓存 | Redis（仅用于 JWT 黑名单 + 登录限流；本地连 NAS 实例 `192.168.50.250:6380`） |
| ORM / 迁移 | SQLAlchemy 2.0 async + Alembic + asyncmy |
| 模块布局 | 扁平（沿用既有 `routers/images.py` 风格） |
| 前端呈现 | 全屏液态玻璃 overlay；不引入 react-router |

业界默认参数：

- 密码哈希：bcrypt（`passlib[bcrypt]`，rounds=12）
- access token TTL：7 天
- 登录限流：5 分钟内同邮箱失败 5 次 → 锁 15 分钟
- API 前缀：`/api/auth/*`

数据流：

```
前端 overlay 表单
  └─ POST /api/auth/register → 写 MySQL users(+流水) → 返回 JWT
  └─ POST /api/auth/login    → 校验 → 失败计数(Redis) → 成功签 JWT
  └─ POST /api/auth/logout   → 把 JWT 的 jti 写 Redis 黑名单
  └─ GET  /api/auth/me       → JWT middleware → 返回当前用户

受保护的业务路由（/api/images/* 等）
  └─ Depends(get_current_user) → 校签 + 查黑名单 + 查 disabled
  注: 本 spec 不修改 /api/images/* 既有路由的鉴权状态；由下游 spec 接入。
```

## 2. 数据库 Schema

### 2.1 `users`

```sql
CREATE TABLE users (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email           VARCHAR(254)    NOT NULL,
  password_hash   VARCHAR(72)     NOT NULL,
  role            ENUM('admin','user','paid') NOT NULL DEFAULT 'user',
  nickname        VARCHAR(32)     NOT NULL,
  avatar_url      VARCHAR(512)    NULL,
  credits         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_login_at   DATETIME        NULL,
  disabled        TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

说明：

- `email` 长度按 RFC 5321 取 254；写入前后端统一 `lower().strip()`。
- `password_hash` 留 72 字符余量（bcrypt 60，多余给未来切 argon2）。
- `credits` 是当前余额（快读），不可负，所有变动同时写流水表。
- `disabled = 1` 表示封号，登录和 token 校验均拦截。
- 不做软删除（`deleted_at`）。

### 2.2 `credit_transactions`（追加式流水）

```sql
CREATE TABLE credit_transactions (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  delta           BIGINT          NOT NULL,            -- +充值/赠送, -消耗
  balance_after   BIGINT UNSIGNED NOT NULL,            -- 该笔后的余额快照
  reason          ENUM('signup_bonus','recharge','admin_grant',
                       'generate','edit','refund','adjust') NOT NULL,
  ref_type        VARCHAR(32)  NULL,                   -- 关联业务对象类型
  ref_id          VARCHAR(64)  NULL,                   -- 关联业务对象 ID
  note            VARCHAR(255) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ctx_user_time (user_id, created_at DESC),
  CONSTRAINT fk_ctx_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

注册成功时在同一事务内：① 插 user ② 插一条 `reason='signup_bonus', delta=+5, balance_after=5` ③ `users.credits = 5`。任意一步失败全回滚。

### 2.3 Redis 键

```
jwt:blacklist:{jti}            TTL = JWT 剩余有效期    # 主动登出
login:fail:{email_lowercase}   INT, TTL=300s          # 5 分钟失败计数
login:lock:{email_lowercase}   "1", TTL=900s          # 达阈值即写入
```

### 2.4 Alembic

初始 migration `0001_create_users.py` 手写包含上述两表；后续用 `alembic revision --autogenerate`。

## 3. API 契约（`/api/auth/*`）

错误响应统一形如：

```json
{ "error": { "code": "...", "message": "...", "lock_remaining": 480 } }
```

`lock_remaining` 仅 `too_many_attempts` 时附带（秒）。

### 3.1 POST `/api/auth/register`

请求：

```json
{ "email": "foo@bar.com", "password": "secret123", "nickname": "Foo" }
```

校验：

- `email`：RFC 邮箱格式；存前 `lower().strip()`
- `password`：长度 8–72，至少含一字母一数字
- `nickname`：1–32 字符；不传则取 `email.split("@")[0]`

响应 201：

```json
{
  "access_token": "eyJhbGc...",
  "token_type": "Bearer",
  "expires_in": 604800,
  "user": {
    "id": 1, "email": "foo@bar.com", "nickname": "Foo",
    "role": "user", "avatar_url": null, "credits": 5,
    "created_at": "2026-05-17T10:00:00Z"
  }
}
```

错误：`400 email_invalid / password_weak / nickname_invalid`、`409 email_taken`。

### 3.2 POST `/api/auth/login`

请求：`{ "email", "password" }`

响应 200：同 register 的 `{ access_token, token_type, expires_in, user }`。

流程：

1. Redis `login:lock:{email}` 存在 → `429 too_many_attempts`
2. 查 user；不存在 OR 密码不匹配 → 通过 Lua 脚本原子 INCR+EXPIRE；计数 ≥ 5 同时写 `login:lock`。返回 `401 invalid_credentials`（不区分是邮箱不存在还是密码错，防枚举）
3. `disabled = 1` → `403 account_disabled`
4. 成功：删 `login:fail:{email}`、更新 `users.last_login_at`、签 JWT 返回

### 3.3 POST `/api/auth/logout`

Header：`Authorization: Bearer <token>`

响应 204。

逻辑：解析 JWT 取 `jti` + `exp`；`SET jwt:blacklist:{jti} "1" EX (exp - now)`。前端同时清 localStorage。

### 3.4 GET `/api/auth/me`

Header：`Authorization: Bearer <token>`

响应 200：完整 `UserPublic`（含 `credits`、`last_login_at`）。依赖链已在 `get_current_user` 校签 + 黑名单 + `disabled`。

### 3.5 JWT payload

```json
{
  "sub": "1",
  "email": "foo@bar.com",
  "role": "user",
  "jti": "uuid4-string",
  "iat": 1715923200,
  "exp": 1716528000
}
```

算法 HS256，密钥 `JWT_SECRET` 从 `.env` 读，启动时校验非空。

### 3.6 错误码字典

| HTTP | code | 触发 | 前端文案 |
|---|---|---|---|
| 400 | `email_invalid` | register | 邮箱格式不正确 |
| 400 | `password_weak` | register | 密码须 8–72 位且含字母与数字 |
| 400 | `nickname_invalid` | register | 昵称须为 1–32 字符 |
| 409 | `email_taken` | register | 该邮箱已注册 |
| 401 | `invalid_credentials` | login | 邮箱或密码错误 |
| 401 | `invalid_token` | 受保护路由 | 登录已过期，请重新登录 |
| 403 | `account_disabled` | login / 受保护路由 | 账号已停用，请联系管理员 |
| 403 | `forbidden` | require_admin/paid | 当前角色无权访问 |
| 429 | `too_many_attempts` | login | 登录失败次数过多，请 15 分钟后再试 |
| 500 | `internal_error` | 兜底 | 服务异常，请稍后重试 |

## 4. 后端实现要点

### 4.1 模块布局

```
server/app/
├── routers/
│   ├── images.py     (既有, 不改)
│   └── auth.py       (新增: 4 个端点的薄壳)
├── config.py         (扩展: DATABASE_URL / REDIS_URL / JWT_* / BCRYPT_ROUNDS / SIGNUP_BONUS_CREDITS / LOGIN_FAIL_*)
├── db.py             (新增: create_async_engine + async_sessionmaker + get_db 依赖)
├── redis_client.py   (新增: redis.asyncio 单例 + get_redis 依赖)
├── models.py         (新增: SQLAlchemy 2.0 风格 User / CreditTransaction)
├── auth_service.py   (新增: hash/verify_password, create/decode_jwt, register_user, authenticate, blacklist_token, is_blacklisted)
├── deps.py           (新增: oauth2_scheme, get_current_user, require_admin, require_paid)
├── schemas.py        (扩展: RegisterRequest / LoginRequest / TokenResponse / UserPublic / ErrorResponse 复用)
└── main.py           (扩展: 启动事件 + 挂载 auth 路由)
```

### 4.2 JWT 生命周期

- 签发：`jti = uuid4()`，登录/注册成功时签；不入库
- 校验：`get_current_user` ① `jwt.decode` 验签 + `exp` ② `redis.exists("jwt:blacklist:"+jti)` ③ 按 `sub` 查 user 看 `disabled`
- 失效：自然过期 / 主动登出（黑名单）/ 封号（`disabled=1` 查库即拒）
- 错误统一 `401 invalid_token`（`disabled` 例外返 `403 account_disabled`）

### 4.3 密码哈希

`passlib.context.CryptContext(schemes=["bcrypt"], deprecated="auto")` 单例，rounds=12。

### 4.4 登录限流（Lua 原子）

```python
LUA_INC_FAIL = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if n >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
end
return n
"""
```

`KEYS[1] = login:fail:{email}`、`KEYS[2] = login:lock:{email}`、`ARGV = [window, max, lock_ttl]`。

### 4.5 启动时强探活

`app/main.py` 加 startup 事件：① `SELECT 1` 探活 DB ② `redis.ping()` ③ `JWT_SECRET` 非空。任一失败抛异常终止进程。

## 5. 前端 Overlay

文件布局：

```
client/src/
├── api/
│   └── auth.ts                 (新增: register/login/logout/me + token 存取 + authFetch 包装)
├── auth/
│   ├── AuthContext.tsx         (新增: { user, token, status, login, register, logout })
│   └── AuthOverlay.tsx         (新增: 全屏液态玻璃 overlay, 登录/注册同卡 tab 切换)
└── App.tsx                     (改: 顶层包 <AuthProvider>; status='unauthenticated' 时挂 <AuthOverlay>; 顶栏右侧加头像+昵称胶囊)
```

### 5.1 视觉

严格遵守 `DESIGN.md`：

- 卡宽 400px，居中；复用 `<LiquidGlass>` 包裹
- 顶部 tab：「登录 / 注册」同卡切换，不做翻面动画
- 输入条：玻璃半透明深底，灰阶
- 提交按钮 = 现有 Generate 电黄胶囊（页面唯一发光元素）
- 错误文案：红色细字，仅出错时显示

### 5.2 AuthContext

```ts
type AuthState = {
  user: UserPublic | null;
  token: string | null;
  status: 'loading' | 'unauthenticated' | 'authenticated';
  login(email, password): Promise<void>;
  register(email, password, nickname?): Promise<void>;
  logout(): Promise<void>;
};
```

启动时：从 `localStorage.getItem('auth_token')` 读 → 调 `/api/auth/me` 校验 → 命中则 `authenticated`、否则清掉本地 token 进 `unauthenticated`。

### 5.3 顶栏

`App.tsx` 顶部右侧新增「头像 + 昵称」胶囊；点击展开下拉，包含「登出」。本期不做账户中心页。

### 5.4 错误处理策略

- `authFetch` 命中 **401 `invalid_token`** → 清 localStorage + 切 `unauthenticated`，overlay 自动出现
- 401 `invalid_credentials` / 403 / 409 / 429 → 在 overlay 表单内红字显示；429 用 `lock_remaining` 做倒计时
- 5xx → 通用 toast「网络异常」，不弹 overlay

### 5.5 不做

- 不引入 react-router
- 不做「记住我」复选框（token 一律 localStorage）
- 不修改 `api/gptImage.ts`（本期 `/api/images/*` 不鉴权）

## 6. 配置 / 依赖

### 6.1 `server/.env`（新增项，旧的保留）

```env
# 既有
OPENAI_API_KEY=...
OPENAI_BASE_URL=...

# 新增 (auth-foundation)
DATABASE_URL=mysql+asyncmy://<user>:<password>@rm-bp10cu5968qn9660kqo.mysql.rds.aliyuncs.com:3306/image2?charset=utf8mb4
REDIS_URL=redis://192.168.50.250:6380/0
JWT_SECRET=<openssl rand -hex 32 的结果>
JWT_EXP_DAYS=7
BCRYPT_ROUNDS=12
SIGNUP_BONUS_CREDITS=5
LOGIN_FAIL_MAX=5
LOGIN_FAIL_WINDOW=300
LOGIN_LOCK_TTL=900
```

`config.py` 用 `pydantic-settings` Settings + `lru_cache` 单例（沿用现有约定）。

确认 `server/.gitignore` 包含 `.env`、`.env.test`。

### 6.2 阿里云 RDS 部署前置

- 在 RDS 实例上建数据库 `image2`，字符集 `utf8mb4` / 排序 `utf8mb4_0900_ai_ci`
- 测试用单独建 `image2_test`（schema 同构）
- 建议建独立应用账号 `image2_app`，授予 `image2` 与 `image2_test` 库的 DML+DDL 权限；勿用 root
- RDS 安全组放行开发机出口 IP 与生产机 IP；不开 `0.0.0.0/0`

### 6.3 `requirements.txt` 新增

```
SQLAlchemy>=2.0
alembic>=1.13
asyncmy>=0.2.9
redis>=5.0
passlib[bcrypt]>=1.7
PyJWT>=2.8
pydantic-settings>=2.0
email-validator>=2.0
```

## 7. 测试

### 7.1 单元测试 — `tests/test_auth_service_unit.py`

- `hash_password / verify_password` 往返
- `create_jwt / decode_jwt` 往返；过期拒；`jti` 每次不同
- 密码强度（合规 / 太短 / 缺数字 / 缺字母 / >72）
- 邮箱归一化（大写转小写、首尾空白剥离）

### 7.2 集成测试 — `tests/test_auth_routes_int.py`

环境：

- DB → 与开发共用 `image2` 库（用户决定不另建 test 库）。**为避免污染**：每个测试用例使用随机邮箱（`f"test-{uuid4().hex[:12]}@example.com"`），测试 tearDown 按邮箱删除自己创建的 user + 关联流水。不做全表 TRUNCATE。
- Redis → NAS 实例 DB 15（`redis://192.168.50.250:6380/15`，与开发的 DB 0 隔离），setUp `FLUSHDB`
- 通过 `server/.env.test` + `os.environ` 注入

用例：

| 用例 | 期望 |
|---|---|
| 注册成功 | 201 + token + `user.credits == 5` + 流水 1 条 `signup_bonus` |
| 注册重复邮箱 | 409 `email_taken` |
| 注册大小写邮箱视为同一 | `Foo@x.com` 与 `foo@x.com` 冲突 |
| 注册弱密码 / 非法昵称 | 400 |
| 登录成功 | 200 + token；`last_login_at` 更新 |
| 登录密码错 4 次 | 仍 401 |
| 登录密码错第 5 次 | 401 + 锁定写入 |
| 锁定期内正确密码 | 429 `too_many_attempts` + `lock_remaining` |
| 登录不存在邮箱 | 401（与密码错文案一致） |
| `disabled=1` 用户登录 | 403 `account_disabled` |
| `/me` 无 token / 过期 / 非法签名 | 401 `invalid_token` |
| 登出后该 token 再访问 `/me` | 401（黑名单生效） |
| `disabled` 中途置 1，老 token 访问 `/me` | 403 |
| 并发注册同邮箱（asyncio.gather × 2） | 一条 201 一条 409，不脏 |

### 7.3 不测

- bcrypt / PyJWT / Redis 自身行为
- 前端单元测试（项目无前端测试基建，本期不引入）

### 7.4 跑测试

```powershell
cd D:\webProject\image2\server
.venv\Scripts\activate
python -m unittest discover -s tests -p "test_*.py"
```

## 8. 验收标准

- `alembic upgrade head` 在 RDS `image2` / `image2_test` 上均能正确建表
- 所有 §7.2 用例通过
- 启动 `uvicorn app.main:app --port 8000`，未配置 `DATABASE_URL` / `REDIS_URL` / `JWT_SECRET` 任一项时进程拒绝启动
- 前端 `npm run dev`：未登录访问 `/` → overlay 自动出现；注册一个新账号 → overlay 消失 → 顶栏出现昵称胶囊 → 点击登出 → overlay 重新出现
- 错误码字典中所有 code 均能在前端被命中并正确显示对应文案

## 9. 后续 spec（占位，不在本范围内）

- `credits-deduction` —— 把 `/api/images/generate /edit` 接入 `Depends(get_current_user)`，按规则扣 credits 并写流水；余额不足时 402
- `gallery` —— 近期作品；新增 `image_tasks` 表存储生图记录；前端画布下方面板
- `billing` —— 充值 / 支付回调 / 写 recharge 流水
- `admin-console` —— 管理员后台（查用户、封号、调账）
- `multi-reference-upload` —— 多参考图上传，与本 spec 正交
