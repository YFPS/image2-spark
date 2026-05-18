"""往 test-overlay-2026 账号灌 mock 会话数据，方便可视化测试 timeline rail

使用：
  python scripts/_mock_conversations.py        # 灌入 18 条样本
  python scripts/_mock_conversations.py --clear # 先清空再灌

样本设计：
  - 3 条 pinned（电黄 tick 验证）
  - 15 条 others（按 updated_at 倒序）
  - 标题长度从 4 字到 60+ 字混合，测试胶囊截断
  - 每条会话 0-3 条 user/ai message，覆盖空/有内容场景
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8000"
EMAIL = "test-overlay-2026@example.com"
PASSWORD = "Pass1234abc"

# (title, pinned, [(role, text), ...])
SAMPLES: list[tuple[str, bool, list[tuple[str, str]]]] = [
    # 收藏组（3 条）
    ("赛博朋克城市夜景生成集合", True, [
        ("user", "做一组霓虹灯赛博朋克城市夜景，要有雨水反射和高对比"),
        ("ai", "已生成 4 张 · 1280 tokens"),
        ("user", "把雨调大一点，并加上飞行汽车"),
        ("ai", "已生成 4 张 · 1620 tokens"),
    ]),
    ("品牌主视觉 v2", True, [
        ("user", "设计一个柔和暖色调的咖啡品牌 hero banner"),
        ("ai", "已生成 2 张 · 980 tokens"),
    ]),
    ("常用 prompt 集", True, []),

    # others（15 条，title 长短混合 + 部分空 messages）
    ("中国风山水水墨长卷的多人物对话场景与意境氛围探索", False, [
        ("user", "画一幅中国风的山水水墨画，山中有一座古寺，需要展现晨雾"),
        ("ai", "已生成 1 张 · 420 tokens"),
    ]),
    ("猫咪", False, [
        ("user", "一只橘猫在阳光下打哈欠"),
        ("ai", "已生成 1 张 · 280 tokens"),
    ]),
    ("产品 UI 设计灵感探索", False, [
        ("user", "做几个深色系金融 dashboard 的视觉灵感"),
    ]),
    ("logo iteration 3", False, [
        ("user", "logo 试做 3：扁平 + 单色"),
        ("ai", "已生成 6 张 · 1840 tokens"),
    ]),
    ("失败的尝试", False, [
        ("user", "把这张图做成油画风"),
        ("ai", "失败：upstream_timeout：上游超时"),
    ]),
    ("Studio Ghibli style scene with floating islands and a girl looking up at the sky", False, [
        ("user", "Studio Ghibli style scene with floating islands and a girl looking up at the sky"),
        ("ai", "已生成 3 张 · 1040 tokens"),
    ]),
    ("夜市", False, [
        ("user", "热闹台湾夜市"),
        ("ai", "已生成 1 张 · 320 tokens"),
    ]),
    ("汽车广告视觉草图", False, [
        ("user", "新能源 SUV 广告 hero image，山地背景"),
        ("ai", "已生成 2 张 · 760 tokens"),
    ]),
    ("贴纸 - 表情包系列", False, [
        ("user", "一组 8 个柴犬表情包，统一描边"),
        ("ai", "已生成 8 张 · 2240 tokens"),
        ("user", "换成柯基"),
        ("ai", "已生成 8 张 · 2180 tokens"),
    ]),
    ("仅一句", False, [("user", "测试空回复")]),
    ("空会话占位", False, []),
    ("书法 ink wash 写意人物", False, [
        ("user", "传统书法风格的诗人剪影"),
        ("ai", "已生成 1 张 · 340 tokens"),
    ]),
    ("电影海报 - 火星救援续作", False, [
        ("user", "复古胶片质感的火星救援续作电影海报"),
        ("ai", "已生成 2 张 · 880 tokens"),
    ]),
    ("封面图设计", False, [
        ("user", "科技博客封面图，渐变 + 抽象几何"),
        ("ai", "已生成 4 张 · 1200 tokens"),
    ]),
    ("a", False, [("user", "test extremely short title")]),
    ("一只穿着宇航服的柴犬漂浮在月球轨道上俯瞰地球", False, [
        ("user", "一只穿着宇航服的柴犬漂浮在月球轨道上俯瞰地球，电影级"),
        ("ai", "已生成 1 张 · 460 tokens"),
    ]),
    ("插画风 - 老式咖啡馆", False, [
        ("user", "怀旧 70 年代风格的老式咖啡馆插画"),
        ("ai", "已生成 2 张 · 640 tokens"),
    ]),
]


def req(method: str, url: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def login() -> str:
    code, body = req("POST", f"{BASE}/api/auth/login",
                     {"email": EMAIL, "password": PASSWORD})
    if code != 200:
        print(f"登录失败 {code}: {body}", file=sys.stderr)
        sys.exit(1)
    return json.loads(body)["access_token"]


def clear_all(token: str) -> None:
    code, body = req("GET", f"{BASE}/api/conversations", token=token)
    if code != 200:
        print(f"拉列表失败 {code}: {body}", file=sys.stderr)
        return
    items = json.loads(body)
    print(f"清理 {len(items)} 条已有会话...")
    for c in items:
        req("DELETE", f"{BASE}/api/conversations/{c['id']}", token=token)


def seed(token: str) -> None:
    for title, pinned, messages in SAMPLES:
        # 创建会话
        code, body = req("POST", f"{BASE}/api/conversations", token=token)
        if code != 201:
            print(f"create 失败 {code}: {body}", file=sys.stderr)
            continue
        conv_id = json.loads(body)["id"]

        # 写消息（自动回填 title 为首条 user.text 前 30 字——如果不希望，先 PATCH title）
        # 我们这里要求 title 由 SAMPLES 控制，所以直接 PATCH
        for role, text in messages:
            req("POST", f"{BASE}/api/conversations/{conv_id}/messages",
                {"role": role, "text": text}, token=token)

        # 覆盖 title + 设置 pinned
        patch_body: dict = {"title": title}
        if pinned:
            patch_body["pinned"] = True
        req("PATCH", f"{BASE}/api/conversations/{conv_id}",
            patch_body, token=token)
        print(f"  + {conv_id:>3} [{('★' if pinned else ' ')}] {title[:40]}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clear", action="store_true", help="灌入前先清空账号下所有会话")
    args = parser.parse_args()

    token = login()
    if args.clear:
        clear_all(token)

    seed(token)
    print(f"\n完成。共 {len(SAMPLES)} 条样本写入。刷新浏览器查看。")


if __name__ == "__main__":
    main()
