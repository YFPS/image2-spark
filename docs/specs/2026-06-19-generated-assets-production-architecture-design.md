# 生成图片资产长期架构设计

- **日期**：2026-06-19
- **方向**：生产优先、长期稳态、增量落地
- **背景问题**：
  - `/api/me/recent-works` 曾因 `messages JOIN conversations ORDER BY messages.id DESC` 触发 MySQL `1038 Out of sort memory`。
  - `messages.image_urls` 同时承载上游 URL、本地 URL、data URL、失效旧主机 URL，导致图片加载、响应体大小、时间排序和故障判断混在一起。
  - Redis 目前用于缓存、限流、登录等短期状态，但本地开发依赖 SSH 隧道连接 191 服务器 Redis，容易被误判为图片或 MySQL 问题。
- **目标**：
  - 图片作品有独立资产索引，不再把 `Message` 当作品表使用。
  - 最近作品、作品库、历史对话图片都能返回稳定可访问 URL。
  - Redis 只做缓存/限流/锁，不作为图片可靠性的真相源。
  - 历史数据可以分批迁移，失败可重跑，不破坏原始 `messages`。

---

## 一、现状判断

当前数据模型里：

```text
Conversation
  id, user_id, updated_at, deleted_at

Message
  id, conversation_id, role, text, image_urls, params, status, created_at
```

`Message` 的职责过重：

1. 对话 transcript。
2. AI 任务状态。
3. 出图参数快照。
4. 作品图片索引。
5. 历史图片 URL 兼容层。

这让作品查询只能围绕 `messages.image_urls` 做过滤和排序。一旦用户历史消息增长，查询就会被迫在 `messages` 与 `conversations` 之间做跨表排序。当前 `works_service.fetch_recent_work_items()` 已经用“先扫会话、再扫消息、Python 合并”的方式绕开 MySQL filesort，但这应该被视为过渡实现，不应该继续成为长期核心路径。

---

## 二、目标架构

```text
生成/编辑接口
  -> 上游 gpt-image-2
  -> asset_storage 保存图片
  -> generated_assets 写作品索引
  -> Message 回写 text / status / image_urls 兼容字段

最近作品 / 作品库 / 历史图片
  -> generated_assets 索引查询
  -> 返回 public_url + created_at
  -> 不再跨 messages/conversations 做全局排序
```

长期的深模块是 `generated_assets` 资产模块。它对外暴露很小的接口，把图片保存、URL 解析、历史迁移、作品分页这些实现细节收在模块内部。

关键架构词：

- **Module**：生成图片资产模块，包含 ORM、存储 Adapter、查询服务、迁移脚本。
- **Interface**：`persist_generated_assets()`、`list_user_assets()`、`migrate_legacy_message_images()`。
- **Implementation**：本地文件写入、COS 写入、历史 data URL 解码、死链判定、分页查询。
- **Seam**：`AssetStorage` 接口。生产可换 COS，本地可用 `server/uploads/generated`。
- **Adapter**：`LocalAssetStorage`、后续 `CosAssetStorage`。
- **Locality**：图片可用性、作品列表、历史迁移问题集中在资产模块。
- **Leverage**：调用方不再知道 data URL、上游短链、本地文件名、对象存储 key 的差异。

---

## 三、数据模型

新增表：`generated_assets`

```sql
CREATE TABLE generated_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  message_id BIGINT UNSIGNED NOT NULL,
  slot_index INT NOT NULL,
  storage_kind ENUM('local', 'cos', 'remote_legacy', 'data_legacy', 'missing') NOT NULL,
  storage_key VARCHAR(512) NULL,
  public_url VARCHAR(1024) NULL,
  source_url TEXT NULL,
  mime_type VARCHAR(64) NULL,
  width INT NULL,
  height INT NULL,
  bytes BIGINT UNSIGNED NULL,
  sha256 CHAR(64) NULL,
  status ENUM('available', 'missing', 'quarantined') NOT NULL DEFAULT 'available',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asset_message_slot (message_id, slot_index),
  KEY idx_asset_user_created (user_id, created_at, id),
  KEY idx_asset_user_id (user_id, id),
  KEY idx_asset_status_kind (status, storage_kind),
  CONSTRAINT fk_asset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_asset_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_asset_msg FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

字段语义：

| 字段 | 说明 |
|---|---|
| `user_id` | 作品归属用户，列表查询主过滤条件 |
| `conversation_id` | 回到原会话用 |
| `message_id` | 与 AI 消息关联 |
| `slot_index` | 同一条 AI 消息第几张图，从 0 开始 |
| `storage_kind` | 图片来源或存储形态 |
| `storage_key` | 本地文件名或对象存储 key |
| `public_url` | 前端展示 URL，优先返回它 |
| `source_url` | 原始上游 URL 或 data URL 摘要，仅审计与迁移排错用 |
| `sha256` | 去重与迁移幂等 |
| `status` | `available` 可展示，`missing` 历史死链，`quarantined` 安全隔离 |
| `created_at` | 作品时间，列表显示时间以它为准 |

`Message.image_urls` 的定位调整为：兼容字段。新代码仍可短期写入，但作品类读取路径不再依赖它。

---

## 四、存储层

新增模块：

```text
server/app/asset_storage.py
server/app/generated_assets_service.py
```

`asset_storage.py` 的目标接口：

```python
class StoredAsset(BaseModel):
    storage_kind: str
    storage_key: str
    public_url: str
    mime_type: str
    bytes: int
    sha256: str


class AssetStorage(Protocol):
    async def save_image(
        self,
        *,
        body: bytes,
        content_type: str,
        output_format: str,
        message_id: int,
        slot_index: int,
    ) -> StoredAsset:
        ...
```

第一阶段只实现 `LocalAssetStorage`，复用现有 `/api/images/local/{filename}` 读取路由。

生产阶段增加 `CosAssetStorage`：

```text
ASSET_STORAGE_BACKEND=local | cos
GENERATED_IMAGE_DIR=server/uploads/generated
COS_BUCKET=
COS_REGION=
COS_SECRET_ID=
COS_SECRET_KEY=
COS_PUBLIC_BASE_URL=
```

保存失败策略：

1. 新生成图片保存失败时，不直接丢作品记录。
2. 若原始 URL 是 http/https，可写入 `storage_kind='remote_legacy'`，`status='available'`，同时记录 `source_url`。
3. 若原始 URL 已知不可访问，写入 `status='missing'`，前端列表不展示。
4. 后台迁移任务可以重新尝试把 `remote_legacy` 转成 `local` 或 `cos`。

---

## 五、接口改造

### 5.1 写路径

`POST /api/images/generate` 与 `POST /api/images/edit` 的后台任务完成后：

```text
上游返回 urls
  -> 下载/解码为 bytes
  -> AssetStorage.save_image()
  -> INSERT generated_assets
  -> Message.image_urls 写 public_url 列表兼容旧前端
```

写入顺序建议：

1. 先保存文件。
2. 再写 `generated_assets`。
3. 最后 `_finalize_message(..., image_urls=public_urls)`。

如果资产写入失败但上游已经返回图片：

```text
Message 仍可 done
generated_assets 写 remote_legacy 或 missing
日志记录 asset_persist_failed
不让生成任务整体失败，避免用户付费后看不到任何结果
```

### 5.2 读路径

`/api/me/recent-works`：

```sql
SELECT *
FROM generated_assets
WHERE user_id = :user_id
  AND status = 'available'
ORDER BY created_at DESC, id DESC
LIMIT 12;
```

`/api/me/works`：

```sql
SELECT *
FROM generated_assets
WHERE user_id = :user_id
  AND status = 'available'
  AND id < :cursor
ORDER BY id DESC
LIMIT :limit_plus_one;
```

`conversation detail`：

短期仍读 `Message.image_urls`，中期可补一个按 `message_id` 批量读取 assets 的路径，让历史会话里的 AI 消息也展示资产表中的稳定 URL。

---

## 六、历史迁移

新增脚本：

```text
server/scripts/migrate_generated_assets.py
```

迁移规则：

| 历史 URL 类型 | 处理 |
|---|---|
| `/api/images/local/{filename}` | 校验文件存在，补 asset 记录 |
| `data:image/...` | 解码、保存为文件/COS、补 asset |
| `http/https` 可访问 | 下载、保存为文件/COS、补 asset |
| 已知死链主机 | 写 `missing` 或跳过展示，保留 `source_url` |
| 非法 URL | 写 `quarantined`，不展示 |

幂等规则：

```text
唯一键 message_id + slot_index
重复运行时跳过已有 asset
sha256 相同但 message 不同，可以共享文件 key，也可以先不做跨消息去重
每批固定数量，提交后输出进度
```

推荐命令：

```powershell
cd D:/webProject/image2/server
python scripts/migrate_generated_assets.py --batch-size 200 --dry-run
python scripts/migrate_generated_assets.py --batch-size 200
```

迁移完成前，读路径需要 fallback：

```text
优先 generated_assets
如果用户 assets 为空，则保留当前 works_service 的 message 扫描逻辑
```

迁移完成且验证稳定后，移除 fallback。

---

## 七、Redis 长期定位

Redis 职责：

```text
登录失败限流
全局/用户限流
任务短期锁
临时缓存
健康状态辅助
```

Redis 不保存：

```text
图片二进制
图片唯一索引
作品列表真相
用户历史记录真相
```

生产建议：

```text
后端与 Redis 在同一台机器或同一私网
REDIS_URL 指向内网地址
Redis 进程由 systemd / Docker restart policy 托管
```

本地开发建议：

```text
scripts/start-dev-redis-tunnel.ps1
  -> 建立 127.0.0.1:6381 到 191 服务器 Redis 的 SSH 隧道
  -> PING 成功后输出 REDIS_URL
  -> 断开时明确提示，而不是让接口表现成图片失败
```

新增深度健康检查：

```text
GET /api/health/deep
  db: ok/error + latency_ms
  redis: ok/error + latency_ms
  asset_storage: ok/error
```

---

## 八、上线阶段

### 第 0 阶段：稳定当前热修复

- 保留 `works_service.fetch_recent_work_items()`。
- 补充文档说明它是临时过渡实现。
- 继续过滤已知死链主机。

### 第 1 阶段：资产表 + 本地存储 Adapter

- 新增 `GeneratedAsset` ORM。
- 新增 migration。
- 新增 `asset_storage.py`。
- 新生成图片双写 `generated_assets` 与 `Message.image_urls`。

### 第 2 阶段：作品接口切读资产表

- `/api/me/recent-works` 读 `generated_assets`。
- `/api/me/works` 读 `generated_assets`。
- 返回结构保持前端兼容。

### 第 3 阶段：历史迁移

- data URL 转本地文件或 COS。
- 远程 URL 下载缓存。
- 死链标记 missing。
- 确认列表接口不再返回 `data:image`。

### 第 4 阶段：生产存储与 Redis 固化

- 接入 COS。
- 配置生产 `ASSET_STORAGE_BACKEND=cos`。
- Redis 改为内网或本机稳定服务。
- 加 `/api/health/deep`。

### 第 5 阶段：清理旧依赖

- 作品类接口彻底移除 message fallback。
- `Message.image_urls` 只保留历史兼容说明。
- 后续如果要彻底清理，需要先完成会话详情读 assets 的改造。

---

## 九、验收标准

必须满足：

```text
/api/me/recent-works 连续 100 次请求无 500
/api/me/works cursor 翻页无重复、无跳页
列表接口不返回 data:image
最新图片使用 asset.created_at 显示时间
Redis 断开时作品列表仍可读
MySQL EXPLAIN 不出现大表 filesort
历史迁移可重复运行，不重复写 asset
生成/编辑新图片后 generated_assets 与 Message 兼容字段一致
Chrome MCP 验证最新作品图片真实渲染
```

---

## 十、迁移执行记录

- **执行时间**：2026-06-19
- **环境**：本地开发环境连接当前 `server/.env` 配置的 MySQL
- **Alembic**：`0005 -> 0006`，当前 `0006 (head)`
- **dry-run 第一次**：`planned=144 created=0 missing=133 skipped=0 failed=0`
- **真实迁移**：`planned=144 created=144 missing=133 skipped=0 failed=0`
- **dry-run 复查**：`planned=0 created=0 missing=0 skipped=144 failed=0`
- **资产统计**：`total=144 available=11 missing=133 local=11 remote_legacy=0`
- **说明**：133 条历史图片来自已知失效旧图源，迁移为 `missing`，不会再进入作品列表展示；11 条可恢复图片已保存为本地资产 URL。

---

## 十一、风险与取舍

1. **短期双写复杂度增加**  
   代价是写路径多一步资产记录；收益是读路径稳定、图片可靠性可观测。

2. **历史迁移可能遇到死链**  
   不强行修复不可恢复图片。标记 `missing`，不让前端反复加载失败。

3. **本地文件存储不是生产终态**  
   第一阶段保留本地存储是为了最小落地；生产阶段用 COS Adapter 替换。

4. **Message 与 Asset 会并存一段时间**  
   这是为了兼容已有前端和历史会话。最终作品功能以 `generated_assets` 为准。

5. **Redis 仍可能影响登录/限流**  
   但不会再影响作品读取。用户看到“图片加载失败”时，排查路径会更清楚。
