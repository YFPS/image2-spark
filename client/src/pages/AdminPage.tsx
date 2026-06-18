import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import * as api from "../api/admin";
import type {
  DashboardStats, AdminUser, AdminAccessLog, AdminOpLog,
  DAUItem, TrafficStats, UpstreamChannel, UpstreamHealth,
} from "../api/admin";

type Tab = "dashboard" | "users" | "logs" | "images" | "upstreams" | "monitor";

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "概览" },
  { key: "users", label: "用户" },
  { key: "logs", label: "日志" },
  { key: "images", label: "图片" },
  { key: "upstreams", label: "上游" },
  { key: "monitor", label: "监控" },
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
          <div className="mb-2 text-[13px] font-medium text-white/60">热门接口</div>
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
  const [data, setData] = useState<api.Paged<{ id: number; conversation_id: number; user_id: number | null; image_urls: string[] | null; status: string; created_at: string }> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getImages({ page }).then(setData).catch((e) => setError(e.message || "加载图片列表失败"));
  }, [page]);

  const handleDelete = async (id: number) => {
    if (!confirm("确认清除该消息的图片？")) return;
    try {
      await api.deleteImage(id);
      setData((prev) => prev ? { ...prev, items: prev.items.map((i) => i.id === id ? { ...i, image_urls: null } : i) } : prev);
    } catch (e: any) {
      setError(e.message || "删除图片失败");
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-red-400 text-[13px]">{error}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {data?.items.map((img) => (
          <div key={img.id} className="group relative overflow-hidden rounded-[12px] bg-white/[0.04]">
            {img.image_urls && img.image_urls.length > 0 ? (
              <img src={img.image_urls[0]} alt="" className="aspect-square w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex aspect-square items-center justify-center text-[12px] text-white/20">已清除</div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="text-[11px] text-white/70">#{img.id} · 用户{img.user_id ?? "?"}</div>
              <div className="text-[10px] text-white/40">{new Date(img.created_at).toLocaleString()}</div>
              {img.image_urls && (
                <button onClick={() => handleDelete(img.id)} className="mt-1 rounded bg-red-500/30 px-2 py-0.5 text-[10px] hover:bg-red-500/50">清除图片</button>
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

// ===== 上游渠道 =====
function UpstreamsTab() {
  const [list, setList] = useState<UpstreamChannel[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<{ name: string; base_url: string; api_key: string; priority: number; supports_edit: boolean; timeout_seconds: number }>({ name: "", base_url: "", api_key: "", priority: 0, supports_edit: true, timeout_seconds: 300 });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getUpstreams().then(setList).catch((e) => setError(e.message || "加载上游渠道失败"));
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
    if (!confirm("确认删除该上游渠道？")) return;
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
      <button onClick={() => setShowAdd(true)} className="rounded-[8px] bg-amber-500/20 px-3 py-1.5 text-[12px] text-amber-300 hover:bg-amber-500/30">+ 添加渠道</button>
      <div className="space-y-2">
        {list.map((ch) => (
          <div key={ch.id} className="flex items-center gap-3 rounded-[12px] bg-white/[0.04] p-3">
            <div className={cls("h-2 w-2 rounded-full", ch.enabled ? "bg-emerald-400" : "bg-white/20")} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium">{ch.name} <span className="text-white/30 text-[11px]">优先级 {ch.priority}</span></div>
              <div className="text-[11px] font-mono text-white/40 truncate">{ch.base_url}</div>
              <div className="text-[11px] text-white/30">Key: {ch.api_key_masked} · 超时 {ch.timeout_seconds}s · 并发 {ch.max_concurrent}</div>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => handleToggle(ch)} className={cls("rounded px-2 py-1 text-[11px]", ch.enabled ? "bg-red-500/20 hover:bg-red-500/30" : "bg-emerald-500/20 hover:bg-emerald-500/30")}>
                {ch.enabled ? "禁用" : "启用"}
              </button>
              <button onClick={() => handleDelete(ch.id)} className="rounded bg-red-500/20 px-2 py-1 text-[11px] hover:bg-red-500/30">删除</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="text-center text-[13px] text-white/30 py-8">暂无上游渠道</div>}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={() => setShowAdd(false)}>
          <div className="w-[400px] space-y-3 rounded-[16px] bg-[#1e1e22] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-medium">添加上游渠道</div>
            {(["name", "base_url", "api_key"] as const).map((k) => (
              <input key={k} value={(form as Record<string, unknown>)[k] as string} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                placeholder={k === "name" ? "渠道名称" : k === "base_url" ? "Base URL" : "API Key"}
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
        {list.length === 0 && <div className="col-span-2 text-center text-[13px] text-white/30 py-8">暂无上游渠道</div>}
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
        {tab === "upstreams" && <UpstreamsTab />}
        {tab === "monitor" && <MonitorTab />}
      </div>
    </div>
  );
}
