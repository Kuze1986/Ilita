"use client";

import { useEffect, useState, useTransition } from "react";
import type { DemoModuleRow } from "@/types/demo";
import type { ModuleType } from "@/types/demo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  createCrucibleCompareModule,
  createModule,
  deleteModule,
  reorderModule,
  updateModule,
} from "@/lib/admin-actions";

const MODULE_TYPES: ModuleType[] = [
  "video",
  "slide",
  "interactive",
  "iframe",
  "narration_card",
];

interface CrucibleRunOption {
  id: string;
  label: string;
}

interface CrucibleModuleConfig {
  provider: "crucible";
  mode: "compare";
  base_url: string;
  selected_run_ids: string[];
  available_runs: CrucibleRunOption[];
}

function parseCrucibleConfig(raw: Record<string, unknown> | null): CrucibleModuleConfig | null {
  if (!raw || raw.provider !== "crucible") return null;
  const selected = Array.isArray(raw.selected_run_ids)
    ? raw.selected_run_ids.filter((x): x is string => typeof x === "string").slice(0, 4)
    : [];
  const options = Array.isArray(raw.available_runs)
    ? raw.available_runs
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          if (typeof row.id !== "string") return null;
          const label = typeof row.label === "string" ? row.label : row.id;
          return { id: row.id, label };
        })
        .filter((x): x is CrucibleRunOption => Boolean(x))
    : [];
  const base = typeof raw.base_url === "string" ? raw.base_url : "";
  return {
    provider: "crucible",
    mode: "compare",
    base_url: base,
    selected_run_ids: selected,
    available_runs: options,
  };
}

function buildCrucibleCompareUrl(baseUrl: string, runIds: string[]): string | null {
  if (!baseUrl.trim()) return null;
  const ids = runIds.filter(Boolean).slice(0, 4).join(",");
  const url = new URL("/compare", baseUrl);
  url.searchParams.set("ids", ids);
  url.searchParams.set("embed", "1");
  return url.toString();
}

function inferBaseUrlFromContent(contentUrl: string | null): string {
  if (!contentUrl) return "";
  try {
    return new URL(contentUrl).origin;
  } catch {
    return "";
  }
}

export function ModuleEditor({
  trackId,
  modules,
}: {
  trackId: string;
  modules: DemoModuleRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [crucibleRuns, setCrucibleRuns] = useState<CrucibleRunOption[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadRuns() {
      try {
        const res = await fetch("/api/admin/crucible/runs");
        const data = (await res.json()) as { runs?: CrucibleRunOption[] };
        if (!cancelled) {
          setCrucibleRuns(Array.isArray(data.runs) ? data.runs : []);
        }
      } catch {
        if (!cancelled) {
          setCrucibleRuns([]);
        }
      } finally {
        if (!cancelled) {
          setRunsLoaded(true);
        }
      }
    }
    void loadRuns();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await createCrucibleCompareModule(trackId);
            })
          }
        >
          Add Crucible compare
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await createModule(trackId);
            })
          }
        >
          Add module
        </Button>
      </div>
      {modules.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No modules yet. Add one to build the demo track.
        </p>
      )}
      {modules.map((m, i) => (
        <Card key={m.id}>
          {(() => {
            const config = parseCrucibleConfig(m.interaction_config);
            const selected = config?.selected_run_ids ?? [];
            const available = crucibleRuns.length
              ? crucibleRuns
              : (config?.available_runs ?? []);

            async function updateCrucibleRuns(next: string[]) {
              const base =
                config?.base_url ??
                inferBaseUrlFromContent(m.content_url);
              const nextConfig: CrucibleModuleConfig = {
                provider: "crucible",
                mode: "compare",
                base_url: base,
                selected_run_ids: next.filter(Boolean).slice(0, 4),
                available_runs: available,
              };
              await updateModule(m.id, trackId, {
                module_type: "iframe",
                interaction_config: nextConfig as unknown as Record<string, unknown>,
                content_url: buildCrucibleCompareUrl(base, nextConfig.selected_run_ids),
              });
            }

            return config ? (
              <div className="mb-4 rounded-lg border border-[color:var(--panel-border)] bg-[rgba(44,247,223,0.08)] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                  Crucible compare module
                </p>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Select 1 to 4 runs. URL is generated automatically as /compare?ids=...&embed=1.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((slot) => (
                    <select
                      key={slot}
                      className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                      value={selected[slot] ?? ""}
                      onChange={(e) => {
                        const next = [...selected];
                        next[slot] = e.target.value;
                        const deduped = [...new Set(next.filter(Boolean))];
                        startTransition(async () => {
                          await updateCrucibleRuns(deduped);
                        });
                      }}
                    >
                      <option value="">
                        {runsLoaded ? `Select run ${slot + 1}` : "Loading runs..."}
                      </option>
                      {available.map((run) => (
                        <option key={run.id} value={run.id}>
                          {run.label}
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
              </div>
            ) : null;
          })()}
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={pending || i === 0}
              onClick={() =>
                startTransition(async () => {
                  await reorderModule(m.id, trackId, "up");
                })
              }
            >
              Up
            </Button>
            <Button
              variant="secondary"
              disabled={pending || i === modules.length - 1}
              onClick={() =>
                startTransition(async () => {
                  await reorderModule(m.id, trackId, "down");
                })
              }
            >
              Down
            </Button>
            <Button
              variant="ghost"
              className="ml-auto text-red-600"
              disabled={pending}
              onClick={() => {
                if (!confirm("Delete this module?")) return;
                startTransition(async () => {
                  await deleteModule(m.id, trackId);
                });
              }}
            >
              Delete
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-zinc-500">Title</label>
            <input
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950 sm:col-span-2"
              defaultValue={m.title}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (!v || v === m.title) return;
                startTransition(async () => {
                  await updateModule(m.id, trackId, { title: v });
                });
              }}
            />
            <label className="text-xs font-medium text-zinc-500">Type</label>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950 sm:col-span-2"
              defaultValue={m.module_type}
              onChange={(e) => {
                const v = e.target.value as ModuleType;
                startTransition(async () => {
                  await updateModule(m.id, trackId, { module_type: v });
                });
              }}
            >
              {MODULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="text-xs font-medium text-zinc-500">
              Content URL
            </label>
            <input
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950 sm:col-span-2"
              defaultValue={m.content_url ?? ""}
              placeholder="https://…"
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v === (m.content_url ?? "")) return;
                startTransition(async () => {
                  await updateModule(m.id, trackId, { content_url: v });
                });
              }}
            />
            <label className="text-xs font-medium text-zinc-500">
              Narration script
            </label>
            <textarea
              className="min-h-[100px] rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950 sm:col-span-2"
              defaultValue={m.narration_script ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v === (m.narration_script ?? "")) return;
                startTransition(async () => {
                  await updateModule(m.id, trackId, { narration_script: v });
                });
              }}
            />
            <label className="text-xs font-medium text-zinc-500">
              Duration (sec)
            </label>
            <input
              type="number"
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950 sm:col-span-2"
              defaultValue={m.duration_seconds ?? 60}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isNaN(n)) return;
                startTransition(async () => {
                  await updateModule(m.id, trackId, { duration_seconds: n });
                });
              }}
            />
            <label className="flex items-center gap-2 text-xs sm:col-span-2">
              <input
                type="checkbox"
                defaultChecked={m.is_skippable !== false}
                onChange={(e) => {
                  startTransition(async () => {
                    await updateModule(m.id, trackId, {
                      is_skippable: e.target.checked,
                    });
                  });
                }}
              />
              Skippable
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Interaction JSON (CTAs)
            </label>
            <textarea
              className="min-h-[80px] rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-600 dark:bg-zinc-950 sm:col-span-2"
              defaultValue={
                m.interaction_config
                  ? JSON.stringify(m.interaction_config, null, 2)
                  : '{"ctas":[{"label":"Book a call","metadata":{"cta":"book"}}]}'
              }
              onBlur={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value) as Record<
                    string,
                    unknown
                  >;
                  startTransition(async () => {
                    await updateModule(m.id, trackId, {
                      interaction_config: parsed,
                    });
                  });
                } catch {
                  /* invalid json — skip save */
                }
              }}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}
