import { NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/logging";
import {
  fetchTrackForProductPersona,
  runProspectRoutingAI,
  type RoutingInput,
} from "@/lib/routing";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductKey } from "@/types/demo";
import type { ProspectPersona } from "@/types/demo";

const VALID_PRODUCT_KEYS: ProductKey[] = [
  "keystone",
  "meridian",
  "scripta",
  "rxblitz",
  "bioloop",
];

function normalizeProductInterest(raw: string[]): ProductKey[] {
  const out: ProductKey[] = [];
  for (const x of raw) {
    if (VALID_PRODUCT_KEYS.includes(x as ProductKey)) {
      out.push(x as ProductKey);
    }
  }
  return out;
}

export const runtime = "nodejs";

interface RouteProspectBody extends RoutingInput {
  firstName: string;
  lastName: string;
  email: string;
  organization: string;
}

function validateBody(b: unknown): RouteProspectBody | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const strings = ["firstName", "lastName", "email", "organization", "role", "orgType"] as const;
  for (const k of strings) {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) return null;
  }
  if (!Array.isArray(o.painPoints) || !Array.isArray(o.productInterest)) return null;
  return {
    firstName: o.firstName as string,
    lastName: o.lastName as string,
    email: o.email as string,
    organization: o.organization as string,
    role: o.role as string,
    orgType: o.orgType as string,
    painPoints: o.painPoints as string[],
    productInterest: o.productInterest as string[],
    employeeCount:
      typeof o.employeeCount === "string" ? o.employeeCount : undefined,
  };
}

export async function POST(request: Request) {
  let parsed: RouteProspectBody | null = null;
  try {
    const json = (await request.json()) as unknown;
    parsed = validateBody(json);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const routingInput: RoutingInput = {
      role: parsed.role,
      organization: parsed.organization,
      orgType: parsed.orgType,
      painPoints: parsed.painPoints,
      productInterest: parsed.productInterest,
      employeeCount: parsed.employeeCount,
    };

    const ai = await runProspectRoutingAI(routingInput);
    const supabase = createServiceSupabaseClient();

    const intakeRaw = {
      ...routingInput,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      email: parsed.email,
      organization: parsed.organization,
    };

    const { data: prospect, error: pErr } = await supabase
      .from("prospects")
      .insert({
        first_name: parsed.firstName,
        last_name: parsed.lastName,
        email: parsed.email.toLowerCase().trim(),
        organization: parsed.organization,
        role: parsed.role,
        persona: ai.persona as ProspectPersona,
        pain_points: parsed.painPoints,
        product_interest: normalizeProductInterest(parsed.productInterest),
        intake_raw: intakeRaw as unknown as Record<string, unknown>,
        routing_reason: ai.reason,
        is_qualified: ai.isQualified,
        deflection_reason: ai.deflectionReason ?? null,
      })
      .select("id")
      .single();

    if (pErr || !prospect) {
      throw new Error(pErr?.message ?? "Failed to insert prospect");
    }

    if (!ai.isQualified) {
      await logSystemEvent({
        function_name: "route_prospect",
        status: "success",
        message: "Prospect deflected",
        payload: {
          prospectId: prospect.id,
          deflectionReason: ai.deflectionReason,
        },
      });
      return NextResponse.json({
        qualified: false,
        reason: ai.deflectionReason ?? "Not a fit right now.",
        prospectId: prospect.id,
      });
    }

    const track = await fetchTrackForProductPersona(
      supabase,
      ai.product,
      ai.persona
    );
    if (!track) {
      throw new Error(
        `No active demo track for product=${ai.product} persona=${ai.persona}`
      );
    }

    const { data: modules, error: mErr } = await supabase
      .from("demo_modules")
      .select("id")
      .eq("track_id", track.id)
      .order("sequence_order", { ascending: true });
    if (mErr) {
      throw new Error(mErr.message);
    }
    const moduleList = modules ?? [];
    const modulesTotal = moduleList.length;
    const firstModuleId = moduleList[0]?.id ?? null;

    const { data: session, error: sErr } = await supabase
      .from("demo_sessions")
      .insert({
        prospect_id: prospect.id,
        track_id: track.id,
        status: "started",
        current_module_id: firstModuleId,
        modules_completed: 0,
        modules_total: modulesTotal,
      })
      .select("id, token")
      .single();

    if (sErr || !session?.token) {
      throw new Error(sErr?.message ?? "Failed to create session");
    }

    await logSystemEvent({
      function_name: "route_prospect",
      session_id: session.id as string,
      status: "success",
      message: "Session created",
      payload: {
        product: ai.product,
        persona: ai.persona,
        trackId: track.id,
      },
    });

    return NextResponse.json({
      qualified: true,
      sessionId: session.id,
      sessionToken: session.token,
      trackName: track.name,
      product: ai.product,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await logSystemEvent({
      function_name: "route_prospect",
      status: "error",
      message,
      payload: parsed ? { email: parsed.email } : null,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
