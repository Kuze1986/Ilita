import { NextResponse } from "next/server";
import { getAnthropicClient, getAnthropicModel } from "@/lib/anthropic";
import { logSystemEvent } from "@/lib/logging";
import { KUZE_SYSTEM_PROMPT, type KuzeContext } from "@/lib/kuze";
import { PRODUCT_LABELS } from "@/lib/constants";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ProductKey } from "@/types/demo";

export const runtime = "nodejs";

interface TranscriptEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

async function persistAfterChat(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  sessionId: string,
  moduleId: string | null,
  userMessage: string,
  assistantText: string
) {
  const now = new Date().toISOString();
  const userEntry: TranscriptEntry = {
    role: "user",
    content: userMessage,
    timestamp: now,
  };
  const asstEntry: TranscriptEntry = {
    role: "assistant",
    content: assistantText,
    timestamp: now,
  };

  const { data: kuzeRow } = await supabase
    .from("kuze_sessions")
    .select("id, transcript, message_count")
    .eq("session_id", sessionId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prev = (kuzeRow?.transcript as TranscriptEntry[] | null) ?? [];
  const nextTranscript = [...prev, userEntry, asstEntry];
  const nextCount = (kuzeRow?.message_count as number | null) ?? 0;
  const messageCount = nextCount + 1;

  if (kuzeRow?.id) {
    const { error } = await supabase
      .from("kuze_sessions")
      .update({
        transcript: nextTranscript,
        message_count: messageCount,
      })
      .eq("id", kuzeRow.id as string);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("kuze_sessions").insert({
      session_id: sessionId,
      transcript: nextTranscript,
      message_count: messageCount,
    });
    if (error) throw new Error(error.message);
  }

  const { error: evErr } = await supabase.from("session_events").insert({
    session_id: sessionId,
    module_id: moduleId,
    event_type: "kuze_message_sent",
    metadata: { preview: assistantText.slice(0, 200) },
  });
  if (evErr) throw new Error(evErr.message);
}

export async function POST(request: Request) {
  let sessionIdForLog: string | undefined;
  try {
    const body = (await request.json()) as {
      sessionToken?: string;
      message?: string;
      conversationHistory?: MessageParam[];
    };
    const { sessionToken, message, conversationHistory } = body;
    if (!sessionToken || typeof sessionToken !== "string") {
      return NextResponse.json({ error: "sessionToken required" }, { status: 400 });
    }
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }
    const history = Array.isArray(conversationHistory) ? conversationHistory : [];

    const supabase = createServiceSupabaseClient();
    const { data: session, error: sErr } = await supabase
      .from("demo_sessions")
      .select("id, prospect_id, track_id, current_module_id")
      .eq("token", sessionToken)
      .single();

    if (sErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    sessionIdForLog = session.id as string;
    const prospectId = session.prospect_id as string;
    const trackId = session.track_id as string;
    const moduleId = session.current_module_id as string | null;

    const { data: prospect, error: pErr } = await supabase
      .from("prospects")
      .select("first_name, last_name, organization, role, pain_points")
      .eq("id", prospectId)
      .single();
    if (pErr || !prospect) {
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    }

    const { data: track, error: tErr } = await supabase
      .from("demo_tracks")
      .select("name, product")
      .eq("id", trackId)
      .single();
    if (tErr || !track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    let moduleTitle = "Overview";
    if (moduleId) {
      const { data: mod } = await supabase
        .from("demo_modules")
        .select("title")
        .eq("id", moduleId)
        .single();
      if (mod?.title) moduleTitle = mod.title as string;
    }

    const productKey = track.product as ProductKey;
    const first = prospect.first_name ?? "";
    const last = prospect.last_name ?? "";
    const name = `${first} ${last}`.trim() || "Guest";

    const ctx: KuzeContext = {
      prospectName: name,
      organization: (prospect.organization as string) ?? "",
      role: (prospect.role as string) ?? "",
      painPoints: (prospect.pain_points as string[] | null) ?? [],
      productName: PRODUCT_LABELS[productKey] ?? productKey,
      trackName: (track.name as string) ?? "",
      currentModuleTitle: moduleTitle,
    };

    const anthropic = getAnthropicClient();
    const messages: MessageParam[] = [
      ...history.filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      ),
      { role: "user", content: message },
    ];

    const modelStream = anthropic.messages.stream({
      model: getAnthropicModel(),
      max_tokens: 4096,
      system: KUZE_SYSTEM_PROMPT(ctx),
      messages,
    });

    const encoder = new TextEncoder();
    let assistantAccum = "";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const ev of modelStream) {
            if (
              ev.type === "content_block_delta" &&
              ev.delta.type === "text_delta"
            ) {
              const piece = ev.delta.text;
              assistantAccum += piece;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ text: piece })}\n\n`
                )
              );
            }
          }
          await persistAfterChat(
            supabase,
            sessionIdForLog!,
            moduleId,
            message,
            assistantAccum
          );
          await logSystemEvent({
            function_name: "kuze_chat",
            session_id: sessionIdForLog,
            status: "success",
            message: "Stream complete",
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logSystemEvent({
            function_name: "kuze_chat",
            session_id: sessionIdForLog,
            status: "error",
            message: msg,
          });
          controller.error(e instanceof Error ? e : new Error(msg));
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const messageErr = e instanceof Error ? e.message : "Unknown error";
    await logSystemEvent({
      function_name: "kuze_chat",
      session_id: sessionIdForLog,
      status: "error",
      message: messageErr,
    });
    return NextResponse.json({ error: messageErr }, { status: 500 });
  }
}
