"use client";

import { useTransition } from "react";
import type { DemoModuleRow } from "@/types/demo";
import type { ModuleType } from "@/types/demo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
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

export function ModuleEditor({
  trackId,
  modules,
}: {
  trackId: string;
  modules: DemoModuleRow[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
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
