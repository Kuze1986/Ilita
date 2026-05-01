import { notFound } from "next/navigation";
import { JourneyBuilder } from "@/components/admin/JourneyBuilder";
import { ModuleEditor } from "@/components/admin/ModuleEditor";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DemoModuleRow, DemoTrackRow } from "@/types/demo";
import type { JourneyEdgeRow, JourneyNodeRow } from "@/types/journey";

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

  const { data: journeyNodes } = await supabase
    .from("journey_nodes")
    .select("*")
    .eq("track_id", trackId)
    .order("created_at", { ascending: true });

  const { data: journeyEdges } = await supabase
    .from("journey_edges")
    .select("*")
    .eq("track_id", trackId)
    .order("priority", { ascending: true });

  const t = track as DemoTrackRow;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.name}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t.description ?? ""}
        </p>
      </div>
      <JourneyBuilder
        trackId={trackId}
        entryNodeId={(t.entry_node_id as string | null) ?? null}
        modules={(modules ?? []) as DemoModuleRow[]}
        nodes={(journeyNodes ?? []) as JourneyNodeRow[]}
        edges={(journeyEdges ?? []) as JourneyEdgeRow[]}
      />
      <ModuleEditor
        trackId={trackId}
        modules={(modules ?? []) as DemoModuleRow[]}
      />
    </div>
  );
}
