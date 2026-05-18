-- 给 messages 表添加 status 列（pending / done / failed）
-- 用于生图任务化：AI 消息先写 pending、后台 task 回写 done/failed，
-- 解决"前端刷新后丢失生图结果"的 bug
--
-- 执行：mysql -u <user> -p <db> < server/sql/add_message_status.sql

ALTER TABLE messages
  ADD COLUMN status ENUM('done', 'pending', 'failed')
    NOT NULL DEFAULT 'done'
    AFTER params;

-- 校验：列已存在 + 全表默认 done
SELECT
  CONCAT('messages.status added; existing rows defaulted to: ',
         (SELECT GROUP_CONCAT(DISTINCT status) FROM messages)) AS done;
