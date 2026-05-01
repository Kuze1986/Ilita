import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ShareDemoLinkButton } from "@/components/demo/ShareDemoLinkButton";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DemoCompletePage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ token?: string; admin_mode?: string }>;
}) {
  const { sessionId } = await params;
  const { token, admin_mode } = await searchParams;
  if (!token) {
    notFound();
  }

  const supabase = createServiceSupabaseClient();
  const { data: session, error } = await supabase
    .from("demo_sessions")
    .select("id, token, engagement_score, follow_up_sent")
    .eq("id", sessionId)
    .single();

  if (error || !session || session.token !== token) {
    notFound();
  }

  const score = session.engagement_score;
  const followUp = session.follow_up_sent;
  const isAdminMode = admin_mode === "1";
  const modeSuffix = isAdminMode ? "&admin_mode=1" : "";
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const sharePath = `/demo/${sessionId}?token=${encodeURIComponent(token)}${modeSuffix}`;
  const shareUrl = origin ? `${origin.replace(/\/$/, "")}${sharePath}` : sharePath;
  const { data: bestRender } = await supabase
    .from("video_renders")
    .select("id, final_video_path, naturalness_score, video_jobs!inner(parent_session_id)")
    .eq("video_jobs.parent_session_id", sessionId)
    .eq("status", "completed")
    .not("final_video_path", "is", null)
    .order("naturalness_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: hotspots } = bestRender?.id
    ? await supabase
        .from("video_hotspots")
        .select("id, label, target_url, start_seconds, end_seconds")
        .eq("render_id", bestRender.id as string)
        .order("start_seconds", { ascending: true })
    : { data: [] as Array<Record<string, unknown>> };

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center px-4 py-16">
      <Card className="w-full text-center">
        {isAdminMode && (
          <div className="mb-4 text-left">
            <Link href="/admin" className="text-sm text-[color:var(--accent)] hover:underline">
              ← Back to admin mode
            </Link>
          </div>
        )}
        <h1 className="text-xl font-semibold">Demo complete</h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Thanks for walking through the NEXUS track.{" "}
          {followUp
            ? "A personalized follow-up is on the way to your inbox."
            : "Our team may follow up shortly with next steps."}
        </p>
        {score != null && (
          <p className="mt-4 text-sm">
            Engagement score:{" "}
            <span className="font-semibold tabular-nums">{Number(score)}</span>{" "}
            / 100
          </p>
        )}
        {bestRender?.final_video_path && (
          <div className="mt-6 rounded-xl border border-[color:var(--panel-border)] bg-black/20 p-3 text-left">
            <p className="text-sm font-semibold">Video recap is ready</p>
            <p className="mt-1 text-xs soft-muted">
              Replay your personalized variant and jump to key sections.
            </p>
            <a
              className="mt-3 inline-flex rounded-lg bg-[color:var(--accent)] px-3 py-2 text-sm font-medium text-[#031218]"
              href={bestRender.final_video_path as string}
              target="_blank"
              rel="noreferrer"
            >
              Open video recap
            </a>
            {(hotspots ?? []).length > 0 && (
              <div className="mt-3 grid gap-2">
                {(hotspots ?? []).map((h) => (
                  <a
                    key={String(h.id)}
                    href={String(h.target_url)}
                    className="rounded-lg border border-[color:var(--panel-border)] px-3 py-2 text-xs hover:bg-[rgba(44,247,223,0.1)]"
                  >
                    <div className="font-medium">{String(h.label)}</div>
                    <div className="soft-muted">
                      {Number(h.start_seconds).toFixed(1)}s to{" "}
                      {Number(h.end_seconds).toFixed(1)}s
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/billing">
            <Button className="w-full sm:w-auto">Upgrade for full rollout</Button>
          </Link>
          <ShareDemoLinkButton url={shareUrl} />
          <Link href={`/demo/${sessionId}/live?token=${encodeURIComponent(token)}${modeSuffix}`}>
            <Button variant="secondary" className="w-full sm:w-auto">
              Continue with Kuze
            </Button>
          </Link>
          <Link href={isAdminMode ? "/demo?admin_mode=1" : "/demo"}>
            <Button variant="ghost" className="w-full sm:w-auto">
              New intake
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
