"use client";

import { Button } from "@/components/ui/Button";

export function KuzeNarration({
  script,
  onDismiss,
}: {
  script: string;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Kuze
        </p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{script}</p>
        <div className="mt-4 flex justify-end">
          <Button onClick={onDismiss}>Continue</Button>
        </div>
      </div>
    </div>
  );
}
