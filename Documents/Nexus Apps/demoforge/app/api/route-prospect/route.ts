import { NextResponse } from "next/server";
import { recordBehaviorSignal } from "@/lib/behavior/signals";
import { fetchCrucibleBehaviorProfile } from "@/lib/crucible/client";
import { hubspotUpsertContactStub } from "@/lib/integrations/crm/hubspot";
import { salesforceUpsertLeadStub } from "@/lib/integrations/crm/salesforce";
import { dispatchIntegrationEvent } from "@/lib/integrations/index";
import { logSystemEvent } from "@/lib/logging";
import {
  fetchTrackForProductPersona,
  runProspectRoutingAI,
  type RoutingInput,
} from "@/lib/routing";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { ProductKey } from "@/types/demo";
import type { ProspectPersona } from "@/types/demo";
import { enqueueVideoJob } from "@/lib/video/queue";
import { isVideoFeatureEnabled } from "@/lib/video/flags";
import { pickVideoVariantOrder } from "@/lib/video/variant-policy";

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
  utm?: Record<string, string>;
}

function validateBody(b: unknown): RouteProspectBody | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const strings = ["firstName", "lastName", "email", "organization", "role", "orgType"] as const;
  for (const k of strings) {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) return null;
  }
  if (!Array.isArray(o.painPoints) || !Array.isArray(o.productInterest)) return null;
  const utm =
    o.utm && typeof o.utm === "object"
      ? Object.entries(o.utm as Record<string, unknown>).reduce<Record<string, string>>(
          (acc, [key, value]) => {
            if (typeof value === "string") {
              acc[key] = value;
            }
            return acc;
          },
          {}
        )
      : undefined;
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
    utm,
  };
}

export async function POST(request: Request) {
  let parsed: RouteProspectBody | null = null;
  try {
    const json = (await request.json()) as unknown;
    parsed = validateBody(json);
    if (!parsed) {
      await logSystemEvent({
        function_name: "route_prospect",
        status: "error",
        message: "Invalid request body",
      });
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
      utm: parsed.utm ?? null,
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

    try {
      await hubspotUpsertContactStub({
        email: parsed.email,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        company: parsed.organization,
      });
      await salesforceUpsertLeadStub({
        email: parsed.email,
        company: parsed.organization,
        title: parsed.role,
      });
      await dispatchIntegrationEvent({
        tenantId: null,
        eventType: "lead.created",
        idempotencyKey: `prospect:${prospect.id as string}`,
        body: {
          prospectId: prospect.id,
          sessionId: session.id,
          email: parsed.email,
          organization: parsed.organization,
          product: ai.product,
          persona: ai.persona,
        },
      });
      const crucible = await fetchCrucibleBehaviorProfile({
        sessionId: session.id as string,
        correlationId: session.id as string,
        product: ai.product as ProductKey,
        persona: ai.persona as ProspectPersona,
      });
      await recordBehaviorSignal({
        sessionId: session.id as string,
        signalKind: "crucible.profile",
        payload: {
          profile: crucible.profile,
          source: crucible.source,
        },
      });
    } catch (syncErr) {
      await logSystemEvent({
        function_name: "route_prospect.integrations",
        session_id: session.id as string,
        status: "error",
        message: syncErr instanceof Error ? syncErr.message : String(syncErr),
      });
    }

    if (await isVideoFeatureEnabled("video_pipeline_enabled")) {
      try {
        const variants = await pickVideoVariantOrder();
        await enqueueVideoJob({
          sessionId: session.id as string,
          prospectId: prospect.id as string,
          product: ai.product as ProductKey,
          persona: ai.persona as ProspectPersona,
          triggeredBy: "intake",
          variants,
        });
      } catch (videoErr) {
        await logSystemEvent({
          function_name: "route_prospect_video_enqueue",
          session_id: session.id as string,
          status: "error",
          message: videoErr instanceof Error ? videoErr.message : String(videoErr),
        });
      }
    }

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
