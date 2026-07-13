-- ============================================================================
-- image2 数据库完整建表脚本
-- 基于 server/app/models.py + alembic/versions/0001~0009 合并生成
-- 目标：在新库上一步执行全部建表，无需逐版本迁移
--
-- 用法：
--   mysql -u <user> -p <db> < server/sql/init_db.sql
--
-- 注意：
--   1. 需要 MySQL 8.0+（依赖 utf8mb4_0900_ai_ci）
--   2. 库需预先创建（CREATE DATABASE image2 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;）
--   3. 不含示例/测试数据，仅建表
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. users — 用户表
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email                    VARCHAR(254)    NOT NULL,
    password_hash            VARCHAR(72)     NOT NULL,
    role                     ENUM('admin', 'user', 'paid')
                                             NOT NULL DEFAULT 'user',
    nickname                 VARCHAR(32)     NOT NULL,
    avatar_url               VARCHAR(512)    DEFAULT NULL,
    credits                  BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_login_at            DATETIME        DEFAULT NULL,
    disabled                 TINYINT(1)      NOT NULL DEFAULT 0,
    email_verified_at        DATETIME        DEFAULT NULL,
    signup_bonus_granted_at  DATETIME        DEFAULT NULL,
    created_at               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 2. credit_transactions — 积分变动流水
-- ---------------------------------------------------------------------------
CREATE TABLE credit_transactions (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id       BIGINT UNSIGNED NOT NULL,
    delta         BIGINT          NOT NULL,
    balance_after BIGINT UNSIGNED NOT NULL,
    reason        ENUM('signup_bonus', 'recharge', 'admin_grant',
                       'generate', 'edit', 'refund', 'adjust')
                                  NOT NULL,
    ref_type      VARCHAR(32)     DEFAULT NULL,
    ref_id        VARCHAR(64)     DEFAULT NULL,
    note          VARCHAR(255)    DEFAULT NULL,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ctx_user_time (user_id, created_at),
    CONSTRAINT fk_ctx_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 3. conversations — AI 对话会话
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id    BIGINT UNSIGNED NOT NULL,
    title      VARCHAR(120)    NOT NULL DEFAULT '',
    pinned     TINYINT(1)      NOT NULL DEFAULT 0,
    created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME        DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_conv_user_updated (user_id, updated_at),
    KEY idx_conv_user_deleted (user_id, deleted_at),
    CONSTRAINT fk_conv_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 4. messages — 会话消息（含 AI 生成状态）
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    conversation_id BIGINT UNSIGNED NOT NULL,
    role            ENUM('user', 'ai')  NOT NULL,
    text            TEXT            NOT NULL,
    image_urls      JSON            DEFAULT NULL,
    params          JSON            DEFAULT NULL,
    status          ENUM('done', 'pending', 'failed')
                                    NOT NULL DEFAULT 'done',
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_msg_conv_id (conversation_id, id),
    CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 5. email_verification_tokens — 邮箱验证令牌（仅存 hash）
-- ---------------------------------------------------------------------------
CREATE TABLE email_verification_tokens (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id    BIGINT UNSIGNED NOT NULL,
    token_hash VARCHAR(64)     NOT NULL,
    purpose    ENUM('verify_email') NOT NULL DEFAULT 'verify_email',
    expires_at DATETIME        NOT NULL,
    used_at    DATETIME        DEFAULT NULL,
    created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_evt_token_hash (token_hash),
    KEY idx_evt_user_created (user_id, created_at),
    KEY idx_evt_expires (expires_at),
    CONSTRAINT fk_evt_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 6. access_logs — HTTP 访问日志
-- ---------------------------------------------------------------------------
CREATE TABLE access_logs (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    method      VARCHAR(10)     NOT NULL,
    path        VARCHAR(512)    NOT NULL,
    status_code INT             NOT NULL,
    ip          VARCHAR(64)     DEFAULT NULL,
    user_id     BIGINT UNSIGNED DEFAULT NULL,
    duration_ms INT             NOT NULL DEFAULT 0,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_al_time (created_at),
    KEY idx_al_user_time (user_id, created_at),
    KEY idx_al_path (path, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 7. admin_logs — 管理员操作审计
-- ---------------------------------------------------------------------------
CREATE TABLE admin_logs (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    admin_id    BIGINT UNSIGNED NOT NULL,
    action      VARCHAR(64)     NOT NULL,
    target_type VARCHAR(32)     DEFAULT NULL,
    target_id   BIGINT UNSIGNED DEFAULT NULL,
    detail      JSON            DEFAULT NULL,
    ip          VARCHAR(64)     DEFAULT NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_admlog_admin_time (admin_id, created_at),
    KEY idx_admlog_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 8. upstream_channels — 上游 API 渠道配置
-- ---------------------------------------------------------------------------
CREATE TABLE upstream_channels (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name               VARCHAR(64)     NOT NULL,
    base_url           VARCHAR(512)    NOT NULL,
    api_key            VARCHAR(256)    NOT NULL,
    enabled            TINYINT(1)      NOT NULL DEFAULT 1,
    is_default         TINYINT(1)      NOT NULL DEFAULT 0,
    auto_switch_enabled TINYINT(1)     NOT NULL DEFAULT 0,
    priority           INT             NOT NULL DEFAULT 0,
    supports_edit      TINYINT(1)      NOT NULL DEFAULT 1,
    max_concurrent     INT             NOT NULL DEFAULT 10,
    timeout_seconds    INT             NOT NULL DEFAULT 300,
    last_health_check  DATETIME        DEFAULT NULL,
    last_health_ok     TINYINT(1)      DEFAULT NULL,
    last_latency_ms    INT             DEFAULT NULL,
    total_requests     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    total_failures     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 9. audit_logs — 安全审计日志
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_type VARCHAR(64)     NOT NULL,
    user_id    BIGINT UNSIGNED DEFAULT NULL,
    email      VARCHAR(254)    DEFAULT NULL,
    ip         VARCHAR(64)     DEFAULT NULL,
    user_agent VARCHAR(255)    DEFAULT NULL,
    detail     JSON            DEFAULT NULL,
    created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_audit_event_time (event_type, created_at),
    KEY idx_audit_user_time (user_id, created_at),
    KEY idx_audit_ip_time (ip, created_at),
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 10. announcements — 站内公告
-- ---------------------------------------------------------------------------
CREATE TABLE announcements (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    title      VARCHAR(80)     NOT NULL,
    content    TEXT            NOT NULL,
    link_url   VARCHAR(512)    DEFAULT NULL,
    link_label VARCHAR(32)     DEFAULT NULL,
    enabled    TINYINT(1)      NOT NULL DEFAULT 1,
    pinned     TINYINT(1)      NOT NULL DEFAULT 0,
    priority   INT             NOT NULL DEFAULT 0,
    starts_at  DATETIME        DEFAULT NULL,
    ends_at    DATETIME        DEFAULT NULL,
    created_by BIGINT UNSIGNED DEFAULT NULL,
    updated_by BIGINT UNSIGNED DEFAULT NULL,
    created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ann_active_order (enabled, pinned, priority, id),
    KEY idx_ann_time_window (starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 11. generated_assets — AI 生成图片资产索引
-- ---------------------------------------------------------------------------
CREATE TABLE generated_assets (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED NOT NULL,
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_id      BIGINT UNSIGNED NOT NULL,
    slot_index      INT             NOT NULL,
    storage_kind    ENUM('local', 'cos', 'remote_legacy',
                         'data_legacy', 'missing') NOT NULL,
    storage_key     VARCHAR(512)    DEFAULT NULL,
    public_url      VARCHAR(1024)   DEFAULT NULL,
    source_url      TEXT            DEFAULT NULL,
    mime_type       VARCHAR(64)     DEFAULT NULL,
    width           INT             DEFAULT NULL,
    height          INT             DEFAULT NULL,
    bytes           BIGINT UNSIGNED DEFAULT NULL,
    sha256          VARCHAR(64)     DEFAULT NULL,
    status          ENUM('available', 'missing', 'quarantined')
                                    NOT NULL DEFAULT 'available',
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_asset_message_slot (message_id, slot_index),
    KEY idx_asset_user_created (user_id, created_at, id),
    KEY idx_asset_user_id (user_id, id),
    KEY idx_asset_status_kind (status, storage_kind),
    CONSTRAINT fk_asset_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_asset_conv FOREIGN KEY (conversation_id) REFERENCES conversations (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_asset_msg FOREIGN KEY (message_id) REFERENCES messages (id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 12. upstream_request_logs — 上游请求明细日志
-- ---------------------------------------------------------------------------
CREATE TABLE upstream_request_logs (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    channel_id      BIGINT UNSIGNED DEFAULT NULL,
    user_id         BIGINT UNSIGNED DEFAULT NULL,
    conversation_id BIGINT UNSIGNED DEFAULT NULL,
    message_id      BIGINT UNSIGNED DEFAULT NULL,
    endpoint        VARCHAR(64)     NOT NULL,
    base_url        VARCHAR(512)    NOT NULL,
    status_code     INT             DEFAULT NULL,
    ok              TINYINT(1)      NOT NULL DEFAULT 0,
    used_fallback   TINYINT(1)      NOT NULL DEFAULT 0,
    latency_ms      INT             NOT NULL DEFAULT 0,
    error_code      VARCHAR(64)     DEFAULT NULL,
    error_message   VARCHAR(512)    DEFAULT NULL,
    image_count     INT             DEFAULT NULL,
    model           VARCHAR(128)    DEFAULT NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_upl_channel_time (channel_id, created_at),
    KEY idx_upl_message (message_id),
    KEY idx_upl_endpoint_time (endpoint, created_at),
    KEY idx_upl_ok_time (ok, created_at),
    CONSTRAINT fk_upl_channel FOREIGN KEY (channel_id) REFERENCES upstream_channels (id)
        ON DELETE SET NULL,
    CONSTRAINT fk_upl_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE SET NULL,
    CONSTRAINT fk_upl_conv FOREIGN KEY (conversation_id) REFERENCES conversations (id)
        ON DELETE SET NULL,
    CONSTRAINT fk_upl_message FOREIGN KEY (message_id) REFERENCES messages (id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
