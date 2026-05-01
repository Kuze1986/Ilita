"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ENGAGEMENT_THRESHOLDS } from "@/lib/constants";
import type { SessionFeedItem } from "@/types/admin";

function scoreTone(
  score: number | null | undefined
): "success" | "warning" | "muted" | "default" {
  if (score == null) return "muted";
  if (score >= ENGAGEMENT_THRESHOLDS.hot) return "success";
  if (score >= ENGAGEMENT_THRESHOLDS.warm) return "warning";
  if (score >= ENGAGEMENT_THRESHOLDS.cool) return "default";
  return "muted";
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge tone="success">{status}</Badge>;
    case "dropped":
      return <Badge tone="warning">{status}</Badge>;
    case "in_progress":
      return <Badge tone="default">{status}</Badge>;
    default:
      return <Badge tone="muted">{status}</Badge>;
  }
}

export function SessionFeed({ initial }: { initial: SessionFeedItem[] }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel("demo_sessions_realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "demoforge",
          table: "demo_sessions",
        },
        () => {
          if (!cancelled) {
            router.refresh();
          }
        }
      )
      .subscribe();

    const poll = window.setInterval(() => {
      router.refresh();
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  if (initial.length === 0) {
    return (
      <Card>
        <p className="text-sm soft-muted">
          No sessions yet. Complete an intake on the public demo to see activity
          here.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-[color:var(--panel-border)] bg-[rgba(255,255,255,0.03)] text-xs soft-muted">
          <tr>
            <th className="px-4 py-2">Prospect</th>
            <th className="px-4 py-2">Track</th>
            <th className="px-4 py-2">Delivery</th>
            <th className="px-4 py-2">Naturalness</th>
            <th className="px-4 py-2">Started</th>
            <th className="px-4 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {initial.map((row) => {
            const name =
              `${row.prospect?.first_name ?? ""} ${row.prospect?.last_name ?? ""}`.trim() ||
              row.prospect?.email ||
              "—";
            const score =
              row.engagement_score != null
                ? Number(row.engagement_score)
                : null;
            return (
              <tr
                key={row.id}
                className="border-b border-[color:var(--panel-border)]/40"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{name}</div>
                  <div className="text-xs soft-muted">
                    {row.prospect?.organization ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">
                  <div>{row.track_name ?? "Prospect"}</div>
                  <div className="soft-muted">{row.track_product ?? "—"}</div>
                </td>
                <td className="px-4 py-3">{statusBadge(row.status)}</td>
                <td className="px-4 py-3">
                  <Badge tone={scoreTone(score)}>
                    Naturalness {score != null ? `${score.toFixed(1)}%` : "—"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs soft-muted">
                  {row.started_at
                    ? new Date(row.started_at).toLocaleString()
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/leads?q=${encodeURIComponent(row.prospect?.email ?? "")}`}
                    className="text-sm font-medium text-foreground underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
