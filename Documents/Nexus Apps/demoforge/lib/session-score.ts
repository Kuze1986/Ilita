import { logSystemEvent } from "@/lib/logging";
import { computeEngagementScore } from "@/lib/scoring";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { DemoModuleRow } from "@/types/demo";
import type { SessionEventRow } from "@/types/events";

export async function applyScoreForSession(sessionId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const { data: session, error: sErr } = await supabase
    .from("demo_sessions")
    .select(
      "id, modules_completed, modules_total, track_id"
    )
    .eq("id", sessionId)
    .single();
  if (sErr || !session) {
    throw new Error(sErr?.message ?? "Session not found");
  }

  const trackId = session.track_id as string;
  const { data: modules, error: mErr } = await supabase
    .from("demo_modules")
    .select("*")
    .eq("track_id", trackId)
    .order("sequence_order", { ascending: true });
  if (mErr) {
    throw new Error(mErr.message);
  }

  const { data: events, error: eErr } = await supabase
    .from("session_events")
    .select("*")
    .eq("session_id", sessionId)
    .order("occurred_at", { ascending: true });
  if (eErr) {
    throw new Error(eErr.message);
  }

  const breakdown = computeEngagementScore({
    modulesCompleted: session.modules_completed ?? 0,
    modulesTotal: session.modules_total ?? (modules?.length ?? 1),
    events: (events ?? []) as SessionEventRow[],
    modules: (modules ?? []) as DemoModuleRow[],
  });

  const { error: uErr } = await supabase
    .from("demo_sessions")
    .update({
      engagement_score: breakdown.total,
      score_breakdown: breakdown as unknown as Record<string, unknown>,
    })
    .eq("id", sessionId);
  if (uErr) {
    throw new Error(uErr.message);
  }

  await logSystemEvent({
    function_name: "score_session",
    session_id: sessionId,
    status: "success",
    message: `Score ${breakdown.total}`,
    payload: breakdown as unknown as Record<string, unknown>,
  });
}
