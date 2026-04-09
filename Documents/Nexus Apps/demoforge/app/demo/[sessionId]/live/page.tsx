import { notFound } from "next/navigation";
import { KuzeChatPanel } from "@/components/kuze/KuzeChatPanel";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function KuzeLivePage({
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
    .select("id, token")
    .eq("id", sessionId)
    .single();

  if (error || !session || session.token !== token) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <KuzeChatPanel sessionToken={token} />
    </div>
  );
}
