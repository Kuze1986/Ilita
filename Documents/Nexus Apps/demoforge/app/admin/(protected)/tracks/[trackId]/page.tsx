import { notFound } from "next/navigation";
import { ModuleEditor } from "@/components/admin/ModuleEditor";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { DemoModuleRow, DemoTrackRow } from "@/types/demo";

export default async function TrackEditorPage({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;
  const supabase = createServiceSupabaseClient();

  const { data: track, error: tErr } = await supabase
    .from("demo_tracks")
    .select("*")
    .eq("id", trackId)
    .single();

  if (tErr || !track) {
    notFound();
  }

  const { data: modules, error: mErr } = await supabase
    .from("demo_modules")
    .select("*")
    .eq("track_id", trackId)
    .order("sequence_order", { ascending: true });

  if (mErr) {
    throw new Error(mErr.message);
  }

  const t = track as DemoTrackRow;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.name}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t.description ?? ""}
        </p>
      </div>
      <ModuleEditor
        trackId={trackId}
        modules={(modules ?? []) as DemoModuleRow[]}
      />
    </div>
  );
}
