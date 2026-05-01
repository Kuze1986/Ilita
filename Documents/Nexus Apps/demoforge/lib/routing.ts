import { getAnthropicClient, getAnthropicModel } from "@/lib/anthropic";
import { buildKuzeRoutingAugmentation } from "@/lib/kuze/assembly";
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

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function runFallbackRouting(input: RoutingInput): RoutingAIResult {
  const role = input.role.toLowerCase();
  const org = input.organization.toLowerCase();
  const orgType = input.orgType.toLowerCase();
  const pain = input.painPoints.join(" ").toLowerCase();
  const interest = input.productInterest.map((x) => x.toLowerCase());
  const allText = `${role} ${org} ${orgType} ${pain} ${interest.join(" ")}`;

  const pharmacySignal =
    includesAny(role, ["pharmacy director", "pharmacy manager", "clinical educator"]) ||
    orgType.includes("pharmacy") ||
    includesAny(allText, ["pharmacy", "medication safety", "technician training"]);
  if (pharmacySignal) {
    return {
      product: "meridian",
      persona: "pharmacy_director",
      reason: "Fallback routing: pharmacy role/signal matched Meridian track.",
      isQualified: true,
    };
  }

  const workforceSignal =
    includesAny(allText, [
      "workforce",
      "nonprofit",
      "onboarding",
      "compliance",
      "training throughput",
    ]) || includesAny(role, ["program manager", "workforce admin"]);
  if (workforceSignal) {
    return {
      product: "keystone",
      persona: "workforce_admin",
      reason: "Fallback routing: workforce/training operations signal matched Keystone.",
      isQualified: true,
    };
  }

  const learnerSignal =
    orgType.includes("individual") ||
    includesAny(allText, ["certification", "ptcb", "exam prep", "individual learner"]);
  if (learnerSignal) {
    return {
      product: "rxblitz",
      persona: "individual_learner",
      reason: "Fallback routing: certification or individual learner signal matched RxBlitz.",
      isQualified: true,
    };
  }

  const scriptaSignal =
    includesAny(allText, ["lms", "content", "course authoring", "training coordinator"]) ||
    includesAny(role, ["training coordinator", "learning and development", "l&d"]);
  if (scriptaSignal) {
    return {
      product: "scripta",
      persona: "training_coordinator",
      reason: "Fallback routing: LMS/content signal matched Scripta.",
      isQualified: true,
    };
  }

  const bioloopSignal = includesAny(allText, [
    "executive",
    "vp",
    "chief",
    "cio",
    "cto",
    "data",
    "ai",
    "analytics",
    "automation",
    "it evaluator",
    "systems",
  ]);
  if (bioloopSignal) {
    const persona = includesAny(role, ["it", "systems", "architect", "cio", "cto"])
      ? "it_evaluator"
      : "executive";
    return {
      product: "bioloop",
      persona,
      reason: "Fallback routing: executive/data/AI signal matched BioLoop pitch track.",
      isQualified: true,
    };
  }

  const browsingSignal = includesAny(allText, [
    "just browsing",
    "not sure",
    "exploring",
    "student project",
  ]);
  if (browsingSignal || pain.trim().length < 8) {
    return {
      product: "scripta",
      persona: "unknown",
      reason: "Fallback routing: insufficient qualification signal detected.",
      isQualified: false,
      deflectionReason:
        "Thanks for your interest. We need a clearer implementation use case before assigning a demo specialist.",
    };
  }

  // Default qualified path uses declared product interest if available.
  if (interest.includes("bioloop")) {
    return {
      product: "bioloop",
      persona: "executive",
      reason: "Fallback routing: explicit BioLoop interest.",
      isQualified: true,
    };
  }
  if (interest.includes("meridian")) {
    return {
      product: "meridian",
      persona: "pharmacy_director",
      reason: "Fallback routing: explicit Meridian interest.",
      isQualified: true,
    };
  }
  if (interest.includes("keystone")) {
    return {
      product: "keystone",
      persona: "workforce_admin",
      reason: "Fallback routing: explicit Keystone interest.",
      isQualified: true,
    };
  }
  if (interest.includes("rxblitz")) {
    return {
      product: "rxblitz",
      persona: "individual_learner",
      reason: "Fallback routing: explicit RxBlitz interest.",
      isQualified: true,
    };
  }
  return {
    product: "scripta",
    persona: "training_coordinator",
    reason: "Fallback routing: defaulted to Scripta training track.",
    isQualified: true,
  };
}

export async function runProspectRoutingAI(
  input: RoutingInput
): Promise<RoutingAIResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return runFallbackRouting(input);
  }

  try {
    const anthropic = getAnthropicClient();
    const userPayload = JSON.stringify(input);
    const msg = await anthropic.messages.create({
      model: getAnthropicModel(),
      max_tokens: 1024,
      system: `${ROUTING_SYSTEM}\n\n${buildKuzeRoutingAugmentation()}`,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("authentication_error") ||
      message.includes("invalid x-api-key") ||
      message.includes("rate_limit_error") ||
      message.includes("overloaded_error") ||
      message.includes("timeout")
    ) {
      return runFallbackRouting(input);
    }
    throw error;
  }
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
