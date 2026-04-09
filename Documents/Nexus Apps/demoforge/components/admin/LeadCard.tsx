import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ENGAGEMENT_THRESHOLDS, PRODUCT_LABELS } from "@/lib/constants";
import type { LeadListItem } from "@/types/admin";
import type { ProductKey } from "@/types/demo";

function scoreTone(
  score: number | null | undefined
): "success" | "warning" | "muted" | "default" {
  if (score == null) return "muted";
  if (score >= ENGAGEMENT_THRESHOLDS.hot) return "success";
  if (score >= ENGAGEMENT_THRESHOLDS.warm) return "warning";
  if (score >= ENGAGEMENT_THRESHOLDS.cool) return "default";
  return "muted";
}

export function LeadCard({ item }: { item: LeadListItem }) {
  const { prospect, latestSession, trackName } = item;
  const name =
    `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() ||
    prospect.email;
  const score =
    latestSession?.engagement_score != null
      ? Number(latestSession.engagement_score)
      : null;
  const products = (prospect.product_interest as ProductKey[] | null) ?? [];

  return (
    <Card>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">{name}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {prospect.email}
          </p>
          <p className="text-xs text-zinc-500">{prospect.organization ?? "—"}</p>
        </div>
        {latestSession && (
          <Badge tone={scoreTone(score)}>
            Score {score != null ? score.toFixed(0) : "—"}
          </Badge>
        )}
      </div>
      {latestSession && (
        <p className="mt-3 text-xs text-zinc-500">
          Last session: {latestSession.status} · {trackName ?? "Track"} ·{" "}
          {latestSession.started_at
            ? new Date(latestSession.started_at).toLocaleString()
            : ""}
        </p>
      )}
      {products.length > 0 && (
        <p className="mt-2 text-xs">
          Interests:{" "}
          {products.map((p) => PRODUCT_LABELS[p] ?? p).join(", ")}
        </p>
      )}
      {prospect.routing_reason && (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          Routing: {prospect.routing_reason}
        </p>
      )}
    </Card>
  );
}
