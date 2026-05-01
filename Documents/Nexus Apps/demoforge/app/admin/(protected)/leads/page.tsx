import { LeadCard } from "@/components/admin/LeadCard";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { LeadListItem } from "@/types/admin";
import type { DemoSessionRow, ProspectRow } from "@/types/demo";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = createServiceSupabaseClient();

  let query = supabase
    .from("prospects")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (q?.trim()) {
    query = query.ilike("email", `%${q.trim()}%`);
  }

  const { data: prospects, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const { data: sessions } = await supabase
    .from("demo_sessions")
    .select("*, demo_tracks(name)")
    .order("started_at", { ascending: false });

  type SessionRow = DemoSessionRow & {
    demo_tracks?: { name: string } | { name: string }[] | null;
  };

  const latestByProspect = new Map<
    string,
    { session: DemoSessionRow; trackName: string | null }
  >();

  for (const s of (sessions ?? []) as SessionRow[]) {
    const pid = s.prospect_id;
    if (!pid || latestByProspect.has(pid)) continue;
    const tr = s.demo_tracks;
    const trackName = Array.isArray(tr) ? tr[0]?.name ?? null : tr?.name ?? null;
    // Strip PostgREST embed — not part of DemoSessionRow
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- embed key discarded
    const { demo_tracks, ...session } = s;
    const sessionRow = session as DemoSessionRow;
    latestByProspect.set(pid, { session: sessionRow, trackName });
  }

  const items: LeadListItem[] = (prospects ?? []).map((p) => {
    const prospect = p as ProspectRow;
    const latest = latestByProspect.get(prospect.id);
    return {
      prospect,
      latestSession: latest?.session ?? null,
      trackName: latest?.trackName ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] soft-muted">Leads & Prospects</p>
        <h1 className="text-2xl font-semibold">Leads</h1>
      </div>
      <p className="text-sm soft-muted">
        Prospects from intake, with latest demo session and BioLoop score.
      </p>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <LeadCard key={item.prospect.id} item={item} />
        ))}
      </div>
    </div>
  );
}
