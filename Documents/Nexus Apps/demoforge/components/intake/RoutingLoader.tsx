"use client";

import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export function RoutingLoader() {
  return (
    <div className="glass flex flex-col items-center justify-center gap-4 rounded-2xl p-8">
      <LoadingSpinner className="h-12 w-12" />
      <p className="max-w-sm text-center text-sm soft-muted">
        Kuze is routing you to the right NEXUS demo track based on your answers…
      </p>
    </div>
  );
}
