import type { DemoSessionRow, ProspectRow, ProductKey } from "./demo";
import type { SessionStatus } from "./demo";

export interface SessionFeedItem {
  id: string;
  status: SessionStatus;
  engagement_score: number | null;
  started_at: string;
  prospect?: Pick<
    ProspectRow,
    "first_name" | "last_name" | "email" | "organization"
  > | null;
  track_name?: string | null;
  track_product?: ProductKey | null;
}

export interface DashboardMetrics {
  sessionsToday: number;
  completionRate: number;
  avgEngagementScore: number | null;
  followUpsSentToday: number;
}

export interface LeadListItem {
  prospect: ProspectRow;
  latestSession: DemoSessionRow | null;
  trackName: string | null;
}
