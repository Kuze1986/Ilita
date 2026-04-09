"use client";

import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export function RoutingLoader() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <LoadingSpinner className="h-12 w-12" />
      <p className="max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
        Kuze is routing you to the right NEXUS demo track based on your answers…
      </p>
    </div>
  );
}
