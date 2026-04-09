import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DemoCompletePage({
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
    .select("id, token, engagement_score, follow_up_sent")
    .eq("id", sessionId)
    .single();

  if (error || !session || session.token !== token) {
    notFound();
  }

  const score = session.engagement_score;
  const followUp = session.follow_up_sent;

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center px-4 py-16">
      <Card className="w-full text-center">
        <h1 className="text-xl font-semibold">Demo complete</h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Thanks for walking through the NEXUS track.{" "}
          {followUp
            ? "A personalized follow-up is on the way to your inbox."
            : "Our team may follow up shortly with next steps."}
        </p>
        {score != null && (
          <p className="mt-4 text-sm">
            Engagement score:{" "}
            <span className="font-semibold tabular-nums">{Number(score)}</span>{" "}
            / 100
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href={`/demo/${sessionId}/live?token=${encodeURIComponent(token)}`}>
            <Button variant="secondary" className="w-full sm:w-auto">
              Continue with Kuze
            </Button>
          </Link>
          <Link href="/demo">
            <Button variant="ghost" className="w-full sm:w-auto">
              New intake
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
