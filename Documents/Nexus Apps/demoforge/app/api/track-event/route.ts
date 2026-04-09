import { after } from "next/server";
import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/logging";
import { generateAndSendFollowUp } from "@/lib/session-followup";
import { applyScoreForSession } from "@/lib/session-score";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { SessionEventType } from "@/types/events";

export const runtime = "nodejs";

const EVENT_TYPES: SessionEventType[] = [
  "module_start",
  "module_complete",
  "module_skip",
  "module_replay",
  "kuze_live_start",
  "kuze_message_sent",
  "cta_click",
  "demo_complete",
  "demo_drop",
];

function isEventType(s: string): s is SessionEventType {
  return EVENT_TYPES.includes(s as SessionEventType);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionToken?: string;
      moduleId?: string | null;
      eventType?: string;
      metadata?: Record<string, unknown> | null;
    };
    const { sessionToken, moduleId, eventType, metadata } = body;
    if (!sessionToken || typeof sessionToken !== "string") {
      return NextResponse.json({ error: "sessionToken required" }, { status: 400 });
    }
    if (!eventType || !isEventType(eventType)) {
      return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
    }

    const supabase = createServiceSupabaseClient();
    const { data: session, error: sErr } = await supabase
      .from("demo_sessions")
      .select("id, modules_completed, status")
      .eq("token", sessionToken)
      .single();

    if (sErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sessionId = session.id as string;

    const { error: evErr } = await supabase.from("session_events").insert({
      session_id: sessionId,
      module_id: moduleId ?? null,
      event_type: eventType,
      metadata: metadata ?? null,
    });
    if (evErr) {
      throw new Error(evErr.message);
    }

    const updates: Record<string, unknown> = {};

    if (eventType === "module_start") {
      updates.status = "in_progress";
      if (moduleId) updates.current_module_id = moduleId;
    }

    if (eventType === "module_complete") {
      const prev = (session.modules_completed as number) ?? 0;
      updates.modules_completed = prev + 1;
    }

    if (eventType === "kuze_live_start") {
      updates.live_mode_activated = true;
    }

    if (eventType === "demo_complete") {
      updates.status = "completed";
      updates.completed_at = new Date().toISOString();
    }

    if (eventType === "demo_drop") {
      updates.status = "dropped";
      if (moduleId) updates.drop_module_id = moduleId;
    }

    if (Object.keys(updates).length > 0) {
      const { error: uErr } = await supabase
        .from("demo_sessions")
        .update(updates)
        .eq("id", sessionId);
      if (uErr) {
        throw new Error(uErr.message);
      }
    }

    await logSystemEvent({
      function_name: "track_event",
      session_id: sessionId,
      status: "success",
      message: eventType,
      payload: { moduleId: moduleId ?? null, metadata: metadata ?? null },
    });

    if (eventType === "demo_complete") {
      after(async () => {
        try {
          await applyScoreForSession(sessionId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logSystemEvent({
            function_name: "score_session",
            session_id: sessionId,
            status: "error",
            message: msg,
          });
        }
        try {
          await generateAndSendFollowUp(sessionId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logSystemEvent({
            function_name: "send_followup",
            session_id: sessionId,
            status: "error",
            message: msg,
          });
        }
      });
    }

    if (eventType === "demo_drop") {
      after(async () => {
        try {
          await applyScoreForSession(sessionId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logSystemEvent({
            function_name: "score_session",
            session_id: sessionId,
            status: "error",
            message: msg,
          });
        }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await logSystemEvent({
      function_name: "track_event",
      status: "error",
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
