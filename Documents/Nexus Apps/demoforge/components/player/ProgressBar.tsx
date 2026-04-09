"use client";

export function ProgressBar({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const safeTotal = Math.max(1, total);
  const pct = Math.min(100, Math.round((completed / safeTotal) * 100));
  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between text-xs text-zinc-500">
        <span>Progress</span>
        <span>
          {completed} / {total} modules
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-foreground transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
