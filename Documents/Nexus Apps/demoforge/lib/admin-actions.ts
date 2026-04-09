"use server";

import { revalidatePath } from "next/cache";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient,
} from "@/lib/supabase/server";
import type { ModuleType } from "@/types/demo";

async function requireAdmin() {
  const s = await createServerSupabaseClient();
  const {
    data: { user },
  } = await s.auth.getUser();
  const admin = process.env.ADMIN_EMAIL;
  if (!user?.email || !admin || user.email !== admin) {
    throw new Error("Unauthorized");
  }
}

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
