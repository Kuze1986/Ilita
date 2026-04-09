import { SessionFeed } from "@/components/admin/SessionFeed";
import { Card } from "@/components/ui/Card";
import { SCORING_RULES_DESCRIPTION } from "@/lib/constants";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { SessionFeedItem } from "@/types/admin";

export default async function AdminDashboardPage() {
  const supabase = createServiceSupabaseClient();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const startIso = start.toISOString();

  const { count: sessionsToday } = await supabase
    .from("demo_sessions")
    .select("*", { count: "exact", head: true })
    .gte("started_at", startIso);

  const { count: completedToday } = await supabase
    .from("demo_sessions")
    .select("*", { count: "exact", head: true })
    .gte("started_at", startIso)
    .eq("status", "completed");

  const { data: scoredRows } = await supabase
    .from("demo_sessions")
    .select("engagement_score")
    .gte("started_at", startIso)
    .not("engagement_score", "is", null);

  const scores = (scoredRows ?? [])
    .map((r) => Number(r.engagement_score))
    .filter((n) => !Number.isNaN(n));
  const avgEngagement =
    scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;

  const { count: followUpsToday } = await supabase
    .from("demo_sessions")
    .select("*", { count: "exact", head: true })
    .eq("follow_up_sent", true)
    .gte("follow_up_sent_at", startIso);

  const started = sessionsToday ?? 0;
  const completed = completedToday ?? 0;
  const completionRate =
    started > 0 ? Math.round((completed / started) * 100) : 0;

  const { data: rawSessions, error } = await supabase
    .from("demo_sessions")
    .select(
      `
      id,
      status,
      engagement_score,
      started_at,
      completed_at,
      track_id,
      prospect_id,
      prospects ( first_name, last_name, email, organization ),
      demo_tracks ( name, product )
    `
    )
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(error.message);
  }

  type ProspectEmbed = {
    first_name: string | null;
    last_name: string | null;
    email: string;
    organization: string | null;
  };
  type TrackEmbed = { name: string; product: string };

  const feed: SessionFeedItem[] = (rawSessions ?? []).map((row) => {
    const pr = row.prospects as ProspectEmbed | ProspectEmbed[] | null;
    const tr = row.demo_tracks as TrackEmbed | TrackEmbed[] | null;
    const prospectRaw = Array.isArray(pr) ? pr[0] : pr;
    const trackRaw = Array.isArray(tr) ? tr[0] : tr;
    const prospect =
      prospectRaw &&
      typeof prospectRaw === "object" &&
      "email" in prospectRaw
        ? prospectRaw
        : null;
    const track =
      trackRaw && typeof trackRaw === "object" && "name" in trackRaw
        ? trackRaw
        : null;
    return {
      id: row.id as string,
      status: row.status as SessionFeedItem["status"],
      engagement_score: row.engagement_score as number | null,
      started_at: row.started_at as string,
      prospect: prospect
        ? {
            first_name: prospect.first_name ?? null,
            last_name: prospect.last_name ?? null,
            email: prospect.email,
            organization: prospect.organization ?? null,
          }
        : null,
      track_name: track?.name ?? null,
      track_product: (track?.product as SessionFeedItem["track_product"]) ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-medium uppercase text-zinc-500">
            Sessions today
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{started}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase text-zinc-500">
            Completion rate
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {completionRate}%
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase text-zinc-500">
            Avg engagement
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {avgEngagement != null ? avgEngagement.toFixed(1) : "—"}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase text-zinc-500">
            Follow-ups sent
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {followUpsToday ?? 0}
          </p>
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">BioLoop scoring rules</h2>
        <Card className="mb-4">
          <ul className="list-inside list-disc text-sm text-zinc-600 dark:text-zinc-400">
            {SCORING_RULES_DESCRIPTION.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Card>
        <h2 className="mb-2 text-lg font-semibold">Live session feed</h2>
        <SessionFeed initial={feed} />
      </section>
    </div>
  );
}
