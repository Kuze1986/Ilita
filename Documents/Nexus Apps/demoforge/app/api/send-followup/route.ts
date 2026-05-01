import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/logging";
import { generateAndSendFollowUp } from "@/lib/session-followup";
import { waitForBestCompletedRenderForSession } from "@/lib/video/render-select";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string; waitForVideoMs?: number };
    if (!body.sessionId || typeof body.sessionId !== "string") {
      await logSystemEvent({
        function_name: "send_followup_api",
        status: "error",
        message: "sessionId required",
      });
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    const waitMs =
      typeof body.waitForVideoMs === "number" && body.waitForVideoMs > 0
        ? Math.min(body.waitForVideoMs, 30_000)
        : 0;
    const bestRender = waitMs
      ? await waitForBestCompletedRenderForSession(body.sessionId, waitMs)
      : null;
    await generateAndSendFollowUp(body.sessionId, {
      preferredVideoUrl: bestRender?.finalVideoPath ?? null,
    });
    await logSystemEvent({
      function_name: "send_followup_api",
      session_id: body.sessionId,
      status: "success",
      message: "Follow-up sent",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await logSystemEvent({
      function_name: "send_followup_api",
      status: "error",
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
