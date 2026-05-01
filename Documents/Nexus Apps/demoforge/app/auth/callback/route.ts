import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { logAuditEvent } from "@/lib/logging";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  if (code) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      return NextResponse.redirect(`${origin}/admin/login?error=config`);
    }
    const cookieStore = await cookies();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            /* ignore */
          }
        },
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        `${origin}/admin/login?error=${encodeURIComponent(error.message)}`
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const domain = user.email?.split("@")[1]?.toLowerCase() ?? "";
      const rawMap = process.env.SSO_DOMAIN_TENANT_SLUGS;
      let mappedTenant: string | null = null;
      if (rawMap && domain) {
        try {
          const map = JSON.parse(rawMap) as Record<string, string>;
          mappedTenant = map[domain] ?? null;
        } catch {
          mappedTenant = null;
        }
      }
      await logAuditEvent({
        action: "auth.login",
        resourceType: "user",
        resourceId: user.id,
        metadata: {
          email: user.email,
          provider: user.app_metadata?.provider ?? null,
          mappedTenantSlug: mappedTenant,
        },
      });
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
