"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/governance/requireAdmin";
import {
  createServiceSupabaseClient,
} from "@/lib/supabase/server";
import type { ModuleType } from "@/types/demo";

export async function createModule(trackId: string) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { data: last } = await supabase
    .from("demo_modules")
    .select("sequence_order")
    .eq("track_id", trackId)
    .order("sequence_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (last?.sequence_order as number | undefined) ?? -1;
  const { error } = await supabase.from("demo_modules").insert({
    track_id: trackId,
    sequence_order: nextOrder + 1,
    title: "New module",
    module_type: "narration_card" as ModuleType,
    narration_script: "Add narration or configure another module type.",
    is_skippable: true,
    duration_seconds: 60,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/tracks/${trackId}`);
}

export async function createCrucibleCompareModule(trackId: string) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { data: last } = await supabase
    .from("demo_modules")
    .select("sequence_order")
    .eq("track_id", trackId)
    .order("sequence_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (last?.sequence_order as number | undefined) ?? -1;
  const baseUrl = process.env.CRUCIBLE_SIM_BASE_URL ?? "";
  const compareUrl = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/compare?ids=&embed=1`
    : null;
  const { error } = await supabase.from("demo_modules").insert({
    track_id: trackId,
    sequence_order: nextOrder + 1,
    title: "Crucible comparison",
    module_type: "iframe" as ModuleType,
    content_url: compareUrl,
    interaction_config: {
      provider: "crucible",
      mode: "compare",
      base_url: baseUrl,
      selected_run_ids: [],
      available_runs: [],
    },
    narration_script: "Compare up to four Crucible runs side by side.",
    is_skippable: true,
    duration_seconds: 90,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/tracks/${trackId}`);
}

export async function updateModule(
  id: string,
  trackId: string,
  fields: {
    title?: string;
    module_type?: ModuleType;
    content_url?: string | null;
    narration_script?: string | null;
    duration_seconds?: number | null;
    is_skippable?: boolean;
    interaction_config?: Record<string, unknown> | null;
  }
) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("demo_modules")
    .update(fields)
    .eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/tracks/${trackId}`);
}

export async function deleteModule(id: string, trackId: string) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("demo_modules").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/tracks/${trackId}`);
}

export async function reorderModule(
  id: string,
  trackId: string,
  direction: "up" | "down"
) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { data: all, error: lErr } = await supabase
    .from("demo_modules")
    .select("id, sequence_order")
    .eq("track_id", trackId)
    .order("sequence_order", { ascending: true });
  if (lErr || !all) {
    throw new Error(lErr?.message ?? "Load failed");
  }
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) {
    throw new Error("Module not found");
  }
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= all.length) {
    return;
  }
  const a = all[idx];
  const b = all[swapWith];
  const { error: e1 } = await supabase
    .from("demo_modules")
    .update({ sequence_order: b.sequence_order as number })
    .eq("id", a.id as string);
  if (e1) {
    throw new Error(e1.message);
  }
  const { error: e2 } = await supabase
    .from("demo_modules")
    .update({ sequence_order: a.sequence_order as number })
    .eq("id", b.id as string);
  if (e2) {
    throw new Error(e2.message);
  }
  revalidatePath(`/admin/tracks/${trackId}`);
}

export async function setTrackEntryNode(trackId: string, entryNodeId: string | null) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("demo_tracks")
    .update({ entry_node_id: entryNodeId })
    .eq("id", trackId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/tracks/${trackId}`);
}

export async function createJourneyNode(trackId: string, moduleId: string | null) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("journey_nodes")
    .insert({
      track_id: trackId,
      module_id: moduleId,
      node_type: "module",
      label: moduleId ? "Module node" : "Unassigned node",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create journey node");
  }
  revalidatePath(`/admin/tracks/${trackId}`);
  return data.id as string;
}

export async function deleteJourneyNode(nodeId: string, trackId: string) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { error: e0 } = await supabase
    .from("journey_edges")
    .delete()
    .or(`from_node_id.eq.${nodeId},to_node_id.eq.${nodeId}`);
  if (e0) {
    throw new Error(e0.message);
  }
  const { error } = await supabase.from("journey_nodes").delete().eq("id", nodeId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/tracks/${trackId}`);
}

export async function createJourneyEdge(
  trackId: string,
  fromNodeId: string,
  toNodeId: string,
  priority: number,
  condition: Record<string, unknown> | null
) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("journey_edges").insert({
    track_id: trackId,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    priority,
    condition,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/tracks/${trackId}`);
}

export async function deleteJourneyEdge(edgeId: string, trackId: string) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("journey_edges").delete().eq("id", edgeId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/tracks/${trackId}`);
}

export async function registerIntegrationEndpoint(input: {
  name: string;
  url: string;
  tenantId?: string | null;
  eventFilter: string[];
  secret?: string | null;
}) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("integration_endpoints").insert({
    tenant_id: input.tenantId ?? null,
    name: input.name,
    url: input.url,
    secret: input.secret ?? null,
    event_filter: input.eventFilter,
    enabled: true,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/admin/integrations");
}

export async function createJourneyTemplate(input: {
  tenantId?: string | null;
  name: string;
  description?: string | null;
}) {
  await requireAdmin();
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("journey_templates").insert({
    tenant_id: input.tenantId ?? null,
    name: input.name,
    description: input.description ?? null,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/admin/tracks/templates");
}
