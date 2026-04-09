"use client";

import type { DemoModuleRow } from "@/types/demo";
import { Button } from "@/components/ui/Button";

interface CtaConfig {
  label: string;
  metadata?: Record<string, unknown>;
}

function parseCtas(config: Record<string, unknown> | null): CtaConfig[] {
  if (!config) return [];
  const raw = config.ctas;
  if (!Array.isArray(raw)) return [];
  const out: CtaConfig[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o.label !== "string") continue;
    out.push({
      label: o.label,
      metadata:
        o.metadata && typeof o.metadata === "object"
          ? (o.metadata as Record<string, unknown>)
          : undefined,
    });
  }
  return out;
}

export function ModuleRenderer({
  module,
  onComplete,
  onSkip,
  onCta,
}: {
  module: DemoModuleRow;
  onComplete: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  onCta: (metadata?: Record<string, unknown>) => void | Promise<void>;
}) {
  const skippable = module.is_skippable !== false;
  const ctas = parseCtas(module.interaction_config);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">{module.title}</h2>
        {module.duration_seconds != null && (
          <p className="mt-1 text-xs text-zinc-500">
            About {module.duration_seconds}s expected
          </p>
        )}
      </div>

      {module.module_type === "video" &&
        (module.content_url ? (
          <video
            className="w-full max-w-3xl rounded-lg bg-black"
            src={module.content_url}
            controls
            onEnded={() => void Promise.resolve(onComplete())}
          />
        ) : (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            No video URL configured for this module.
          </p>
        ))}

      {module.module_type === "slide" && module.content_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={module.content_url}
          alt={module.title}
          className="max-h-[70vh] w-auto max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
        />
      )}

      {module.module_type === "iframe" && module.content_url && (
        <iframe
          title={module.title}
          src={module.content_url}
          className="min-h-[420px] w-full max-w-4xl rounded-lg border border-zinc-200 dark:border-zinc-700"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      )}

      {module.module_type === "narration_card" && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-700 dark:bg-zinc-800/50">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {module.narration_script ?? "No narration text configured."}
          </p>
        </div>
      )}

      {module.module_type === "interactive" && (
        <div className="flex flex-col gap-3">
          {ctas.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No CTAs configured for this module.
            </p>
          ) : (
            ctas.map((c, i) => (
              <Button
                key={i}
                variant="primary"
                className="justify-start"
                onClick={() =>
                  void (async () => {
                    await onCta(c.metadata);
                    await onComplete();
                  })()
                }
              >
                {c.label}
              </Button>
            ))
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        {module.module_type !== "interactive" && (
          <Button onClick={() => void Promise.resolve(onComplete())}>
            Mark complete
          </Button>
        )}
        {skippable && (
          <Button variant="ghost" onClick={() => void Promise.resolve(onSkip())}>
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}
