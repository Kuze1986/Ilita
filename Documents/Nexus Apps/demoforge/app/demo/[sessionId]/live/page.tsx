import Link from "next/link";
import { notFound } from "next/navigation";
import { KuzeChatPanel } from "@/components/kuze/KuzeChatPanel";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function KuzeLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ token?: string; admin_mode?: string }>;
}) {
  const { sessionId } = await params;
  const { token, admin_mode } = await searchParams;
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

  const isAdminMode = admin_mode === "1";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {isAdminMode && (
        <div className="mb-4">
          <Link href="/admin" className="text-sm text-[color:var(--accent)] hover:underline">
            ← Back to admin mode
          </Link>
        </div>
      )}
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.22em] soft-muted">Live AI Session</p>
        <h1 className="text-2xl font-semibold">Kuze Co-Pilot</h1>
      </div>
      <KuzeChatPanel sessionToken={token} />
    </div>
  );
}
