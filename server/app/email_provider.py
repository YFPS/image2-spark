"""邮件 provider 层：抽象 + 多种实现。

- ConsoleEmailProvider：开发期把验证链接写日志，不真实发信。
- NullEmailProvider：测试用，不发外部请求；记录发送参数供断言。
- SmtpEmailProvider：生产默认，走 QQ/腾讯 SMTP（SSL 465 或 STARTTLS）。

所有 provider 共用同一 Protocol，业务层只依赖 `EmailProvider.send_verification_email(...)`，
provider 切换时不影响验证 token、用户状态与积分发放逻辑。
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any, Protocol

from .config import get_settings

logger = logging.getLogger(__name__)


class EmailProvider(Protocol):
    """provider 协议：业务层只依赖此接口。"""

    async def send_verification_email(
        self,
        *,
        to_email: str,
        nickname: str,
        verify_url: str,
        expires_hours: int,
    ) -> None:
        raise NotImplementedError


class ConsoleEmailProvider:
    """开发期 provider：只把验证链接打到日志，不真实发信。

    生产环境禁止使用（main.py 启动校验会拦截）。
    """

    async def send_verification_email(
        self,
        *,
        to_email: str,
        nickname: str,
        verify_url: str,
        expires_hours: int,
    ) -> None:
        logger.warning(
            "邮箱验证链接 provider=console to=%s nickname=%s expires_hours=%s url=%s",
            to_email,
            nickname,
            expires_hours,
            verify_url,
        )


class NullEmailProvider:
    """测试 provider：不发外部请求，仅记录调用参数。"""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    @property
    def sent_count(self) -> int:
        return len(self.sent)

    async def send_verification_email(
        self,
        *,
        to_email: str,
        nickname: str,
        verify_url: str,
        expires_hours: int,
    ) -> None:
        self.sent.append(
            {
                "to_email": to_email,
                "nickname": nickname,
                "verify_url": verify_url,
                "expires_hours": expires_hours,
            }
        )


def _build_verification_message(
    *,
    from_addr: str,
    from_name: str,
    to_email: str,
    nickname: str,
    verify_url: str,
    expires_hours: int,
) -> EmailMessage:
    """组装验证邮件 MIME 消息（含纯文本 + 简单 HTML）。"""
    msg = EmailMessage()
    msg["From"] = formataddr((from_name, from_addr))
    msg["To"] = to_email
    msg["Subject"] = "验证你的 image2 邮箱"
    msg["Message-ID"] = make_msgid(domain="image2.local")
    text_body = (
        f"{nickname}，欢迎使用 image2。\n\n"
        f"请点击以下链接完成邮箱验证，链接 {expires_hours} 小时内有效：\n"
        f"{verify_url}\n\n"
        "如果不是你本人的操作，请忽略此邮件。\n"
    )
    msg.set_content(text_body)
    html_body = f"""
    <div style="font-family: -apple-system, Segoe UI, sans-serif; color:#1f2937; line-height:1.6">
      <p>{nickname}，欢迎使用 <strong>image2</strong>。</p>
      <p>请点击下方按钮完成邮箱验证，链接 {expires_hours} 小时内有效：</p>
      <p>
        <a href="{verify_url}" style="display:inline-block; padding:10px 18px;
            background:#F0FE2D; color:#111; text-decoration:none; border-radius:8px;
            font-weight:600">验证邮箱</a>
      </p>
      <p style="color:#6b7280; font-size:12px">
        若按钮无法点击，请复制以下链接到浏览器打开：<br>
        <span>{verify_url}</span>
      </p>
      <p style="color:#9ca3af; font-size:12px">如果不是你本人的操作，请忽略此邮件。</p>
    </div>
    """
    msg.add_alternative(html_body, subtype="html")
    return msg


def _send_via_smtp_sync(
    *,
    host: str,
    port: int,
    use_ssl: bool,
    user: str,
    password: str,
    msg: EmailMessage,
) -> None:
    """阻塞地把消息发出去；调用方需放到线程池中。"""
    if use_ssl:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(user, password)
            smtp.send_message(msg)


class SmtpEmailProvider:
    """SMTP provider（首版生产默认）：QQ 邮箱授权码登录。

    smtplib 是阻塞 IO，用 `asyncio.to_thread` 推到线程池，避免阻塞事件循环。
    """

    async def send_verification_email(
        self,
        *,
        to_email: str,
        nickname: str,
        verify_url: str,
        expires_hours: int,
    ) -> None:
        settings = get_settings()
        from_addr = settings.smtp_from or settings.smtp_user
        if not (settings.smtp_user and settings.smtp_pass and from_addr):
            raise RuntimeError("SMTP 配置不完整：SMTP_USER / SMTP_PASS / SMTP_FROM 必须配置")
        msg = _build_verification_message(
            from_addr=from_addr,
            from_name=settings.smtp_from_name,
            to_email=to_email,
            nickname=nickname,
            verify_url=verify_url,
            expires_hours=expires_hours,
        )
        try:
            await asyncio.to_thread(
                _send_via_smtp_sync,
                host=settings.smtp_host,
                port=settings.smtp_port,
                use_ssl=settings.smtp_use_ssl,
                user=settings.smtp_user,
                password=settings.smtp_pass,
                msg=msg,
            )
        except smtplib.SMTPException as exc:
            # 让上层把 verification_email_sent 标 false；不让注册失败
            logger.exception("SMTP 发送验证邮件失败 to=%s", to_email)
            raise RuntimeError(f"SMTP send failed: {exc}") from exc


def get_email_provider() -> EmailProvider:
    """根据 EMAIL_PROVIDER 配置返回对应实现。"""
    provider = get_settings().email_provider
    if provider == "console":
        return ConsoleEmailProvider()
    if provider == "null":
        return NullEmailProvider()
    if provider == "smtp":
        return SmtpEmailProvider()
    raise RuntimeError(f"未知 EMAIL_PROVIDER：{provider}")
