import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/logging";
import { generateAndSendFollowUp } from "@/lib/session-followup";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string };
    if (!body.sessionId || typeof body.sessionId !== "string") {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    await generateAndSendFollowUp(body.sessionId);
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
