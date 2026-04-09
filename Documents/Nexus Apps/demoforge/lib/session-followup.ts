import { getAnthropicClient, getAnthropicModel } from "@/lib/anthropic";
import { logSystemEvent } from "@/lib/logging";
import { KUZE_SYSTEM_PROMPT, type KuzeContext } from "@/lib/kuze";
import { stripJsonFence } from "@/lib/routing";
import { getResendClient, getResendFrom, wrapEmailHtml } from "@/lib/resend";
import { PRODUCT_LABELS } from "@/lib/constants";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductKey } from "@/types/demo";
import type { ScoreBreakdown } from "@/lib/scoring";

interface FollowUpJson {
  subject: string;
  body_html: string;
}

export async function generateAndSendFollowUp(sessionId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();

  const { data: session, error: sErr } = await supabase
    .from("demo_sessions")
    .select(
      "id, prospect_id, track_id, engagement_score, score_breakdown, modules_completed, modules_total, follow_up_sent"
    )
    .eq("id", sessionId)
    .single();
  if (sErr || !session) {
    throw new Error(sErr?.message ?? "Session not found");
  }
  if (session.follow_up_sent) {
    await logSystemEvent({
      function_name: "send_followup",
      session_id: sessionId,
      status: "success",
      message: "Skipped: follow_up already sent",
    });
    return;
  }

  const { data: existing } = await supabase
    .from("follow_ups")
    .select("id")
    .eq("session_id", sessionId)
    .limit(1);
  if (existing && existing.length > 0) {
    await logSystemEvent({
      function_name: "send_followup",
      session_id: sessionId,
      status: "success",
      message: "Skipped: follow_ups row exists",
    });
    return;
  }

  const prospectId = session.prospect_id as string;
  const { data: prospect, error: pErr } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .single();
  if (pErr || !prospect) {
    throw new Error(pErr?.message ?? "Prospect not found");
  }

  const { data: track, error: tErr } = await supabase
    .from("demo_tracks")
    .select("name, product")
    .eq("id", session.track_id as string)
    .single();
  if (tErr || !track) {
    throw new Error(tErr?.message ?? "Track not found");
  }

  const productKey = track.product as ProductKey;
  const productName = PRODUCT_LABELS[productKey] ?? productKey;
  const first = prospect.first_name ?? "";
  const last = prospect.last_name ?? "";
  const name = `${first} ${last}`.trim() || "there";
  const org = prospect.organization ?? "";
  const pain =
    (prospect.pain_points as string[] | null)?.join(", ") ?? "Not specified";
  const score = session.engagement_score ?? 0;
  const breakdown = session.score_breakdown as ScoreBreakdown | null;
  const modulesDone = session.modules_completed ?? 0;
  const modulesTotal = session.modules_total ?? 0;

  const kuzeCtx: KuzeContext = {
    prospectName: name,
    organization: org,
    role: prospect.role ?? "",
    painPoints: (prospect.pain_points as string[] | null) ?? [],
    productName,
    trackName: (track.name as string) ?? productName,
    currentModuleTitle: "Post-demo follow-up",
  };

  const anthropic = getAnthropicClient();
  const userPrompt = `You are Kuze. Write a follow-up email to ${name} at ${org}.
They just watched the ${productName} demo (${track.name as string}). Their engagement score was ${score}.
Score breakdown (JSON): ${JSON.stringify(breakdown ?? {})}.
Pain points: ${pain}. Modules completed: ${modulesDone}/${modulesTotal}.
Personalize the email — reference what they saw, map it to their pain,
and close with a specific next step.
Return ONLY JSON: {"subject":"...","body_html":"..."} where body_html is concise HTML (p, strong, ul allowed).`;

  const msg = await anthropic.messages.create({
    model: getAnthropicModel(),
    max_tokens: 2048,
    system: KUZE_SYSTEM_PROMPT(kuzeCtx),
    messages: [{ role: "user", content: userPrompt }],
  });
  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Follow-up: no text from model");
  }
  let parsed: FollowUpJson;
  try {
    parsed = JSON.parse(stripJsonFence(block.text)) as FollowUpJson;
  } catch {
    throw new Error("Follow-up: invalid JSON from model");
  }
  if (!parsed.subject || !parsed.body_html) {
    throw new Error("Follow-up: missing subject or body_html");
  }

  const resend = getResendClient();
  const { data: sendData, error: sendErr } = await resend.emails.send({
    from: getResendFrom(),
    to: prospect.email as string,
    subject: parsed.subject,
    html: wrapEmailHtml(parsed.body_html),
  });
  if (sendErr) {
    throw new Error(sendErr.message);
  }

  const messageId =
    sendData && typeof sendData === "object" && "id" in sendData
      ? String((sendData as { id?: string }).id ?? "")
      : "";

  const { error: fErr } = await supabase.from("follow_ups").insert({
    session_id: sessionId,
    prospect_id: prospectId,
    subject: parsed.subject,
    body_html: parsed.body_html,
    resend_message_id: messageId || null,
    sent_at: new Date().toISOString(),
  });
  if (fErr) {
    throw new Error(fErr.message);
  }

  const { error: uErr } = await supabase
    .from("demo_sessions")
    .update({
      follow_up_sent: true,
      follow_up_sent_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
  if (uErr) {
    throw new Error(uErr.message);
  }

  await logSystemEvent({
    function_name: "send_followup",
    session_id: sessionId,
    status: "success",
    message: "Email sent",
    payload: { resend_message_id: messageId },
  });
}
