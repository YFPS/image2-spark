import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import * as api from "../api/admin";
import type {
  DashboardStats, AdminUser, AdminAccessLog, AdminOpLog,
  DAUItem, TrafficStats, UpstreamChannel, UpstreamHealth,
  AdminDataTableKey, AdminDataTableMeta, AdminDataTablePage, AdminDataTableRow,
  AdminConversationListItem, AdminConversationDetail, AdminImageAsset,
} from "../api/admin";

type Tab = "dashboard" | "users" | "logs" | "images" | "data" | "upstreams" | "monitor";

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "概览" },
  { key: "users", label: "用户" },
  { key: "logs", label: "日志" },
  { key: "images", label: "图片" },
  { key: "data", label: "用户数据" },
  { key: "upstreams", label: "渠道" },
  { key: "monitor", label: "监控" },
];

const DATA_TABLE_FALLBACKS: AdminDataTableMeta[] = [
  { key: "conversations", label: "会话", columns: ["id", "user_id", "title", "pinned", "created_at", "updated_at", "deleted_at"] },
  { key: "messages", label: "消息", columns: ["id", "conversation_id", "role", "text", "image_urls", "params", "status", "created_at"] },
  { key: "credit_transactions", label: "积分流水", columns: ["id", "user_id", "delta", "balance_after", "reason", "ref_type", "ref_id", "note", "created_at"] },
  { key: "email_verification_tokens", label: "邮箱验证", columns: ["id", "user_id", "token_hash", "purpose", "expires_at", "used_at", "created_at"] },
  { key: "generated_assets", label: "生成资产", columns: ["id", "user_id", "conversation_id", "message_id", "slot_index", "storage_kind", "storage_key", "public_url", "source_url", "mime_type", "width", "height", "bytes", "sha256", "status", "created_at", "updated_at"] },
];

function cls(...xs: (string | false | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

// ===== 概览 =====
function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [traffic, setTraffic] = useState<TrafficStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.getDashboard().then(setStats).catch((e) => setError(e.message || "加载仪表盘失败"));
    api.getTraffic().then(setTraffic).catch((e) => setError(e.message || "加载流量统计失败"));
  }, []);
  if (error) return <div className="text-red-400 text-[13px]">{error}</div>;
  if (!stats) return <div className="text-white/40">加载中…</div>;
  const cards = [
    { label: "总用户", value: String(stats.total_users), sub: `今日 +${stats.today_registrations}` },
    { label: "今日活跃", value: String(stats.today_active_users) },
    { label: "总生图", value: String(stats.total_images_generated), sub: `今日 +${stats.today_images_generated}` },
    { label: "总消耗积分", value: String(stats.total_credits_consumed), sub: `今日 +${stats.today_credits_consumed}` },
    { label: "今日请求", value: String(traffic?.today_requests ?? "…") },
    { label: "平均耗时", value: traffic ? `${traffic.avg_duration_ms}ms` : "…" },
    { label: "错误率", value: traffic ? `${traffic.error_rate}%` : "…" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-[14px] bg-white/[0.04] p-4">
            <div className="text-[12px] text-white/40">{c.label}</div>
            <div className="mt-1 text-[22px] font-semibold text-white/90">{c.value}</div>
            {c.sub && <div className="text-[11px] text-white/30">{c.sub}</div>}
          </div>
        ))}
      </div>
      {traffic?.top_paths && traffic.top_paths.length > 0 && (
        <div className="rounded-[14px] bg-white/[0.04] p-4">
          <div className="mb-2 text-[13px] font-medium text-white/60">热门路径</div>
          {traffic.top_paths.map((p) => (
            <div key={p.path} className="flex justify-between py-1 text-[12px] text-white/50">
              <span className="font-mono">{p.path}</span>
              <span>{p.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== 用户管理 =====
function UsersTab() {
  const [data, setData] = useState<api.Paged<AdminUser> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editNick, setEditNick] = useState("");
  const [editRole, setEditRole] = useState<AdminUser["role"]>("user");
  const [editCredits, setEditCredits] = useState(0);
  const [creditModal, setCreditModal] = useState<AdminUser | null>(null);
  const [creditDelta, setCreditDelta] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getUsers({ page, page_size: 20, search: search || undefined })
      .then(setData)
      .catch((e) => setError(e.message || "加载用户列表失败"));
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    setEditNick(u.nickname);
    setEditRole(u.role);
    setEditCredits(u.credits);
  };

  const handleUpdate = async (id: number, fields: Partial<AdminUser>) => {
    try {
      await api.updateUser(id, fields);
      setEditing(null);
      load();
    } catch (e: any) {
      setError(e.message || "更新用户失败");
    }
  };

  const handleAdjustCredits = async () => {
    if (!creditModal || !creditDelta) return;
    try {
      await api.adjustCredits(creditModal.id, Number(creditDelta), creditNote);
      setCreditModal(null);
      setCreditDelta("");
      setCreditNote("");
      load();
    } catch (e: any) {
      setError(e.message || "调整积分失败");
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-red-400 text-[13px]">{error}</div>}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-[10px] bg-white/[0.06] px-3 py-2 text-[13px] text-white/90 outline-none placeholder:text-white/30"
          placeholder="搜索邮箱或昵称…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-white/40">
              <th className="px-2 py-2 text-left">ID</th>
              <th className="px-2 py-2 text-left">邮箱</th>
              <th className="px-2 py-2 text-left">昵称</th>
              <th className="px-2 py-2 text-left">角色</th>
              <th className="px-2 py-2 text-right">积分</th>
              <th className="px-2 py-2 text-center">状态</th>
              <th className="px-2 py-2 text-left">注册时间</th>
              <th className="px-2 py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-2 py-2">{u.id}</td>
                <td className="px-2 py-2 max-w-[180px] truncate">{u.email}</td>
                <td className="px-2 py-2">{u.nickname}</td>
                <td className="px-2 py-2">
                  <span className={cls(
                    "rounded px-1.5 py-0.5 text-[11px]",
                    u.role === "admin" && "bg-amber-500/20 text-amber-300",
                    u.role === "paid" && "bg-emerald-500/20 text-emerald-300",
                    u.role === "user" && "bg-white/[0.06] text-white/50",
                  )}>{u.role}</span>
                </td>
                <td className="px-2 py-2 text-right">{u.credits}</td>
                <td className="px-2 py-2 text-center">
                  {u.disabled ? (
                    <span className="text-red-400">封禁</span>
                  ) : (
                    <span className="text-emerald-400">正常</span>
                  )}
                </td>
                <td className="px-2 py-2 text-white/40">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-2 py-2 text-center space-x-1">
                  <button onClick={() => openEdit(u)} className="rounded bg-white/[0.06] px-2 py-0.5 text-[11px] hover:bg-white/10">编辑</button>
                  <button onClick={() => { setCreditModal(u); setCreditDelta(""); setCreditNote(""); }} className="rounded bg-white/[0.06] px-2 py-0.5 text-[11px] hover:bg-white/10">调积分</button>
                  <button
                    onClick={() => handleUpdate(u.id, { disabled: !u.disabled })}
                    className={cls("rounded px-2 py-0.5 text-[11px]", u.disabled ? "bg-emerald-500/20 hover:bg-emerald-500/30" : "bg-red-500/20 hover:bg-red-500/30")}
                  >
                    {u.disabled ? "解封" : "封禁"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.total > data.page_size && (
        <div className="flex items-center justify-center gap-3 text-[12px]">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded bg-white/[0.06] px-3 py-1 disabled:opacity-30">上一页</button>
          <span className="text-white/40">{page} / {Math.ceil(data.total / data.page_size)}</span>
          <button disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => setPage(page + 1)} className="rounded bg-white/[0.06] px-3 py-1 disabled:opacity-30">下一页</button>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={() => setEditing(null)}>
          <div className="w-[360px] space-y-3 rounded-[16px] bg-[#1e1e22] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-medium">编辑用户 #{editing.id}</div>
            <label className="block text-[12px] text-white/40">昵称
              <input value={editNick} onChange={(e) => setEditNick(e.target.value)} className="mt-1 w-full rounded-[8px] bg-white/[0.06] px-3 py-2 text-[13px] text-white/90 outline-none" />
            </label>
            <label className="block text-[12px] text-white/40">角色
              <select value={editRole} onChange={(e) => setEditRole(e.target.value as AdminUser["role"])} className="mt-1 w-full rounded-[8px] bg-white/[0.06] px-3 py-2 text-[13px] text-white/90 outline-none">
                <option value="user">user</option>
                <option value="paid">paid</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label className="block text-[12px] text-white/40">积分
              <input type="number" value={editCredits} onChange={(e) => setEditCredits(Number(e.target.value))} className="mt-1 w-full rounded-[8px] bg-white/[0.06] px-3 py-2 text-[13px] text-white/90 outline-none" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-[8px] bg-white/[0.06] px-4 py-2 text-[13px]">取消</button>
              <button onClick={() => handleUpdate(editing.id, { nickname: editNick, role: editRole, credits: editCredits })} className="rounded-[8px] bg-amber-500/80 px-4 py-2 text-[13px] text-black">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 调积分弹窗 */}
      {creditModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={() => setCreditModal(null)}>
          <div className="w-[320px] space-y-3 rounded-[16px] bg-[#1e1e22] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-medium">调整积分 — {creditModal.nickname}</div>
            <div className="text-[12px] text-white/40">当前积分: {creditModal.credits}</div>
            <input type="number" value={creditDelta} onChange={(e) => setCreditDelta(e.target.value)} placeholder="输入调整值（正数加，负数减）" className="w-full rounded-[8px] bg-white/[0.06] px-3 py-2 text-[13px] text-white/90 outline-none placeholder:text-white/30" />
            <input value={creditNote} onChange={(e) => setCreditNote(e.target.value)} placeholder="备注（可选）" className="w-full rounded-[8px] bg-white/[0.06] px-3 py-2 text-[13px] text-white/90 outline-none placeholder:text-white/30" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCreditModal(null)} className="rounded-[8px] bg-white/[0.06] px-4 py-2 text-[13px]">取消</button>
              <button onClick={handleAdjustCredits} disabled={!creditDelta} className="rounded-[8px] bg-amber-500/80 px-4 py-2 text-[13px] text-black disabled:opacity-40">确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 日志 =====
function LogsTab() {
  const [tab, setTab] = useState<"access" | "ops">("access");
  const [accessData, setAccessData] = useState<api.Paged<AdminAccessLog> | null>(null);
  const [opsData, setOpsData] = useState<api.Paged<AdminOpLog> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    if (tab === "access") api.getAccessLogs({ page }).then(setAccessData).catch((e) => setError(e.message || "加载日志失败"));
    else api.getAdminLogs({ page }).then(setOpsData).catch((e) => setError(e.message || "加载日志失败"));
  }, [tab, page]);

  return (
    <div className="space-y-3">
      {error && <div className="text-red-400 text-[13px]">{error}</div>}
      <div className="flex gap-2">
        {(["access", "ops"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cls("rounded-[8px] px-3 py-1.5 text-[12px]", tab === t ? "bg-white/10 text-white" : "text-white/40 hover:bg-white/[0.04]")}>
            {t === "access" ? "访问日志" : "操作日志"}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        {tab === "access" ? (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-white/40">
                <th className="px-2 py-2 text-left">方法</th>
                <th className="px-2 py-2 text-left">路径</th>
                <th className="px-2 py-2 text-center">状态</th>
                <th className="px-2 py-2 text-right">耗时</th>
                <th className="px-2 py-2 text-left">IP</th>
                <th className="px-2 py-2 text-left">时间</th>
              </tr>
            </thead>
            <tbody>
              {accessData?.items.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.04]">
                  <td className="px-2 py-1.5">{r.method}</td>
                  <td className="max-w-[250px] truncate px-2 py-1.5 font-mono text-[11px]">{r.path}</td>
                  <td className={cls("px-2 py-1.5 text-center", r.status_code >= 400 ? "text-red-400" : "text-emerald-400")}>{r.status_code}</td>
                  <td className="px-2 py-1.5 text-right">{r.duration_ms}ms</td>
                  <td className="px-2 py-1.5 text-white/40">{r.ip}</td>
                  <td className="px-2 py-1.5 text-white/40">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-white/40">
                <th className="px-2 py-2 text-left">操作</th>
                <th className="px-2 py-2 text-left">目标</th>
                <th className="px-2 py-2 text-left">详情</th>
                <th className="px-2 py-2 text-left">IP</th>
                <th className="px-2 py-2 text-left">时间</th>
              </tr>
            </thead>
            <tbody>
              {opsData?.items.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.04]">
                  <td className="px-2 py-1.5">{r.action}</td>
                  <td className="px-2 py-1.5 text-white/40">{r.target_type}#{r.target_id}</td>
                  <td className="max-w-[200px] truncate px-2 py-1.5 font-mono text-[11px] text-white/40">{r.detail ? JSON.stringify(r.detail) : "—"}</td>
                  <td className="px-2 py-1.5 text-white/40">{r.ip}</td>
                  <td className="px-2 py-1.5 text-white/40">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {(() => {
        const d = tab === "access" ? accessData : opsData;
        if (!d || d.total <= d.page_size) return null;
        return (
          <div className="flex items-center justify-center gap-3 text-[12px]">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded bg-white/[0.06] px-3 py-1 disabled:opacity-30">上一页</button>
            <span className="text-white/40">{page} / {Math.ceil(d.total / d.page_size)}</span>
            <button disabled={page >= Math.ceil(d.total / d.page_size)} onClick={() => setPage(page + 1)} className="rounded bg-white/[0.06] px-3 py-1 disabled:opacity-30">下一页</button>
          </div>
        );
      })()}
    </div>
  );
}

// ===== 图片管理 =====
function ImagesTab() {
  const [data, setData] = useState<api.Paged<AdminImageAsset> | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getImages({ page, status: statusFilter || undefined }).then(setData).catch((e) => setError(e.message || "加载图片资产失败"));
  }, [page, statusFilter]);

  const handleDelete = async (id: number) => {
    if (!confirm("确认隐藏这张图片资产？")) return;
    try {
      await api.deleteImage(id);
      setData((prev) => prev ? { ...prev, items: prev.items.map((i) => i.id === id ? { ...i, image_url: null, status: "quarantined" } : i) } : prev);
    } catch (e: any) {
      setError(e.message || "隐藏图片失败");
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-red-400 text-[13px]">{error}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-medium text-white/90">全站图片资产</div>
          <div className="text-[11px] text-white/35">按用户汇总所有生成图片，可用图片优先显示</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: "", label: "全部资产" },
            { value: "available", label: "只看可用图片" },
            { value: "missing", label: "只看缺失记录" },
            { value: "quarantined", label: "只看已隐藏" },
          ].map((item) => (
            <button
              key={item.value || "all"}
              onClick={() => { setStatusFilter(item.value); setPage(1); }}
              className={cls(
                "rounded-[9px] px-3 py-1.5 text-[12px]",
                statusFilter === item.value ? "bg-white/10 text-white" : "bg-white/[0.04] text-white/45 hover:bg-white/[0.07]",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {data?.items.map((asset) => (
          <div key={asset.id} className="group relative overflow-hidden rounded-[12px] bg-white/[0.04] ring-1 ring-white/[0.04]">
            {asset.image_url ? (
              <img src={asset.image_url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex aspect-square flex-col items-center justify-center gap-1 text-[12px] text-white/24">
                <span>{formatTableCell("status", asset.status)}</span>
                <span className="text-[10px] text-white/18">{formatTableCell("storage_kind", asset.storage_kind)}</span>
              </div>
            )}
            <div className="absolute left-2 top-2 rounded bg-black/55 px-2 py-1 text-[10px] text-white/70">
              {formatTableCell("status", asset.status)}
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
              <div className="text-[11px] text-white/78">资产编号 {asset.id} · 用户 {asset._user?.nickname || asset._user?.email || asset.user_id}</div>
              <div className="text-[10px] text-white/45">消息 {asset.message_id} · 对话 {asset.conversation_id}</div>
              <div className="text-[10px] text-white/45">
                {formatTableCell("width", asset.width)}×{formatTableCell("height", asset.height)} · {formatTableCell("bytes", asset.bytes)}
              </div>
              <div className="text-[10px] text-white/35">{new Date(asset.created_at).toLocaleString()}</div>
              {asset.image_url && (
                <div className="mt-1 flex gap-1.5">
                  <a href={asset.image_url} target="_blank" rel="noreferrer" className="rounded bg-white/[0.12] px-2 py-0.5 text-[10px] hover:bg-white/[0.18]">打开图片</a>
                  <button onClick={() => handleDelete(asset.id)} className="rounded bg-red-500/30 px-2 py-0.5 text-[10px] hover:bg-red-500/50">隐藏图片</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {data && data.total > data.page_size && (
        <div className="flex items-center justify-center gap-3 text-[12px]">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded bg-white/[0.06] px-3 py-1 disabled:opacity-30">上一页</button>
          <span className="text-white/40">{page} / {Math.ceil(data.total / data.page_size)}</span>
          <button disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => setPage(page + 1)} className="rounded bg-white/[0.06] px-3 py-1 disabled:opacity-30">下一页</button>
        </div>
      )}
    </div>
  );
}

// ===== 用户数据可视化 =====
const FIELD_LABELS: Record<string, string> = {
  id: "记录编号",
  user_id: "用户编号",
  conversation_id: "对话编号",
  message_id: "消息编号",
  title: "标题",
  pinned: "置顶",
  role: "角色",
  text: "内容",
  image_urls: "图片",
  params: "生成参数",
  status: "状态",
  delta: "积分变化",
  balance_after: "变动后余额",
  reason: "变动原因",
  ref_type: "关联类型",
  ref_id: "关联编号",
  note: "备注",
  token_hash: "验证凭证",
  purpose: "用途",
  expires_at: "过期时间",
  used_at: "使用时间",
  storage_kind: "存储方式",
  storage_key: "存储路径",
  public_url: "图片地址",
  source_url: "来源地址",
  mime_type: "文件类型",
  width: "宽度",
  height: "高度",
  bytes: "文件大小",
  sha256: "文件指纹",
  slot_index: "图片序号",
  size: "尺寸",
  quality: "质量",
  n: "张数",
  background: "背景",
  output_format: "输出格式",
  moderation: "安全策略",
  created_at: "创建时间",
  updated_at: "更新时间",
  deleted_at: "删除时间",
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  role: { user: "用户", ai: "助手", admin: "管理员", paid: "付费用户" },
  status: { done: "已完成", pending: "生成中", failed: "失败", available: "可用", missing: "缺失", quarantined: "隔离" },
  storage_kind: { local: "本机存储", cos: "对象存储", remote_legacy: "旧远程地址", data_legacy: "旧内嵌数据", missing: "缺失" },
  reason: { generate: "生成图片", edit: "编辑图片", refund: "退回积分", recharge: "充值", admin_grant: "管理员赠送", signup_bonus: "注册赠送", adjust: "人工调整" },
  ref_type: { message: "消息", conversation: "会话", order: "订单", admin: "管理员操作" },
  purpose: { verify_email: "邮箱验证" },
  size: { auto: "自动" },
  quality: { auto: "自动", low: "普通", medium: "标准", high: "高清" },
  background: { auto: "自动", opaque: "不透明" },
  output_format: { png: "PNG", jpeg: "JPEG", webp: "WEBP" },
  moderation: { auto: "自动", low: "较低" },
};

function fieldLabel(column: string): string {
  return FIELD_LABELS[column] || column;
}

function isIsoDateColumn(column: string, value: unknown): value is string {
  return column.endsWith("_at") && typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function formatTableCell(column: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && VALUE_LABELS[column]?.[value]) return VALUE_LABELS[column][value];
  if (isIsoDateColumn(column, value)) return new Date(value).toLocaleString();
  if (typeof value === "boolean") return value ? "是" : "否";
  if (column === "bytes" && typeof value === "number") return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (Array.isArray(value)) return value.length ? `共 ${value.length} 项` : "无";
  if (typeof value === "object") return "已记录";
  return String(value);
}

function compactCellText(column: string, value: unknown): string {
  const text = formatTableCell(column, value);
  return text.length > 96 ? `${text.slice(0, 96)}…` : text;
}

function userInitial(row: AdminDataTableRow): string {
  const user = row._user;
  const base = user?.nickname || user?.email || `#${String(row.user_id ?? "?")}`;
  return base.trim().slice(0, 1).toUpperCase() || "?";
}

function primaryLine(table: AdminDataTableKey, row: AdminDataTableRow): string {
  if (table === "conversations") return compactCellText("title", row.title) || "未命名会话";
  if (table === "messages") return compactCellText("text", row.text) || "空消息";
  if (table === "credit_transactions") return `积分变动 ${formatTableCell("delta", row.delta)} · ${formatTableCell("reason", row.reason)}`;
  if (table === "email_verification_tokens") return `${formatTableCell("purpose", row.purpose)} · ${row.used_at ? "已使用" : "未使用"}`;
  if (table === "generated_assets") return `${formatTableCell("status", row.status)} · ${formatTableCell("storage_kind", row.storage_kind)}`;
  return `#${String(row.id ?? "")}`;
}

function secondaryLine(table: AdminDataTableKey, row: AdminDataTableRow): string {
  if (table === "conversations") return `更新 ${formatTableCell("updated_at", row.updated_at)}`;
  if (table === "messages") return `${formatTableCell("role", row.role)} · ${formatTableCell("status", row.status)} · ${formatTableCell("created_at", row.created_at)}`;
  if (table === "credit_transactions") return `余额 ${formatTableCell("balance_after", row.balance_after)} · ${formatTableCell("created_at", row.created_at)}`;
  if (table === "email_verification_tokens") return `过期 ${formatTableCell("expires_at", row.expires_at)}`;
  if (table === "generated_assets") return `${formatTableCell("width", row.width)}×${formatTableCell("height", row.height)} · ${formatTableCell("bytes", row.bytes)}`;
  return formatTableCell("created_at", row.created_at);
}

function rowImagePreview(table: AdminDataTableKey, row: AdminDataTableRow): string | null {
  if (table === "generated_assets" && typeof row.public_url === "string") return row.public_url;
  if (table === "messages" && Array.isArray(row.image_urls) && typeof row.image_urls[0] === "string") return row.image_urls[0];
  return null;
}

function visualFields(table: AdminDataTableKey): string[] {
  if (table === "conversations") return ["id", "user_id", "pinned", "deleted_at"];
  if (table === "messages") return ["id", "conversation_id", "role", "status"];
  if (table === "credit_transactions") return ["id", "reason", "ref_type", "ref_id"];
  if (table === "email_verification_tokens") return ["id", "purpose", "expires_at", "used_at"];
  return ["id", "message_id", "slot_index", "storage_kind", "status"];
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function rowUserId(row: AdminDataTableRow): number | null {
  return row._user?.id ?? numberFrom(row.user_id);
}

function rowConversationId(table: AdminDataTableKey, row: AdminDataTableRow): number | null {
  return numberFrom(row._conversation_id) ?? (table === "conversations" ? numberFrom(row.id) : null);
}

function UserDataCard({
  table,
  row,
  onDetail,
}: {
  table: AdminDataTableKey;
  row: AdminDataTableRow;
  onDetail: (row: AdminDataTableRow) => void;
}) {
  const user = row._user;
  const preview = rowImagePreview(table, row);
  const isCredit = table === "credit_transactions";
  const delta = typeof row.delta === "number" ? row.delta : 0;

  return (
    <article className="overflow-hidden rounded-[14px] bg-white/[0.04] p-3 ring-1 ring-white/[0.04]">
      <div className="flex gap-3">
        {preview ? (
          <img src={preview} alt="" className="h-16 w-16 shrink-0 rounded-[10px] object-cover bg-black/30" loading="lazy" />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-[10px] bg-white/[0.06] text-[22px] font-semibold text-white/65">
            {userInitial(row)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-white/90">
              {user?.nickname || user?.email || "用户缺失"}
            </span>
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/40">
              用户 #{String(user?.id ?? row.user_id ?? "?")}
            </span>
            {user?.role && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200/80">
                {formatTableCell("role", user.role)}
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-[12px] text-white/65">{primaryLine(table, row)}</div>
          <div className="mt-0.5 truncate text-[11px] text-white/35">{secondaryLine(table, row)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {visualFields(table).map((field) => (
          <span key={field} className="rounded bg-black/20 px-2 py-1 text-[10px] text-white/40">
            {fieldLabel(field)}：{compactCellText(field, row[field])}
          </span>
        ))}
        {isCredit && (
          <span className={cls(
            "rounded px-2 py-1 text-[10px]",
            delta >= 0 ? "bg-emerald-500/15 text-emerald-200/80" : "bg-red-500/15 text-red-200/80",
          )}>
            {delta >= 0 ? "增加" : "消耗"} {Math.abs(delta)}
          </span>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          onClick={() => onDetail(row)}
          className="rounded bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/65 hover:bg-white/[0.1]"
        >
          查看详情
        </button>
      </div>
    </article>
  );
}

function ConversationHistoryList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: AdminConversationListItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  if (conversations.length === 0) {
    return <div className="rounded-[12px] bg-white/[0.035] p-4 text-[12px] text-white/35">这个用户还没有可查看的对话历史</div>;
  }

  return (
    <div className="space-y-2">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={cls(
            "w-full rounded-[12px] p-3 text-left ring-1 transition",
            selectedId === conv.id
              ? "bg-white/[0.1] text-white ring-white/15"
              : "bg-white/[0.035] text-white/55 ring-white/[0.04] hover:bg-white/[0.06]",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[12px] font-medium">{conv.title || "未命名会话"}</span>
            <span className="shrink-0 rounded bg-black/20 px-1.5 py-0.5 text-[10px] text-white/35">
              {conv.message_count} 条
            </span>
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/35">
            {conv.preview || "暂无文字预览"}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-white/30">
            {conv.pinned && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200/80">置顶</span>}
            {conv.deleted_at && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-200/80">已删除</span>}
            {conv.has_pending && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-200/80">生成中</span>}
            <span>{new Date(conv.updated_at).toLocaleString()}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function paramSummary(params: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!params) return [];
  return ["size", "quality", "n", "background", "output_format", "moderation"]
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => ({ label: fieldLabel(key), value: formatTableCell(key, params[key]) }));
}

function ConversationTimeline({
  detail,
  loading,
  error,
}: {
  detail: AdminConversationDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <div className="rounded-[14px] bg-white/[0.035] p-8 text-center text-[13px] text-white/35">正在加载对话内容…</div>;
  if (error) return <div className="rounded-[14px] bg-red-500/10 p-4 text-[13px] text-red-200">{error}</div>;
  if (!detail) return <div className="rounded-[14px] bg-white/[0.035] p-8 text-center text-[13px] text-white/35">请选择一条对话查看</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-[14px] bg-white/[0.04] p-4 ring-1 ring-white/[0.04]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 text-[16px] font-medium text-white/90">{detail.title || "未命名会话"}</div>
          {detail.deleted_at && <span className="rounded bg-red-500/15 px-2 py-1 text-[11px] text-red-200/80">已删除</span>}
          {detail.pinned && <span className="rounded bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200/80">置顶</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/35">
          <span>对话编号 {detail.id}</span>
          <span>共 {detail.message_count} 条消息</span>
          <span>创建 {new Date(detail.created_at).toLocaleString()}</span>
          <span>更新 {new Date(detail.updated_at).toLocaleString()}</span>
        </div>
      </div>

      <div className="space-y-3">
        {detail.messages.map((message) => {
          const isUser = message.role === "user";
          const params = paramSummary(message.params);
          return (
            <article key={message.id} className={cls(
              "rounded-[14px] p-4 ring-1",
              isUser ? "bg-white/[0.045] ring-white/[0.05]" : "bg-black/20 ring-white/[0.04]",
            )}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className={cls(
                  "rounded px-2 py-1",
                  isUser ? "bg-white/[0.08] text-white/75" : "bg-emerald-500/15 text-emerald-200/80",
                )}>
                  {isUser ? "用户" : "助手"}
                </span>
                <span className="text-white/30">消息编号 {message.id}</span>
                <span className="text-white/30">{formatTableCell("created_at", message.created_at)}</span>
                <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-white/35">{formatTableCell("status", message.status)}</span>
              </div>
              <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-white/75">
                {message.text || "（无文字内容）"}
              </div>
              {message.image_urls && message.image_urls.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {message.image_urls.map((url, index) => (
                    <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-[12px] bg-black/30 ring-1 ring-white/[0.05]">
                      <img src={url} alt={`对话图片 ${index + 1}`} className="aspect-square w-full object-cover transition group-hover:scale-[1.02]" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
              {params.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {params.map((item) => (
                    <span key={item.label} className="rounded bg-white/[0.05] px-2 py-1 text-[10px] text-white/38">
                      {item.label}：{item.value}
                    </span>
                  ))}
                </div>
              )}
            </article>
          );
        })}
        {detail.messages.length === 0 && (
          <div className="rounded-[14px] bg-white/[0.035] p-8 text-center text-[13px] text-white/35">这条对话还没有消息</div>
        )}
      </div>
    </div>
  );
}

function UserConversationReader({
  table,
  label,
  row,
  onClose,
}: {
  table: AdminDataTableKey;
  label: string;
  row: AdminDataTableRow;
  onClose: () => void;
}) {
  const user = row._user;
  const userId = rowUserId(row);
  const initialConversationId = rowConversationId(table, row);
  const [conversations, setConversations] = useState<AdminConversationListItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(initialConversationId);
  const [detail, setDetail] = useState<AdminConversationDetail | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setListLoading(true);
    setError(null);
    api.getAdminUserConversations(userId)
      .then((items) => {
        if (!alive) return;
        setConversations(items);
        const preferred = initialConversationId && items.some((item) => item.id === initialConversationId)
          ? initialConversationId
          : items[0]?.id ?? initialConversationId ?? null;
        setSelectedConversationId(preferred);
      })
      .catch((e) => {
        if (alive) setError(e.message || "加载对话历史失败");
      })
      .finally(() => {
        if (alive) setListLoading(false);
      });
    return () => { alive = false; };
  }, [userId, initialConversationId]);

  useEffect(() => {
    if (!selectedConversationId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    setError(null);
    api.getAdminConversation(selectedConversationId)
      .then((item) => {
        if (alive) setDetail(item);
      })
      .catch((e) => {
        if (alive) setError(e.message || "加载对话详情失败");
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => { alive = false; };
  }, [selectedConversationId]);

  return (
    <div className="fixed inset-x-0 bottom-0 top-[76px] z-50 overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div
        className="mx-auto grid min-h-[76vh] w-full max-w-[1180px] gap-0 overflow-hidden rounded-[18px] bg-[#19191d] ring-1 ring-white/[0.08] lg:grid-cols-[310px_minmax(0,1fr)]"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="border-b border-white/[0.06] bg-white/[0.025] p-4 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] text-white/35">用户数据详情</div>
              <div className="mt-1 truncate text-[15px] font-medium text-white/90">{user?.nickname || user?.email || "用户缺失"}</div>
              <div className="mt-1 text-[11px] text-white/35">用户编号 {String(userId ?? "—")}</div>
            </div>
            <button onClick={onClose} className="shrink-0 rounded bg-white/[0.06] px-3 py-1 text-[12px] text-white/60 hover:bg-white/[0.1]">关闭</button>
          </div>

          <div className="mb-4 rounded-[14px] bg-white/[0.04] p-3 ring-1 ring-white/[0.04]">
            <div className="text-[11px] text-white/35">当前记录</div>
            <div className="mt-1 text-[13px] font-medium text-white/80">{label}</div>
            <div className="mt-1 line-clamp-3 text-[12px] leading-5 text-white/50">{primaryLine(table, row)}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {visualFields(table).map((field) => (
                <span key={field} className="rounded bg-black/20 px-2 py-1 text-[10px] text-white/38">
                  {fieldLabel(field)}：{compactCellText(field, row[field])}
                </span>
              ))}
              {initialConversationId && (
                <span className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200/80">
                  关联对话 {initialConversationId}
                </span>
              )}
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-medium text-white/70">对话历史</div>
            {listLoading && <span className="text-[11px] text-white/30">加载中…</span>}
          </div>
          {userId ? (
            <ConversationHistoryList
              conversations={conversations}
              selectedId={selectedConversationId}
              onSelect={setSelectedConversationId}
            />
          ) : (
            <div className="rounded-[12px] bg-white/[0.035] p-4 text-[12px] text-white/35">这条记录没有关联用户，无法读取对话历史</div>
          )}
        </aside>

        <main className="min-w-0 p-4">
          <ConversationTimeline detail={detail} loading={detailLoading || listLoading} error={error} />
        </main>
      </div>
    </div>
  );
}

function UserDataPanel() {
  const [tables, setTables] = useState<AdminDataTableMeta[]>(DATA_TABLE_FALLBACKS);
  const [table, setTable] = useState<AdminDataTableKey>("conversations");
  const [data, setData] = useState<AdminDataTablePage | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [detail, setDetail] = useState<AdminDataTableRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdminDataTables()
      .then(setTables)
      .catch(() => setTables(DATA_TABLE_FALLBACKS));
  }, []);

  useEffect(() => {
    setError(null);
    api.getAdminDataTable(table, {
      page,
      page_size: 20,
      search: appliedSearch || undefined,
    })
      .then(setData)
      .catch((e) => setError(e.message || "加载用户数据失败"));
  }, [table, page, appliedSearch]);

  const activeMeta = tables.find((t) => t.key === table) || DATA_TABLE_FALLBACKS[0];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  const applySearch = () => {
    setPage(1);
    setAppliedSearch(search.trim());
  };

  return (
    <div className="grid min-h-[520px] gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="space-y-2 rounded-[14px] bg-white/[0.03] p-2">
        {tables.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTable(t.key);
              setPage(1);
              setSearch("");
              setAppliedSearch("");
            }}
            className={cls(
              "flex w-full items-center justify-between rounded-[9px] px-3 py-2 text-left text-[12px]",
              table === t.key ? "bg-white/10 text-white" : "text-white/45 hover:bg-white/[0.04]",
            )}
          >
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[15px] font-medium text-white/90">{activeMeta.label}</div>
            <div className="text-[11px] text-white/35">共 {data?.total ?? "—"} 条用户关联记录</div>
          </div>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
              placeholder="搜索 ID、状态、文本、路径…"
              className="w-full rounded-[9px] bg-white/[0.06] px-3 py-2 text-[12px] text-white/90 outline-none placeholder:text-white/30 sm:w-[260px]"
            />
            <button onClick={applySearch} className="rounded-[9px] bg-white/[0.08] px-3 py-2 text-[12px] hover:bg-white/[0.12]">搜索</button>
          </div>
        </div>

        {error && <div className="text-red-400 text-[13px]">{error}</div>}

        <div className="grid gap-3 xl:grid-cols-2">
          {data?.items.map((row, index) => (
            <UserDataCard
              key={`${row.id ?? index}`}
              table={table}
              row={row}
              onDetail={setDetail}
            />
          ))}
          {data && data.items.length === 0 && (
            <div className="rounded-[14px] bg-white/[0.03] px-3 py-10 text-center text-[13px] text-white/30 xl:col-span-2">
              暂无用户数据
            </div>
          )}
        </div>

        {data && data.total > data.page_size && (
          <div className="flex items-center justify-center gap-3 text-[12px]">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded bg-white/[0.06] px-3 py-1 disabled:opacity-30">上一页</button>
            <span className="text-white/40">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded bg-white/[0.06] px-3 py-1 disabled:opacity-30">下一页</button>
          </div>
        )}
      </div>

      {detail && (
        <UserConversationReader
          table={table}
          label={activeMeta.label}
          row={detail}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

// ===== 服务渠道 =====
function UpstreamsTab() {
  const [list, setList] = useState<UpstreamChannel[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<{ name: string; base_url: string; api_key: string; priority: number; supports_edit: boolean; timeout_seconds: number }>({ name: "", base_url: "", api_key: "", priority: 0, supports_edit: true, timeout_seconds: 300 });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getUpstreams().then(setList).catch((e) => setError(e.message || "加载服务渠道失败"));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    try {
      await api.createUpstream(form);
      setShowAdd(false);
      setForm({ name: "", base_url: "", api_key: "", priority: 0, supports_edit: true, timeout_seconds: 300 });
      load();
    } catch (e: any) {
      setError(e.message || "添加渠道失败");
    }
  };

  const handleToggle = async (ch: UpstreamChannel) => {
    try {
      await api.updateUpstream(ch.id, { enabled: !ch.enabled });
      load();
    } catch (e: any) {
      setError(e.message || "更新渠道状态失败");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确认删除该服务渠道？")) return;
    try {
      await api.deleteUpstream(id);
      load();
    } catch (e: any) {
      setError(e.message || "删除渠道失败");
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-red-400 text-[13px]">{error}</div>}
      <button onClick={() => setShowAdd(true)} className="rounded-[8px] bg-amber-500/20 px-3 py-1.5 text-[12px] text-amber-300 hover:bg-amber-500/30">+ 添加服务渠道</button>
      <div className="space-y-2">
        {list.map((ch) => (
          <div key={ch.id} className="flex items-center gap-3 rounded-[12px] bg-white/[0.04] p-3">
            <div className={cls("h-2 w-2 rounded-full", ch.enabled ? "bg-emerald-400" : "bg-white/20")} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium">{ch.name} <span className="text-white/30 text-[11px]">优先级 {ch.priority}</span></div>
              <div className="text-[11px] font-mono text-white/40 truncate">{ch.base_url}</div>
              <div className="text-[11px] text-white/30">凭证: {ch.api_key_masked} · 超时 {ch.timeout_seconds}s · 并发 {ch.max_concurrent}</div>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => handleToggle(ch)} className={cls("rounded px-2 py-1 text-[11px]", ch.enabled ? "bg-red-500/20 hover:bg-red-500/30" : "bg-emerald-500/20 hover:bg-emerald-500/30")}>
                {ch.enabled ? "禁用" : "启用"}
              </button>
              <button onClick={() => handleDelete(ch.id)} className="rounded bg-red-500/20 px-2 py-1 text-[11px] hover:bg-red-500/30">删除</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="text-center text-[13px] text-white/30 py-8">暂无服务渠道</div>}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={() => setShowAdd(false)}>
          <div className="w-[400px] space-y-3 rounded-[16px] bg-[#1e1e22] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-medium">添加服务渠道</div>
            {(["name", "base_url", "api_key"] as const).map((k) => (
              <input key={k} value={(form as Record<string, unknown>)[k] as string} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                placeholder={k === "name" ? "渠道名称" : k === "base_url" ? "服务地址" : "连接凭证"}
                className="w-full rounded-[8px] bg-white/[0.06] px-3 py-2 text-[13px] text-white/90 outline-none placeholder:text-white/30" />
            ))}
            <div className="flex gap-3">
              <label className="flex-1 text-[12px] text-white/40">优先级
                <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className="mt-1 w-full rounded-[8px] bg-white/[0.06] px-3 py-2 text-[13px] text-white/90 outline-none" />
              </label>
              <label className="flex-1 text-[12px] text-white/40">超时(秒)
                <input type="number" value={form.timeout_seconds} onChange={(e) => setForm({ ...form, timeout_seconds: Number(e.target.value) })} className="mt-1 w-full rounded-[8px] bg-white/[0.06] px-3 py-2 text-[13px] text-white/90 outline-none" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-white/40">
              <input type="checkbox" checked={form.supports_edit} onChange={(e) => setForm({ ...form, supports_edit: e.target.checked })} />
              支持编辑（inpainting）
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="rounded-[8px] bg-white/[0.06] px-4 py-2 text-[13px]">取消</button>
              <button onClick={handleAdd} disabled={!form.name || !form.base_url || !form.api_key} className="rounded-[8px] bg-amber-500/80 px-4 py-2 text-[13px] text-black disabled:opacity-40">添加</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 实时监控 =====
function MonitorTab() {
  const [list, setList] = useState<UpstreamHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getUpstreamStatus().then(setList).catch((e) => setError(e.message || "加载监控数据失败"));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCheck = async (id: number) => {
    setLoading(true);
    try {
      await api.healthCheckUpstream(id);
    } catch (e: any) {
      setError(e.message || "健康检查失败");
    }
    load();
    setLoading(false);
  };

  const handleCheckAll = async () => {
    setLoading(true);
    await Promise.all(list.map((ch) => api.healthCheckUpstream(ch.id).catch(() => {})));
    load();
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-red-400 text-[13px]">{error}</div>}
      <button onClick={handleCheckAll} disabled={loading} className="rounded-[8px] bg-amber-500/20 px-3 py-1.5 text-[12px] text-amber-300 hover:bg-amber-500/30 disabled:opacity-40">
        {loading ? "检测中…" : "全部检测"}
      </button>
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((ch) => (
          <div key={ch.id} className="rounded-[14px] bg-white/[0.04] p-4">
            <div className="flex items-center gap-2">
              <div className={cls(
                "h-3 w-3 rounded-full",
                ch.last_health_ok === true && "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]",
                ch.last_health_ok === false && "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]",
                ch.last_health_ok === null && "bg-white/20",
              )} />
              <span className="text-[14px] font-medium">{ch.name}</span>
              {!ch.enabled && <span className="text-[10px] text-white/30">(已禁用)</span>}
            </div>
            <div className="mt-2 space-y-1 text-[12px] text-white/50">
              <div>探活延迟: {ch.last_latency_ms !== null ? `${ch.last_latency_ms}ms` : "—"}</div>
              <div>近 24h: {ch.recent_requests} 次 · 失败 {ch.recent_failures} · 失败率 {ch.recent_failure_rate}%</div>
              <div>真实延迟: 平均 {ch.avg_latency_ms !== null ? `${ch.avg_latency_ms}ms` : "—"} · P95 {ch.recent_p95_latency_ms !== null ? `${ch.recent_p95_latency_ms}ms` : "—"}</div>
              <div>累计: {ch.total_requests} 次 · 失败 {ch.total_failures} · 失败率 {ch.failure_rate}%</div>
              <div>上次探活: {ch.last_health_check ? new Date(ch.last_health_check).toLocaleString() : "从未"}</div>
            </div>
            <button onClick={() => handleCheck(ch.id)} disabled={loading} className="mt-2 rounded bg-white/[0.06] px-3 py-1 text-[11px] hover:bg-white/10 disabled:opacity-40">检测</button>
          </div>
        ))}
        {list.length === 0 && <div className="col-span-2 text-center text-[13px] text-white/30 py-8">暂无服务渠道</div>}
      </div>
      {/* DAU 图表 */}
      <DAUChart />
    </div>
  );
}

function DAUChart() {
  const [data, setData] = useState<DAUItem[]>([]);
  useEffect(() => { api.getDAU(14).then(setData).catch(() => {}); }, []);
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="rounded-[14px] bg-white/[0.04] p-4">
      <div className="mb-3 text-[13px] font-medium text-white/60">日活用户（近 14 天）</div>
      <div className="flex items-end gap-1" style={{ height: 100 }}>
        {data.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <div className="text-[9px] text-white/30">{d.count}</div>
            <div className="w-full rounded-t bg-amber-500/40" style={{ height: `${(d.count / max) * 70}px` }} />
            <div className="text-[8px] text-white/20">{d.date.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== 主页面 =====
export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");

  if (!user || user.role !== "admin") {
    return (
      <div className="grid h-full place-items-center text-[14px] text-white/45">
        无权限访问管理后台
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-1">
        <h1 className="text-[18px] font-medium leading-tight text-white/95 sm:text-[22px]">管理后台</h1>
        <span className="text-[12px] text-white/45">系统管理与监控</span>
      </div>
      <div className="flex shrink-0 gap-1 overflow-x-auto [scrollbar-width:none]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cls(
              "whitespace-nowrap rounded-[8px] px-3 py-1.5 text-[12px] transition-colors",
              tab === t.key ? "bg-white/10 text-white" : "text-white/40 hover:bg-white/[0.04]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[28px] bg-white/[0.02] p-3 sm:p-4 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin]">
        {tab === "dashboard" && <DashboardTab />}
        {tab === "users" && <UsersTab />}
        {tab === "logs" && <LogsTab />}
        {tab === "images" && <ImagesTab />}
        {tab === "data" && <UserDataPanel />}
        {tab === "upstreams" && <UpstreamsTab />}
        {tab === "monitor" && <MonitorTab />}
      </div>
    </div>
  );
}
