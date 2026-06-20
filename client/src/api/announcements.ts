export type Announcement = {
  id: number;
  title: string;
  content: string;
  link_url: string | null;
  link_label: string | null;
  pinned: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};

export async function getActiveAnnouncements(limit = 5): Promise<Announcement[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`/api/announcements?${q}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { items?: Announcement[] };
  return body.items ?? [];
}
