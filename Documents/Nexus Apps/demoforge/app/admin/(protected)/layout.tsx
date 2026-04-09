import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && user.email !== adminEmail) {
    redirect("/admin/login?error=forbidden");
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/admin" className="font-semibold">
            DemoForge admin
          </Link>
          <nav className="flex flex-wrap gap-3 text-sm">
            <Link
              href="/admin"
              className="text-zinc-600 hover:text-foreground dark:text-zinc-400"
            >
              Dashboard
            </Link>
            <Link
              href="/admin/tracks"
              className="text-zinc-600 hover:text-foreground dark:text-zinc-400"
            >
              Tracks
            </Link>
            <Link
              href="/admin/leads"
              className="text-zinc-600 hover:text-foreground dark:text-zinc-400"
            >
              Leads
            </Link>
            <Link
              href="/demo"
              className="text-zinc-600 hover:text-foreground dark:text-zinc-400"
            >
              Public demo
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
