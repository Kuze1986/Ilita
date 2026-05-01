import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminActor } from "@/lib/governance/requireAdmin";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getAdminActor();
  if (!actor) {
    redirect("/admin/login?error=forbidden");
  }

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="glass border-r border-[color:var(--panel-border)] p-4 lg:min-h-screen">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.24em] soft-muted">DemoForge</p>
          <h1 className="mt-1 text-xl font-semibold">Control Nexus</h1>
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          <Link
            href="/admin"
            className="rounded-xl px-3 py-2 text-foreground hover:bg-[rgba(44,247,223,0.12)]"
          >
            Dashboard
          </Link>
          <Link
            href="/admin/tracks"
            className="rounded-xl px-3 py-2 text-foreground hover:bg-[rgba(44,247,223,0.12)]"
          >
            Tracks
          </Link>
          <Link
            href="/admin/tracks/templates"
            className="rounded-xl px-3 py-2 text-foreground hover:bg-[rgba(44,247,223,0.12)]"
          >
            Journey templates
          </Link>
          <Link
            href="/admin/leads"
            className="rounded-xl px-3 py-2 text-foreground hover:bg-[rgba(44,247,223,0.12)]"
          >
            Leads
          </Link>
          <Link
            href="/admin/videos"
            className="rounded-xl px-3 py-2 text-foreground hover:bg-[rgba(44,247,223,0.12)]"
          >
            Video Ops
          </Link>
          <Link
            href="/admin/control-plane"
            className="rounded-xl px-3 py-2 text-foreground hover:bg-[rgba(44,247,223,0.12)]"
          >
            Control plane
          </Link>
          <Link
            href="/admin/integrations"
            className="rounded-xl px-3 py-2 text-foreground hover:bg-[rgba(44,247,223,0.12)]"
          >
            Integrations
          </Link>
          <Link
            href="/demo?admin_mode=1"
            className="rounded-xl px-3 py-2 text-foreground hover:bg-[rgba(44,247,223,0.12)]"
          >
            Switch to client mode
          </Link>
        </nav>
      </aside>
      <section className="px-4 py-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] soft-muted">Admin Workspace</p>
            <p className="text-lg font-semibold">Operational dashboard</p>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm">
            <Link
              href="/admin"
              className="glass rounded-xl px-3 py-2 hover:bg-[rgba(44,247,223,0.12)]"
            >
              Dashboard
            </Link>
            <Link
              href="/admin/tracks"
              className="glass rounded-xl px-3 py-2 hover:bg-[rgba(44,247,223,0.12)]"
            >
              Tracks
            </Link>
            <Link
              href="/admin/leads"
              className="glass rounded-xl px-3 py-2 hover:bg-[rgba(44,247,223,0.12)]"
            >
              Leads
            </Link>
            <Link
              href="/demo?admin_mode=1"
              className="rounded-xl border border-[color:var(--accent)]/40 bg-[rgba(44,247,223,0.12)] px-3 py-2 text-[color:var(--accent)]"
            >
              Client mode
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-7xl">{children}</main>
      </section>
    </div>
  );
}
