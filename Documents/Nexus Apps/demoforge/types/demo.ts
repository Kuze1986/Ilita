export type ProductKey =
  | "keystone"
  | "meridian"
  | "scripta"
  | "rxblitz"
  | "bioloop";

export type ModuleType =
  | "video"
  | "slide"
  | "interactive"
  | "iframe"
  | "narration_card";

export type SessionStatus =
  | "started"
  | "in_progress"
  | "completed"
  | "dropped"
  | "deflected";

export type ProspectPersona =
  | "workforce_admin"
  | "pharmacy_director"
  | "training_coordinator"
  | "individual_learner"
  | "executive"
  | "it_evaluator"
  | "unknown";

export interface DemoTrackRow {
  id: string;
  product: ProductKey;
  persona: ProspectPersona;
  name: string;
  description: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface DemoModuleRow {
  id: string;
  track_id: string;
  sequence_order: number;
  title: string;
  module_type: ModuleType;
  content_url: string | null;
  narration_script: string | null;
  interaction_config: Record<string, unknown> | null;
  duration_seconds: number | null;
  is_skippable: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface ProspectRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  organization: string | null;
  role: string | null;
  persona: ProspectPersona;
  pain_points: string[] | null;
  product_interest: ProductKey[] | null;
  intake_raw: Record<string, unknown> | null;
  routing_reason: string | null;
  is_qualified: boolean | null;
  deflection_reason: string | null;
  created_at: string;
}

export interface DemoSessionRow {
  id: string;
  prospect_id: string | null;
  track_id: string | null;
  status: SessionStatus;
  current_module_id: string | null;
  modules_completed: number | null;
  modules_total: number | null;
  live_mode_activated: boolean | null;
  engagement_score: number | null;
  score_breakdown: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
  drop_module_id: string | null;
  follow_up_sent: boolean | null;
  follow_up_sent_at: string | null;
  token: string | null;
}
