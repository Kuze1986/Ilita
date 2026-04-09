import { notFound } from "next/navigation";
import { DemoPlayer } from "@/components/player/DemoPlayer";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { DemoModuleRow } from "@/types/demo";

export const dynamic = "force-dynamic";

export default async function DemoSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { sessionId } = await params;
  const { token } = await searchParams;
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
    .select("name")
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

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
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
      />
    </div>
  );
}
