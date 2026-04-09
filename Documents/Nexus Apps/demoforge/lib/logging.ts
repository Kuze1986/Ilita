import { createServiceSupabaseClient } from "@/lib/supabase/server";

export type SystemLogStatus = "success" | "error";

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
