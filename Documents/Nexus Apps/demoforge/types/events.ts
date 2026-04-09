export type SessionEventType =
  | "module_start"
  | "module_complete"
  | "module_skip"
  | "module_replay"
  | "kuze_live_start"
  | "kuze_message_sent"
  | "cta_click"
  | "demo_complete"
  | "demo_drop";

export interface TrackEventPayload {
  sessionToken: string;
  moduleId?: string | null;
  eventType: SessionEventType;
  metadata?: Record<string, unknown> | null;
}

export interface SessionEventRow {
  id: string;
  session_id: string;
  module_id: string | null;
  event_type: SessionEventType;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}
