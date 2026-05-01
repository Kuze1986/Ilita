import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoPlayer } from "@/components/player/DemoPlayer";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DemoModuleRow } from "@/types/demo";
import type { JourneyEdgeRow, JourneyNodeRow } from "@/types/journey";

export const dynamic = "force-dynamic";

export default async function DemoSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{
    token?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
    admin_mode?: string;
  }>;
}) {
  const { sessionId } = await params;
  const {
    token,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    admin_mode,
  } = await searchParams;
  if (!token) {
    notFound();
  }

  const supabase = createServiceSupabaseClient();
  const { data: session, error } = await supabase
    .from("demo_sessions")
    .select("id, token, modules_completed, modules_total, current_module_id, track_id")
    .eq("id", sessionId)
    .single();

  if (error || !session || session.token !== token) {
    notFound();
  }

  const { data: track, error: tErr } = await supabase
    .from("demo_tracks")
    .select("name, entry_node_id")
    .eq("id", session.track_id as string)
    .single();

  if (tErr || !track) {
    notFound();
  }

  const { data: modules, error: mErr } = await supabase
    .from("demo_modules")
    .select("*")
    .eq("track_id", session.track_id as string)
    .order("sequence_order", { ascending: true });

  if (mErr) {
    notFound();
  }

  const { data: journeyNodes } = await supabase
    .from("journey_nodes")
    .select("*")
    .eq("track_id", session.track_id as string);

  const { data: journeyEdges } = await supabase
    .from("journey_edges")
    .select("*")
    .eq("track_id", session.track_id as string)
    .order("priority", { ascending: true });

  const journey =
    journeyNodes && journeyEdges
      ? {
          entryNodeId: (track.entry_node_id as string | null) ?? null,
          nodes: journeyNodes as JourneyNodeRow[],
          edges: journeyEdges as JourneyEdgeRow[],
        }
      : null;

  const attribution = {
    ...(utm_source ? { utm_source } : {}),
    ...(utm_medium ? { utm_medium } : {}),
    ...(utm_campaign ? { utm_campaign } : {}),
    ...(utm_term ? { utm_term } : {}),
    ...(utm_content ? { utm_content } : {}),
  };
  const isAdminMode = admin_mode === "1";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {isAdminMode && (
        <div className="mb-4">
          <Link href="/admin" className="text-sm text-[color:var(--accent)] hover:underline">
            ← Back to admin mode
          </Link>
        </div>
      )}
      <DemoPlayer
        sessionId={session.id as string}
        token={token}
        trackName={(track.name as string) ?? "Demo"}
        modules={(modules ?? []) as DemoModuleRow[]}
        initialSession={{
          modules_completed: session.modules_completed ?? 0,
          modules_total: session.modules_total ?? 0,
          current_module_id: session.current_module_id as string | null,
        }}
        journey={journey}
        attribution={Object.keys(attribution).length > 0 ? attribution : null}
        adminMode={isAdminMode}
      />
    </div>
  );
}
