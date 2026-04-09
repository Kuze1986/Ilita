"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DemoModuleRow } from "@/types/demo";
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

export function DemoPlayer({
  sessionId,
  token,
  trackName,
  modules,
  initialSession,
}: {
  sessionId: string;
  token: string;
  trackName: string;
  modules: DemoModuleRow[];
  initialSession: InitialSession;
}) {
  const router = useRouter();
  const ordered = useMemo(
    () => [...modules].sort((a, b) => a.sequence_order - b.sequence_order),
    [modules]
  );

  const startIndex = useMemo(() => {
    if (!initialSession.current_module_id || ordered.length === 0) return 0;
    const i = ordered.findIndex(
      (m) => m.id === initialSession.current_module_id
    );
    return i < 0 ? 0 : i;
  }, [ordered, initialSession.current_module_id]);

  const [index, setIndex] = useState(startIndex);
  const [completedCount, setCompletedCount] = useState(
    initialSession.modules_completed ?? 0
  );
  const [showNarration, setShowNarration] = useState(false);
  const startedRef = useRef(false);

  const current = ordered[index];
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
          metadata: body.metadata ?? null,
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
    if (!current || startedRef.current) return;
    startedRef.current = true;
    void trackEvent({
      moduleId: current.id,
      eventType: "module_start",
    }).catch(console.error);
  }, [current, trackEvent]);

  const finishDemo = useCallback(() => {
    router.push(
      `/demo/${sessionId}/complete?token=${encodeURIComponent(token)}`
    );
  }, [router, sessionId, token]);

  const advanceAfter = useCallback(
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

  const handleComplete = useCallback(async () => {
    if (!current) return;
    await trackEvent({
      moduleId: current.id,
      eventType: "module_complete",
      metadata: {
        time_on_module_seconds: current.duration_seconds ?? 60,
      },
    });
    setCompletedCount((c) => c + 1);
    const isLast = index >= ordered.length - 1;
    if (isLast) {
      await trackEvent({
        moduleId: current.id,
        eventType: "demo_complete",
      });
      finishDemo();
      return;
    }
    await advanceAfter(index + 1);
  }, [advanceAfter, current, finishDemo, index, ordered.length, trackEvent]);

  const handleSkip = useCallback(async () => {
    if (!current) return;
    await trackEvent({
      moduleId: current.id,
      eventType: "module_skip",
    });
    const isLast = index >= ordered.length - 1;
    if (isLast) {
      await trackEvent({
        moduleId: current.id,
        eventType: "demo_complete",
      });
      finishDemo();
      return;
    }
    await advanceAfter(index + 1);
  }, [advanceAfter, current, finishDemo, index, ordered.length, trackEvent]);

  const handleCta = useCallback(
    async (metadata?: Record<string, unknown>) => {
      if (!current) return;
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
          No modules are configured for this track yet. Ask your admin to add
          modules in the dashboard.
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
        </div>
        <LiveKuzeButton sessionId={sessionId} token={token} />
      </div>

      <ProgressBar completed={completedCount} total={Math.max(1, total)} />

      <Card>
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
          onComplete={() => handleComplete().catch(console.error)}
          onSkip={() => handleSkip().catch(console.error)}
          onCta={(meta) => handleCta(meta).catch(console.error)}
        />
      </Card>
    </div>
  );
}
