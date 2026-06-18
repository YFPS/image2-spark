"""上游请求监控：记录真实调用明细，并从明细聚合健康指标。"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy import select


@dataclass(frozen=True)
class UpstreamAttempt:
    endpoint: str
    base_url: str
    ok: bool
    latency_ms: int
    status_code: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    used_fallback: bool = False
    model: str | None = None
    image_count: int | None = None
    channel_id: int | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))


@dataclass(frozen=True)
class UpstreamMetricSummary:
    total_requests: int = 0
    total_failures: int = 0
    failure_rate: float = 0.0
    avg_latency_ms: int | None = None
    p95_latency_ms: int | None = None
    recent_requests: int = 0
    recent_failures: int = 0
    recent_p95_latency_ms: int | None = None


def _percentile_nearest_rank(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, int(len(ordered) * percentile + 0.999999))
    return ordered[min(rank, len(ordered)) - 1]


def summarize_upstream_metrics(
    attempts: Iterable[UpstreamAttempt],
    *,
    now: datetime | None = None,
    recent_window: timedelta = timedelta(days=1),
) -> dict[int, UpstreamMetricSummary]:
    """按 channel_id 聚合全部请求和近窗口请求指标。"""
    current = now or datetime.now(tz=timezone.utc)
    recent_since = current - recent_window
    buckets: dict[int, list[UpstreamAttempt]] = {}
    for attempt in attempts:
        if attempt.channel_id is None:
            continue
        buckets.setdefault(attempt.channel_id, []).append(attempt)

    summaries: dict[int, UpstreamMetricSummary] = {}
    for channel_id, rows in buckets.items():
        total = len(rows)
        failures = sum(1 for row in rows if not row.ok)
        latencies = [row.latency_ms for row in rows if row.latency_ms >= 0]
        recent_rows = [row for row in rows if row.created_at >= recent_since]
        recent_latencies = [row.latency_ms for row in recent_rows if row.latency_ms >= 0]
        summaries[channel_id] = UpstreamMetricSummary(
            total_requests=total,
            total_failures=failures,
            failure_rate=round(failures / total * 100, 2) if total else 0.0,
            avg_latency_ms=round(sum(latencies) / len(latencies)) if latencies else None,
            p95_latency_ms=_percentile_nearest_rank(latencies, 0.95),
            recent_requests=len(recent_rows),
            recent_failures=sum(1 for row in recent_rows if not row.ok),
            recent_p95_latency_ms=_percentile_nearest_rank(recent_latencies, 0.95),
        )
    return summaries


async def record_upstream_attempts(
    factory,
    attempts: list[UpstreamAttempt],
    *,
    message_id: int,
    conversation_id: int,
    user_id: int,
    final_success: bool | None = None,
    image_count: int | None = None,
    business_error_code: str | None = None,
    business_error_message: str | None = None,
) -> None:
    """把一次任务里的上游真实调用写入明细表，并同步渠道累计计数。"""
    if not attempts:
        return

    from .models import UpstreamChannel, UpstreamRequestLog

    rows = list(attempts)
    if final_success is not None:
        last = rows[-1]
        rows[-1] = replace(
            last,
            ok=final_success,
            image_count=image_count,
            error_code=None if final_success else business_error_code or last.error_code,
            error_message=None if final_success else business_error_message or last.error_message,
        )

    base_urls = sorted({row.base_url for row in rows})
    async with factory() as db:
        channels = (
            await db.execute(select(UpstreamChannel).where(UpstreamChannel.base_url.in_(base_urls)))
        ).scalars().all()
        by_base_url = {channel.base_url: channel for channel in channels}

        for row in rows:
            channel = by_base_url.get(row.base_url)
            channel_id = channel.id if channel else None
            db.add(
                UpstreamRequestLog(
                    channel_id=channel_id,
                    user_id=user_id,
                    conversation_id=conversation_id,
                    message_id=message_id,
                    endpoint=row.endpoint,
                    base_url=row.base_url,
                    status_code=row.status_code,
                    ok=row.ok,
                    used_fallback=row.used_fallback,
                    latency_ms=row.latency_ms,
                    error_code=row.error_code,
                    error_message=(row.error_message or "")[:512] or None,
                    image_count=row.image_count,
                    model=row.model,
                )
            )
            if channel is not None:
                channel.total_requests = (channel.total_requests or 0) + 1
                if not row.ok:
                    channel.total_failures = (channel.total_failures or 0) + 1
        await db.commit()
