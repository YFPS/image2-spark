-- 测试用：30 条 conversations，每条 30 轮（60 条 messages：user/ai 各 30）
--
-- 时间分布覆盖 HistoryDropdown 全部分组：今天 6 / 昨天 5 / 本周 6 / 本月 8 / 更早 5
-- 4 条 pinned（#1 #7 #16 #27）
-- 每条会话的首条 user message 是真实主题（作 preview）；后续 29 轮用泛化文本保持上下文感
-- 每轮间隔 2 分钟，会话总时长约 2 小时
--
-- 用前修改下面 @uid 行的 email；执行 mysql -u <user> -p <db> < server/sql/seed_test_history.sql

-- ⚠️ 运行前将下方邮箱替换为数据库中存在的用户邮箱
SET @uid := (SELECT id FROM users WHERE email = 'your-email@example.com' LIMIT 1);
SELECT
  CASE WHEN @uid IS NULL THEN
    (SELECT 0 FROM users WHERE 1/0)  -- 触发除零异常，强行报错避免误插
  ELSE
    CONCAT('Seeding for user_id = ', @uid)
  END AS bootstrap;

-- ============ 公共宏：用递归 CTE 一次性插 60 条 messages ============
-- 调用前先设：@c=会话 id，@base=起始时间，@first_user=首条用户提示词，@first_ai=首条 AI 回复，@topic=主题词
--
-- 为避免每段都重复整段 CTE，下方每段直接展开。INSERT...WITH RECURSIVE...SELECT 是 MySQL 8.0+ 语法

-- ============ 今天 6 条 ============

-- #1 pinned
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '海报字体探索', 1, DATE_SUB(NOW(), INTERVAL 1 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 1 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 1 HOUR);
SET @first_user := '帮我设计一张科技感海报，主标题要紧凑有力，副标题轻盈一点';
SET @first_ai := '已经生成 4 张方案，主标题用 Inter Bold 收紧字距，副标题用 Light';
SET @topic := '海报字体';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT('再继续调整下", @topic, "的细节，第 ', (n+1) DIV 2, ' 轮')
    ELSE CONCAT('好的，第 ', n DIV 2, ' 轮调整完成，已经输出新版本')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #2
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '黑金赛博朋克角色', 0, DATE_SUB(NOW(), INTERVAL 3 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 3 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 3 HOUR);
SET @first_user := '霓虹灯下半身机械的女主角，雨夜的东京涩谷十字路口';
SET @first_ai := '已生成，重点强化了机械部分的金色反光和雨滴层次';
SET @topic := '赛博朋克角色';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT('继续调整', @topic, '，第 ', (n+1) DIV 2, ' 轮：换个姿势/视角试试')
    ELSE CONCAT('好的，第 ', n DIV 2, ' 轮已经按要求重新构图')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #3
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '极简产品图', 0, DATE_SUB(NOW(), INTERVAL 5 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 5 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 5 HOUR);
SET @first_user := '纯白背景的香水瓶，柔和顶光，玻璃质感和水珠细节';
SET @first_ai := '出了一组，已经做了 4 个不同角度的版本';
SET @topic := '香水瓶产品图';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：再调一下光位和水珠分布')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，光位上移，水珠集中在中段')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #4
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '美食杂志风蛋糕', 0, DATE_SUB(NOW(), INTERVAL 7 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 7 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 7 HOUR);
SET @first_user := '俯拍切开的草莓蛋糕，奶油有质感，景深虚化，杂志封面感';
SET @first_ai := '完成，奶油纹理和草莓汁的流动感都强化了';
SET @topic := '草莓蛋糕';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换个角度试试')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，已切换到 45 度俯角')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #5
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '极光夜景', 0, DATE_SUB(NOW(), INTERVAL 10 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 10 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 10 HOUR);
SET @first_user := '冰岛雪山下湖面倒映的绿色极光，星空清晰可见';
SET @first_ai := '已生成，倒影和星空都做了细节增强';
SET @topic := '极光';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：极光颜色偏紫一点')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，紫色权重已上调')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #6
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '中世纪魔法师', 0, DATE_SUB(NOW(), INTERVAL 13 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 13 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 13 HOUR);
SET @first_user := '老魔法师在塔楼藏书阁施法，浮空发光的符文环绕';
SET @first_ai := '已完成，符文光效用了暖金色调，环境带烛光氛围';
SET @topic := '魔法师';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：再加几道符文')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，符文密度增加了')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- ============ 昨天 5 条 ============

-- #7 pinned
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '童话风插画', 1, DATE_SUB(NOW(), INTERVAL 26 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 26 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 26 HOUR);
SET @first_user := '蘑菇屋外的小狐狸，水彩晕染，吉卜力风格';
SET @first_ai := '4 张，水彩纸纹理和柔和高光都还原了';
SET @topic := '童话插画';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换个场景再来一张')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，场景已替换并保留风格')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #8
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '微缩模型城市', 0, DATE_SUB(NOW(), INTERVAL 30 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 30 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 30 HOUR);
SET @first_user := '俯拍东京街道的微缩模型效果，景深虚化';
SET @first_ai := '生成完成，强化了 tilt-shift 的虚实对比';
SET @topic := '微缩城市';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换成大阪试试')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，已切换到大阪场景')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #9
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '国风武侠人物', 0, DATE_SUB(NOW(), INTERVAL 34 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 34 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 34 HOUR);
SET @first_user := '竹林中的剑客，长袍飘动，水墨写意配工笔细节';
SET @first_ai := '已经出图，主体工笔，背景水墨，留白足够';
SET @topic := '武侠剑客';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：剑光做明显些')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，剑光加了发光描边')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #10
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '复古胶片色彩', 0, DATE_SUB(NOW(), INTERVAL 38 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 38 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 38 HOUR);
SET @first_user := '上世纪 80 年代香港街头，霓虹招牌，柯达胶片色调';
SET @first_ai := '色调用了 Portra 风格，颗粒感和褪色都加了';
SET @topic := '胶片香港';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：颗粒感再强一点')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，颗粒密度上调了')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #11
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '太空殖民地', 0, DATE_SUB(NOW(), INTERVAL 42 HOUR), DATE_ADD(DATE_SUB(NOW(), INTERVAL 42 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 42 HOUR);
SET @first_user := '环状空间站内部，模拟地球重力，远景是巨大的木星';
SET @first_ai := '已生成，环面透视和木星纹理都到位';
SET @topic := '空间站';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：加几个工作人员')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，远景人员已添加')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- ============ 本周内 6 条（2-6 天前）============

-- #12
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, 'logo 设计草稿', 0, DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 2 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 2 DAY);
SET @first_user := '想做一个像 Stripe 那种简洁的科技公司 logo';
SET @first_ai := '出了 6 个方向，几何抽象和文字 mark 都有';
SET @topic := 'logo';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换个配色试试')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，配色已切换')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #13
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '宠物拟人化', 0, DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 3 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 3 DAY);
SET @first_user := '把我家橘猫画成穿西装的绅士，叼着烟斗坐在皮椅上';
SET @first_ai := '完成，毛色保留了橘猫橙白条纹，西装做了三种配色';
SET @topic := '橘猫绅士';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换个表情')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，表情已调整')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #14
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '蒸汽朋克机器人', 0, DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 4 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 4 DAY);
SET @first_user := '黄铜齿轮+蒸汽管道的工业革命风格机器人，背景是工厂';
SET @first_ai := '出了 4 张不同体型，齿轮转动方向都做了一致性';
SET @topic := '蒸汽机器人';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：齿轮再大一些')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，齿轮尺寸已放大')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #15
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '水下世界', 0, DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 5 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 5 DAY);
SET @first_user := '深海珊瑚礁，五颜六色的鱼群穿梭，光柱从水面下穿透';
SET @first_ai := '完成，光柱和泡泡的体积感都加了';
SET @topic := '水下珊瑚';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：加一只海龟')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，海龟已加入构图')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #16 pinned
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '雪山日出', 1, DATE_SUB(NOW(), INTERVAL 6 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 6 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 6 DAY);
SET @first_user := '阿尔卑斯山日出，金色阳光打在雪峰上，云海在山腰';
SET @first_ai := '4 张完成，金光的色温和云海层次都仔细调过';
SET @topic := '雪山日出';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：金色再暖一点')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，色温已加 200K')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #17
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '时尚街拍', 0, DATE_SUB(DATE_SUB(NOW(), INTERVAL 6 DAY), INTERVAL 6 HOUR), DATE_ADD(DATE_SUB(DATE_SUB(NOW(), INTERVAL 6 DAY), INTERVAL 6 HOUR), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(DATE_SUB(NOW(), INTERVAL 6 DAY), INTERVAL 6 HOUR);
SET @first_user := '巴黎街头的时尚街拍，模特穿黑色风衣，电影感构图';
SET @first_ai := '出图完成，街道纵深和模特姿态都符合街拍语言';
SET @topic := '街拍';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换个街角')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，街角已切换')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- ============ 本月 8 条（7-30 天前）============

-- #18
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '新中式建筑场景', 0, DATE_SUB(NOW(), INTERVAL 8 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 8 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 8 DAY);
SET @first_user := '苏州园林的雪景，雕花窗与梅花，水墨写意';
SET @first_ai := '4 张完成，留白和雪景细节做了平衡';
SET @topic := '园林雪景';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：梅花加密一些')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，梅花密度增加')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #19
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '电影海报：未来废土', 0, DATE_SUB(NOW(), INTERVAL 11 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 11 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 11 DAY);
SET @first_user := '末日后的城市废墟，远景巨大的红色月亮，残破飞行器';
SET @first_ai := '完成，月亮做了灰红色调，飞行器残骸有金属反光';
SET @topic := '废土';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：月亮再大一点')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，月亮尺寸已放大')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #20
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '童话森林小屋', 0, DATE_SUB(NOW(), INTERVAL 14 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 14 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 14 DAY);
SET @first_user := '森林深处的圆顶小屋，窗户透出暖黄光，雪花飘落';
SET @first_ai := '出图，雪花和窗光的层次都有';
SET @topic := '森林小屋';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：加几只鹿')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，鹿群已加入')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #21
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '高级商务人像', 0, DATE_SUB(NOW(), INTERVAL 17 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 17 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 17 DAY);
SET @first_user := '30 岁亚洲男性 CEO，黑色西装，办公室落地窗背景，专业感';
SET @first_ai := '完成，眼神和姿态都做了专业稳重的处理';
SET @topic := '商务人像';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换灰色西装试试')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，西装已换灰色')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #22
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '火星基地', 0, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 20 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 20 DAY);
SET @first_user := '火星表面的人类殖民基地，红色沙尘风暴，圆顶建筑群';
SET @first_ai := '出图，沙尘和圆顶反光都强化了';
SET @topic := '火星基地';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：加宇航员')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，宇航员已加入')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #23
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '抽象几何艺术', 0, DATE_SUB(NOW(), INTERVAL 23 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 23 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 23 DAY);
SET @first_user := '蒙德里安风格的几何色块，红黄蓝三原色，黑色粗线条';
SET @first_ai := '出了一组，比例和留白严格按照蒙德里安的逻辑';
SET @topic := '几何';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：色块再大一些')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，色块比例已调整')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #24
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '卡通汽车', 0, DATE_SUB(NOW(), INTERVAL 26 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 26 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 26 DAY);
SET @first_user := '皮克斯风格的拟人化卡通赛车，大眼睛车头，色彩饱和';
SET @first_ai := '完成，眼神有性格，车身金属漆有反光';
SET @topic := '卡通赛车';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换红色车身')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，车身已换红')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #25
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '水墨山水', 0, DATE_SUB(NOW(), INTERVAL 29 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 29 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 29 DAY);
SET @first_user := '黄山云海，远山近景层次，文人画风格，宣纸质感';
SET @first_ai := '出图，远近虚实和宣纸纹理都到位';
SET @topic := '黄山';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：再加一个亭子')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，亭子已加入近景')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- ============ 更早 5 条（35-180 天前）============

-- #26
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '复古旅行海报', 0, DATE_SUB(NOW(), INTERVAL 38 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 38 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 38 DAY);
SET @first_user := '1950 年代风格的旅行宣传海报，地中海小镇';
SET @first_ai := '完成，配色和字体都用了那个年代的语言';
SET @topic := '复古海报';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换城市试试')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，城市已切换')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #27 pinned
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '巴洛克风格肖像', 1, DATE_SUB(NOW(), INTERVAL 52 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 52 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 52 DAY);
SET @first_user := '17 世纪宫廷肖像，黄金色调，深暗背景，戏剧光影';
SET @first_ai := '4 张完成，光影对比和服饰细节都强化了';
SET @topic := '巴洛克肖像';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换女性主体')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，主体已换女性')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #28
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '蓝调爵士俱乐部', 0, DATE_SUB(NOW(), INTERVAL 78 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 78 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 78 DAY);
SET @first_user := '昏暗的爵士酒吧，台上吹萨克斯的黑人乐手，烟雾缭绕';
SET @first_ai := '出图完成，烟雾和聚光灯氛围都到位';
SET @topic := '爵士俱乐部';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：换钢琴手')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，主体换为钢琴手')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #29
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '北欧极简室内', 0, DATE_SUB(NOW(), INTERVAL 110 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 110 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 110 DAY);
SET @first_user := '北欧极简客厅，浅木色家具，米白墙面，大落地窗自然光';
SET @first_ai := '完成，色调克制，自然光的方向感很强';
SET @topic := '北欧客厅';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：加点绿植')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，已加 3 盆绿植')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- #30
INSERT INTO conversations (user_id, title, pinned, created_at, updated_at)
VALUES (@uid, '古埃及神庙', 0, DATE_SUB(NOW(), INTERVAL 165 DAY), DATE_ADD(DATE_SUB(NOW(), INTERVAL 165 DAY), INTERVAL 120 MINUTE));
SET @c := LAST_INSERT_ID();
SET @base := DATE_SUB(NOW(), INTERVAL 165 DAY);
SET @first_user := '古埃及卡尔纳克神庙的巨柱大厅，黄昏的金光斜射进来';
SET @first_ai := '出图完成，金光打在象形文字浮雕上有浓厚史诗感';
SET @topic := '埃及神庙';
INSERT INTO messages (conversation_id, role, text, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 60)
SELECT @c,
  IF(n % 2 = 1, 'user', 'ai'),
  CASE
    WHEN n = 1 THEN @first_user
    WHEN n = 2 THEN @first_ai
    WHEN n % 2 = 1 THEN CONCAT(@topic, ' 第 ', (n+1) DIV 2, ' 轮：再加一些人物')
    ELSE CONCAT('完成第 ', n DIV 2, ' 轮，已加入祭司剪影')
  END,
  DATE_ADD(@base, INTERVAL n * 2 MINUTE)
FROM seq;

-- ============ 完成 ============
SELECT
  CONCAT('Seeded ', COUNT(DISTINCT c.id), ' conversations, ',
         (SELECT COUNT(*) FROM messages m
          JOIN conversations cc ON cc.id = m.conversation_id
          WHERE cc.user_id = @uid AND cc.deleted_at IS NULL), ' messages, for user_id = ', @uid) AS done
FROM conversations c
WHERE c.user_id = @uid AND c.deleted_at IS NULL;
