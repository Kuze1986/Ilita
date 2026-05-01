"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  initialGraphNodeId,
  moduleIdForNode,
  pickNextNodeId,
} from "@/lib/journey/resolveNext";
import type { DemoModuleRow } from "@/types/demo";
import type { JourneyEdgeRow, JourneyNodeRow } from "@/types/journey";
import { Card } from "@/components/ui/Card";
import { LiveKuzeButton } from "./LiveKuzeButton";
import { KuzeNarration } from "./KuzeNarration";
import { ModuleRenderer } from "./ModuleRenderer";
import { ProgressBar } from "./ProgressBar";

interface InitialSession {
  modules_completed: number;
  modules_total: number;
  current_module_id: string | null;
}

interface CrucibleBranchState {
  engagement_trajectory: "rising" | "falling" | "stable" | "volatile";
  friction_points: string[];
  recommended_pivot: string | null;
  confidence: number;
}

export interface DemoJourneyGraph {
  entryNodeId: string | null;
  nodes: JourneyNodeRow[];
  edges: JourneyEdgeRow[];
}

export function DemoPlayer({
  sessionId,
  token,
  trackName,
  modules,
  initialSession,
  journey,
  crucibleState,
  attribution,
  adminMode = false,
}: {
  sessionId: string;
  token: string;
  trackName: string;
  modules: DemoModuleRow[];
  initialSession: InitialSession;
  journey?: DemoJourneyGraph | null;
  crucibleState?: CrucibleBranchState | null;
  attribution?: Record<string, string> | null;
  adminMode?: boolean;
}) {
  const router = useRouter();
  const ordered = useMemo(
    () => [...modules].sort((a, b) => a.sequence_order - b.sequence_order),
    [modules]
  );

  const graphMode = Boolean(
    journey?.entryNodeId && journey.nodes?.length && journey.edges
  );

  const startIndex = useMemo(() => {
    if (!initialSession.current_module_id || ordered.length === 0) return 0;
    const i = ordered.findIndex(
      (m) => m.id === initialSession.current_module_id
    );
    return i < 0 ? 0 : i;
  }, [ordered, initialSession.current_module_id]);

  const [index, setIndex] = useState(startIndex);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(() => {
    if (!graphMode || !journey) return null;
    return initialGraphNodeId({
      entryNodeId: journey.entryNodeId,
      nodes: journey.nodes,
      currentModuleId: initialSession.current_module_id,
    });
  });
  const [completedCount, setCompletedCount] = useState(
    initialSession.modules_completed ?? 0
  );
  const [showNarration, setShowNarration] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [branchDecisionMeta, setBranchDecisionMeta] = useState<Record<
    string,
    unknown
  > | null>(null);
  const lastStartedModuleRef = useRef<string | null>(null);

  const current = useMemo(() => {
    if (graphMode && journey) {
      if (!currentNodeId) return null;
      const moduleId = moduleIdForNode(journey.nodes, currentNodeId);
      if (moduleId) {
        const mod = ordered.find((m) => m.id === moduleId);
        if (mod) return mod;
      }
      return null;
    }
    return ordered[index];
  }, [graphMode, journey, currentNodeId, ordered, index]);

  const total = ordered.length;

  const trackEvent = useCallback(
    async (body: {
      moduleId?: string | null;
      eventType: string;
      metadata?: Record<string, unknown> | null;
    }) => {
      const res = await fetch("/api/track-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken: token,
          moduleId: body.moduleId ?? null,
          eventType: body.eventType,
          metadata:
            attribution && Object.keys(attribution).length > 0
              ? { ...(body.metadata ?? {}), attribution }
              : (body.metadata ?? null),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "track-event failed");
      }
    },
    [token]
  );

  useEffect(() => {
    if (!current) return;
    if (lastStartedModuleRef.current === current.id) return;
    lastStartedModuleRef.current = current.id;
    void trackEvent({
      moduleId: current.id,
      eventType: "module_start",
    }).catch((err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to start module tracking.";
      setActionError(message);
    });
  }, [current, trackEvent]);

  const finishDemo = useCallback(() => {
    const params = new URLSearchParams({
      token,
    });
    if (adminMode) {
      params.set("admin_mode", "1");
    }
    router.push(`/demo/${sessionId}/complete?${params.toString()}`);
  }, [adminMode, router, sessionId, token]);

  const advanceLinear = useCallback(
    async (nextIdx: number) => {
      if (nextIdx >= ordered.length) return;
      const next = ordered[nextIdx];
      await trackEvent({
        moduleId: next.id,
        eventType: "module_start",
      });
      setIndex(nextIdx);
    },
    [ordered, trackEvent]
  );

  const advanceGraph = useCallback(
    async (
      fromNodeId: string,
      fromModuleId: string,
      decisionMeta: Record<string, unknown> | null
    ) => {
      if (!journey) return;
      const enrichedDecisionMeta = crucibleState
        ? {
            ...(decisionMeta ?? {}),
            engagement_trajectory: crucibleState.engagement_trajectory,
            recommended_pivot: crucibleState.recommended_pivot ?? "",
            has_friction: crucibleState.friction_points.length > 0 ? "true" : "false",
          }
        : decisionMeta;
      const nextNodeId = pickNextNodeId({
        edges: journey.edges,
        currentNodeId: fromNodeId,
        decisionMetadata: enrichedDecisionMeta,
      });
      await trackEvent({
        moduleId: fromModuleId,
        eventType: "journey_branch_decision",
        metadata: {
          from_node_id: fromNodeId,
          to_node_id: nextNodeId,
          decision: enrichedDecisionMeta,
        },
      });
      if (!nextNodeId) {
        await trackEvent({
          moduleId: fromModuleId,
          eventType: "demo_complete",
        });
        finishDemo();
        return;
      }
      const nextModuleId = moduleIdForNode(journey.nodes, nextNodeId);
      if (!nextModuleId) {
        setActionError("Journey graph has a node without a module mapping.");
        return;
      }
      await trackEvent({
        moduleId: nextModuleId,
        eventType: "module_start",
      });
      setCurrentNodeId(nextNodeId);
    },
    [crucibleState, finishDemo, journey, trackEvent]
  );

  const handleComplete = useCallback(async () => {
    if (!current) return;
    setActionError(null);
    await trackEvent({
      moduleId: current.id,
      eventType: "module_complete",
      metadata: {
        time_on_module_seconds: current.duration_seconds ?? 60,
      },
    });
    setCompletedCount((c) => c + 1);

    if (graphMode && journey && currentNodeId) {
      const meta = branchDecisionMeta;
      setBranchDecisionMeta(null);
      await advanceGraph(currentNodeId, current.id, meta);
      return;
    }

    const isLast = index >= ordered.length - 1;
    if (isLast) {
      await trackEvent({
        moduleId: current.id,
        eventType: "demo_complete",
      });
      finishDemo();
      return;
    }
    await advanceLinear(index + 1);
  }, [
    advanceGraph,
    advanceLinear,
    branchDecisionMeta,
    current,
    currentNodeId,
    finishDemo,
    graphMode,
    index,
    journey,
    ordered.length,
    trackEvent,
  ]);

  const handleSkip = useCallback(async () => {
    if (!current) return;
    setActionError(null);
    await trackEvent({
      moduleId: current.id,
      eventType: "module_skip",
    });

    if (graphMode && journey && currentNodeId) {
      setBranchDecisionMeta(null);
      await advanceGraph(currentNodeId, current.id, null);
      return;
    }

    const isLast = index >= ordered.length - 1;
    if (isLast) {
      await trackEvent({
        moduleId: current.id,
        eventType: "demo_complete",
      });
      finishDemo();
      return;
    }
    await advanceLinear(index + 1);
  }, [
    advanceGraph,
    advanceLinear,
    current,
    currentNodeId,
    finishDemo,
    graphMode,
    index,
    journey,
    ordered.length,
    trackEvent,
  ]);

  const handleCta = useCallback(
    async (metadata?: Record<string, unknown>) => {
      if (!current) return;
      setActionError(null);
      if (metadata && Object.keys(metadata).length > 0) {
        setBranchDecisionMeta(metadata);
      } else {
        setBranchDecisionMeta(null);
      }
      await trackEvent({
        moduleId: current.id,
        eventType: "cta_click",
        metadata: metadata ?? { source: "interactive" },
      });
    },
    [current, trackEvent]
  );

  const narrationForOverlay =
    current &&
    (current.module_type === "slide" || current.module_type === "narration_card") &&
    current.narration_script
      ? current.narration_script
      : null;

  if (!current) {
    return (
      <Card>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {graphMode
            ? "This track is in journey mode but the entry node or module mapping is missing. Ask an admin to configure the journey graph."
            : "No modules are configured for this track yet. Ask your admin to add modules in the dashboard."}
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {trackName}
          </p>
          <h1 className="text-2xl font-semibold">Interactive demo</h1>
          {graphMode && (
            <p className="mt-1 text-xs text-zinc-500">
              Branching journey mode active — CTA metadata can drive edge conditions.
            </p>
          )}
        </div>
        <LiveKuzeButton sessionId={sessionId} token={token} adminMode={adminMode} />
      </div>

      <ProgressBar completed={completedCount} total={Math.max(1, total)} />

      <Card>
        {actionError && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
            {actionError}
          </p>
        )}
        {narrationForOverlay && showNarration && (
          <KuzeNarration
            script={narrationForOverlay}
            onDismiss={() => setShowNarration(false)}
          />
        )}
        {narrationForOverlay && !showNarration && (
          <div className="mb-4">
            <button
              type="button"
              className="text-sm font-medium text-foreground underline"
              onClick={() => setShowNarration(true)}
            >
              Show Kuze narration
            </button>
          </div>
        )}
        <ModuleRenderer
          module={current}
          onComplete={() =>
            handleComplete().catch((err: unknown) => {
              const message =
                err instanceof Error
                  ? err.message
                  : "Failed to complete this module.";
              setActionError(message);
            })
          }
          onSkip={() =>
            handleSkip().catch((err: unknown) => {
              const message =
                err instanceof Error ? err.message : "Failed to skip module.";
              setActionError(message);
            })
          }
          onCta={(meta) =>
            handleCta(meta).catch((err: unknown) => {
              const message =
                err instanceof Error
                  ? err.message
                  : "Failed to record CTA interaction.";
              setActionError(message);
            })
          }
          onVideoWatchHalf={() =>
            trackEvent({
              moduleId: current.id,
              eventType: "video_watch_50",
              metadata: {
                watch_percent: 50,
              },
            })
          }
          onReplay={() =>
            trackEvent({
              moduleId: current.id,
              eventType: "module_replay",
            })
          }
          onVideoStart={() =>
            trackEvent({
              moduleId: current.id,
              eventType: "video_view_start",
              metadata: {
                watch_percent: 0,
              },
            })
          }
        />
      </Card>
    </div>
  );
}
