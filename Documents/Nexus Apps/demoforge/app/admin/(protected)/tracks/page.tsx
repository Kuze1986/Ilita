import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PRODUCT_LABELS } from "@/lib/constants";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { DemoTrackRow, ProductKey } from "@/types/demo";

export default async function TracksPage() {
  const supabase = createServiceSupabaseClient();
  const { data: tracks, error } = await supabase
    .from("demo_tracks")
    .select("*")
    .order("product", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const list = (tracks ?? []) as DemoTrackRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] soft-muted">Tracks & Personas</p>
        <h1 className="text-2xl font-semibold">Demo tracks</h1>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((t) => (
          <Link key={t.id} href={`/admin/tracks/${t.id}`}>
            <Card className="metric-gradient h-full transition hover:bg-[rgba(44,247,223,0.1)]">
              <p className="text-xs font-medium uppercase soft-muted">
                {PRODUCT_LABELS[t.product as ProductKey] ?? t.product}
              </p>
              <h2 className="mt-1 font-semibold">{t.name}</h2>
              <p className="mt-2 text-sm soft-muted">
                {t.description ?? "—"}
              </p>
              <p className="mt-2 text-xs soft-muted">
                Persona: {t.persona} ·{" "}
                {t.is_active ? "Active" : "Inactive"}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
