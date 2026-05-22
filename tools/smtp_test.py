"""QQ 邮箱 SMTP 发信连通性测试脚本。

从 server/.env 读取 SMTP_* 字段，连到 smtp.qq.com 并发一封测试邮件。
仅用于验证 SMTP 配置是否可用，不写入业务代码。

用法（在仓库根目录）::

    python -m tools.smtp_test

或显式指定收件人::

    python -m tools.smtp_test you@example.com

退出码：0 成功；非 0 失败（错误打印到 stderr）。
"""

from __future__ import annotations

import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path


def _load_env_file(path: Path) -> dict[str, str]:
    """极简 dotenv 解析：忽略空行/注释，按 `=` 分割，去掉外层引号。"""
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key:
            data[key] = value
    return data


def _require(env: dict[str, str], key: str) -> str:
    """从合并后的 env 取必填字段，缺失时退出并提示。"""
    value = env.get(key, "").strip()
    if not value:
        print(f"[错误] 缺少环境变量 {key}，请在 server/.env 中填写。", file=sys.stderr)
        sys.exit(2)
    return value


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    env_path = repo_root / "server" / ".env"
    file_env = _load_env_file(env_path)
    # 进程环境变量优先级高于 .env，便于临时覆盖
    env = {**file_env, **{k: v for k, v in os.environ.items() if k.startswith("SMTP_")}}

    host = env.get("SMTP_HOST", "smtp.qq.com").strip()
    port = int(env.get("SMTP_PORT", "465").strip() or "465")
    use_ssl = env.get("SMTP_USE_SSL", "true").strip().lower() in {"1", "true", "yes", "on"}
    user = _require(env, "SMTP_USER")
    password = _require(env, "SMTP_PASS")
    sender_addr = env.get("SMTP_FROM", "").strip() or user
    sender_name = env.get("SMTP_FROM_NAME", "image2").strip()

    # 命令行参数 > SMTP_TEST_TO > 默认发给自己
    if len(sys.argv) > 1:
        to_addr = sys.argv[1].strip()
    else:
        to_addr = env.get("SMTP_TEST_TO", "").strip() or sender_addr

    msg = EmailMessage()
    msg["From"] = formataddr((sender_name, sender_addr))
    msg["To"] = to_addr
    msg["Subject"] = "[image2] SMTP 连通性测试"
    msg["Message-ID"] = make_msgid(domain="image2.local")
    msg.set_content(
        "这是一封来自 image2 的 SMTP 测试邮件。\n"
        f"发件服务器: {host}:{port} (SSL={use_ssl})\n"
        f"发件人: {sender_addr}\n"
        "若你收到了这封邮件，说明 SMTP 配置可用。\n"
    )

    print(f"[1/3] 连接 {host}:{port} (SSL={use_ssl}) …")
    try:
        if use_ssl:
            context = ssl.create_default_context()
            smtp: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=20, context=context)
        else:
            smtp = smtplib.SMTP(host, port, timeout=20)
            smtp.starttls(context=ssl.create_default_context())
    except (smtplib.SMTPException, OSError) as exc:
        print(f"[错误] 连接 SMTP 服务器失败: {exc}", file=sys.stderr)
        return 1

    with smtp:
        try:
            print(f"[2/3] 登录账号 {user} …")
            smtp.login(user, password)
        except smtplib.SMTPAuthenticationError as exc:
            # QQ 邮箱授权码错误通常返回 535
            print(f"[错误] 登录失败（{exc.smtp_code}）: {exc.smtp_error!r}", file=sys.stderr)
            print(
                "提示：QQ 邮箱 SMTP 必须用「授权码」而不是 QQ 密码；"
                "需要先在邮箱设置里开启 SMTP 服务并生成授权码。",
                file=sys.stderr,
            )
            return 1
        except smtplib.SMTPException as exc:
            print(f"[错误] 登录失败: {exc}", file=sys.stderr)
            return 1

        try:
            print(f"[3/3] 发送邮件到 {to_addr} …")
            smtp.send_message(msg)
        except smtplib.SMTPException as exc:
            print(f"[错误] 发送失败: {exc}", file=sys.stderr)
            return 1

    print(f"[OK] 测试邮件已发送到 {to_addr}，请在收件人邮箱中查收。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
