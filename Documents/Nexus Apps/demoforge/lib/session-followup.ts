import { getAnthropicClient, getAnthropicModel } from "@/lib/anthropic";
import { logSystemEvent } from "@/lib/logging";
import { buildKuzeFollowupSystemPrompt } from "@/lib/kuze/assembly";
import { KUZE_SYSTEM_PROMPT, type KuzeContext } from "@/lib/kuze";
import { stripJsonFence } from "@/lib/routing";
import { getResendClient, getResendFrom, wrapEmailHtml } from "@/lib/resend";
import { PRODUCT_LABELS } from "@/lib/constants";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { ProductKey } from "@/types/demo";
import type { ScoreBreakdown } from "@/lib/scoring";
import { dispatchIntegrationEvent } from "@/lib/integrations/index";
import { getBestCompletedRenderForSession } from "@/lib/video/render-select";
import {
  getPersona,
  PersonaInactiveError,
  PersonaNotFoundError,
} from "@/server/src/demoforge/getPersona";

interface FollowUpJson {
  subject: string;
  body_html: string;
}

function buildFallbackFollowUp(input: {
  name: string;
  org: string;
  productName: string;
  trackName: string;
  score: number;
  painPoints: string[];
  modulesDone: number;
  modulesTotal: number;
  videoUrl: string | null;
}): FollowUpJson {
  const scoreBand =
    input.score >= 80
      ? "high-priority"
      : input.score >= 50
        ? "strong"
        : input.score >= 20
          ? "early-stage"
          : "exploratory";
  const painLine = input.painPoints.length
    ? input.painPoints.join(", ")
    : "onboarding speed and training consistency";
  const replayLine = input.videoUrl
    ? `<p>If it helps, here is your replay link: <a href="${input.videoUrl}">${input.videoUrl}</a>.</p>`
    : "<p>If you want, I can send a focused replay aligned to your team goals.</p>";
  return {
    subject: `${input.name.split(" ")[0] || "Quick"} — next step after your ${input.productName} demo`,
    body_html: [
      `<p>${input.name},</p>`,
      `<p>Thanks for reviewing ${input.productName} (${input.trackName}). Based on your session (${input.modulesDone}/${input.modulesTotal} modules, ${scoreBand} engagement), the most relevant next step is mapping your current workflow at ${input.org || "your organization"} to a rollout plan.</p>`,
      `<p>You flagged ${painLine}. We can directly map those gaps to a 30-day execution path with owners, milestones, and measurable outcomes.</p>`,
      replayLine,
      "<p>If useful, reply with two time windows this week and I will prepare a concrete implementation blueprint before the call.</p>",
      "<p>— Kuze</p>",
    ].join(""),
  };
}

export async function generateAndSendFollowUp(
  sessionId: string,
  options?: { preferredVideoUrl?: string | null }
): Promise<void> {
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
  const bestRender = options?.preferredVideoUrl
    ? { finalVideoPath: options.preferredVideoUrl, renderId: "external", naturalnessScore: null }
    : await getBestCompletedRenderForSession(sessionId);
  const videoLine = bestRender
    ? `Video recap URL: ${bestRender.finalVideoPath}. Mention this as a quick replay option.`
    : "No video recap URL available. Offer a fallback to the live demo link.";
  const userPrompt = `You are Kuze. Write a follow-up email to ${name} at ${org}.
They just watched the ${productName} demo (${track.name as string}). Their engagement score was ${score}.
Score breakdown (JSON): ${JSON.stringify(breakdown ?? {})}.
Pain points: ${pain}. Modules completed: ${modulesDone}/${modulesTotal}.
${videoLine}
Personalize the email — reference what they saw, map it to their pain,
and close with a specific next step.
Return ONLY JSON: {"subject":"...","body_html":"..."} where body_html is concise HTML (p, strong, ul allowed).`;

  let systemPrompt = KUZE_SYSTEM_PROMPT(kuzeCtx);
  try {
    const persona = await getPersona(supabase, productKey);
    systemPrompt = buildKuzeFollowupSystemPrompt({ persona, kuzeContext: kuzeCtx });
  } catch (e) {
    if (!(e instanceof PersonaNotFoundError || e instanceof PersonaInactiveError)) {
      throw e;
    }
  }

  let parsed: FollowUpJson;
  try {
    const msg = await anthropic.messages.create({
      model: getAnthropicModel(),
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("Follow-up: no text from model");
    }
    parsed = JSON.parse(stripJsonFence(block.text)) as FollowUpJson;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("authentication_error") ||
      message.includes("invalid x-api-key") ||
      message.includes("rate_limit_error") ||
      message.includes("overloaded_error") ||
      message.includes("timeout") ||
      message.includes("invalid JSON")
    ) {
      parsed = buildFallbackFollowUp({
        name,
        org,
        productName,
        trackName: (track.name as string) ?? productName,
        score: Number(score),
        painPoints: (prospect.pain_points as string[] | null) ?? [],
        modulesDone,
        modulesTotal,
        videoUrl: bestRender?.finalVideoPath ?? null,
      });
    } else {
      throw error;
    }
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
    const sendErrorMessage = sendErr.message;
    await supabase.from("follow_ups").insert({
      session_id: sessionId,
      prospect_id: prospectId,
      subject: parsed.subject,
      body_html: parsed.body_html,
      error: sendErrorMessage,
    });
    await logSystemEvent({
      function_name: "send_followup",
      session_id: sessionId,
      status: "error",
      message: sendErrorMessage,
    });
    throw new Error(sendErrorMessage);
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

  await dispatchIntegrationEvent({
    tenantId: null,
    eventType: "followup.sent",
    idempotencyKey: `followup:${sessionId}`,
    body: {
      sessionId,
      prospectId,
      resendMessageId: messageId,
      subject: parsed.subject,
    },
  });
}
