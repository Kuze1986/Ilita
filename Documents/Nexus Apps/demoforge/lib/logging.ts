import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type SystemLogStatus = "success" | "error";

export interface LogAuditEventInput {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  try {
    const supabase = createServiceSupabaseClient();
    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: input.tenantId ?? null,
      actor_user_id: input.actorUserId ?? null,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      metadata: input.metadata ?? null,
    });
    if (error) {
      console.error("[demoforge] audit_logs insert failed:", error.message);
    }
  } catch (e) {
    console.error("[demoforge] logAuditEvent exception:", e);
  }
}

export interface LogSystemEventInput {
  function_name: string;
  session_id?: string | null;
  status: SystemLogStatus;
  message?: string | null;
  payload?: Record<string, unknown> | null;
}

export async function logSystemEvent(input: LogSystemEventInput): Promise<void> {
  try {
    const supabase = createServiceSupabaseClient();
    const { error } = await supabase.from("system_logs").insert({
      function_name: input.function_name,
      session_id: input.session_id ?? null,
      status: input.status,
      message: input.message ?? null,
      payload: input.payload ?? null,
    });
    if (error) {
      console.error("[demoforge] system_logs insert failed:", error.message);
    }
  } catch (e) {
    console.error("[demoforge] logSystemEvent exception:", e);
  }
}
