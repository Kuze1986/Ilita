import { getAnthropicClient, getAnthropicModel } from "@/lib/anthropic";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductKey } from "@/types/demo";
import type { ProspectPersona } from "@/types/demo";

export interface RoutingInput {
  role: string;
  organization: string;
  orgType: string;
  painPoints: string[];
  productInterest: string[];
  employeeCount?: string;
}

export interface RoutingAIResult {
  product: ProductKey;
  persona: ProspectPersona;
  reason: string;
  isQualified: boolean;
  deflectionReason?: string;
}

export function stripJsonFence(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t
      .replace(/^```(?:json)?\s*/i, "")
      .replace(new RegExp("\\s*```$", "s"), "")
      .trim();
  }
  return t;
}

const ROUTING_SYSTEM = `You are a strict routing engine for NEXUS Holdings product demos.
Return ONLY a JSON object (no markdown) with keys:
product (string enum: keystone | meridian | scripta | rxblitz | bioloop),
persona (string enum: workforce_admin | pharmacy_director | training_coordinator | individual_learner | executive | it_evaluator | unknown),
reason (short string),
isQualified (boolean),
deflectionReason (string, only if isQualified is false).

Rules:
- Pharmacy director role or pharmacy_chain org + pharmacy/training pain → meridian + pharmacy_director
- Workforce nonprofit/admin + scaling/onboarding/compliance pain → keystone + workforce_admin
- Individual learner + certification pass rates → rxblitz + individual_learner
- LMS/content modernization / training coordinator role → scripta + training_coordinator
- Executive/VP or IT evaluator + data/AI/automation → bioloop + executive (use it_evaluator only if role is clearly IT/systems)
- Unqualified: no budget/org signal, vague "just browsing", no real pain → isQualified false with deflectionReason

If multiple apply, pick the strongest single product/persona pair.`;

export async function runProspectRoutingAI(
  input: RoutingInput
): Promise<RoutingAIResult> {
  const anthropic = getAnthropicClient();
  const userPayload = JSON.stringify(input);
  const msg = await anthropic.messages.create({
    model: getAnthropicModel(),
    max_tokens: 1024,
    system: ROUTING_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Route this prospect (JSON):\n${userPayload}`,
      },
    ],
  });
  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Anthropic routing: no text response");
  }
  const raw = stripJsonFence(block.text);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Anthropic routing: invalid JSON");
  }
  const product = parsed.product as ProductKey;
  const persona = parsed.persona as ProspectPersona;
  const reason = String(parsed.reason ?? "");
  const isQualified = Boolean(parsed.isQualified);
  const deflectionReason =
    parsed.deflectionReason != null
      ? String(parsed.deflectionReason)
      : undefined;
  const validProducts: ProductKey[] = [
    "keystone",
    "meridian",
    "scripta",
    "rxblitz",
    "bioloop",
  ];
  const validPersonas: ProspectPersona[] = [
    "workforce_admin",
    "pharmacy_director",
    "training_coordinator",
    "individual_learner",
    "executive",
    "it_evaluator",
    "unknown",
  ];
  if (!validProducts.includes(product)) {
    throw new Error(`Invalid routed product: ${String(parsed.product)}`);
  }
  if (!validPersonas.includes(persona)) {
    throw new Error(`Invalid routed persona: ${String(parsed.persona)}`);
  }
  return {
    product,
    persona,
    reason,
    isQualified,
    deflectionReason,
  };
}

export async function fetchTrackForProductPersona(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  product: ProductKey,
  persona: ProspectPersona
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase
    .from("demo_tracks")
    .select("id, name")
    .eq("product", product)
    .eq("persona", persona)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  return { id: data.id as string, name: data.name as string };
}
