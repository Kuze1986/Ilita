import { SCORING_WEIGHTS } from "@/lib/constants";
import type { DemoModuleRow } from "@/types/demo";
import type { SessionEventRow } from "@/types/events";

export interface ScoreBreakdown {
  completionRate: number;
  attentionScore: number;
  intentSignals: number;
  liveEngagement: number;
  total: number;
}

function clamp(n: number, max: number): number {
  return Math.min(max, Math.max(0, n));
}

/**
 * Aggregates time-on-module hints from session_events metadata.
 */
function secondsOnModule(
  events: SessionEventRow[],
  moduleId: string | null | undefined
): number {
  if (!moduleId) return 0;
  let sec = 0;
  for (const e of events) {
    if (e.module_id !== moduleId) continue;
    const m = e.metadata;
    if (!m) continue;
    const t = m.time_on_module_seconds;
    if (typeof t === "number" && !Number.isNaN(t)) {
      sec += t;
    }
  }
  return sec;
}

export function computeEngagementScore(input: {
  modulesCompleted: number;
  modulesTotal: number;
  events: SessionEventRow[];
  modules: DemoModuleRow[];
}): ScoreBreakdown {
  const total = Math.max(1, input.modulesTotal);
  const completionPts =
    (input.modulesCompleted / total) * SCORING_WEIGHTS.completionMax;

  let attentionSum = 0;
  let attentionCount = 0;
  for (const mod of input.modules) {
    const expected = mod.duration_seconds ?? 60;
    const spent = secondsOnModule(input.events, mod.id);
    if (expected <= 0) continue;
    attentionCount += 1;
    attentionSum += Math.min(1, spent / expected);
  }
  const attentionPts =
    attentionCount > 0
      ? (attentionSum / attentionCount) * SCORING_WEIGHTS.attentionMax
      : 0;

  let intentCount = 0;
  for (const e of input.events) {
    if (e.event_type === "cta_click" || e.event_type === "module_replay") {
      intentCount += 1;
    }
  }
  const intentPts = clamp(intentCount * 5, SCORING_WEIGHTS.intentMax);

  let livePts = 0;
  const liveStarted = input.events.some(
    (e) => e.event_type === "kuze_live_start"
  );
  if (liveStarted) {
    livePts += 8;
  }
  const msgs = input.events.filter(
    (e) => e.event_type === "kuze_message_sent"
  ).length;
  livePts += clamp(msgs * 4, SCORING_WEIGHTS.liveMax - 8);
  livePts = clamp(livePts, SCORING_WEIGHTS.liveMax);

  const breakdown: ScoreBreakdown = {
    completionRate: clamp(completionPts, SCORING_WEIGHTS.completionMax),
    attentionScore: clamp(attentionPts, SCORING_WEIGHTS.attentionMax),
    intentSignals: intentPts,
    liveEngagement: livePts,
    total: 0,
  };
  breakdown.total = clamp(
    breakdown.completionRate +
      breakdown.attentionScore +
      breakdown.intentSignals +
      breakdown.liveEngagement,
    100
  );
  return breakdown;
}
