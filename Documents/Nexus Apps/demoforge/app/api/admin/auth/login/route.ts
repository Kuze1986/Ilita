import { createServerClient } from "@supabase/ssr";
import { createServiceSupabaseClientPublicSchema } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";

function safeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      // still compare to avoid leaking length
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    return NextResponse.json(
      { error: "Admin credentials not configured on server" },
      { status: 500 }
    );
  }

  let email: string;
  let password: string;
  try {
    const body = await req.json();
    email = String(body.email ?? "").trim().toLowerCase();
    password = String(body.password ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const emailMatch = safeEqual(email, adminEmail.trim().toLowerCase());
  const passwordMatch = safeEqual(password, adminPassword);

  if (!emailMatch || !passwordMatch) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const svc = createServiceSupabaseClientPublicSchema();

  // Find the admin Supabase user by email
  const { data: listData, error: listError } = await svc.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) {
    return NextResponse.json(
      { error: "Failed to look up admin user" },
      { status: 500 }
    );
  }

  const adminUser = listData.users.find(
    (u) => u.email?.toLowerCase() === adminEmail.trim().toLowerCase()
  );
  if (!adminUser) {
    return NextResponse.json(
      {
        error:
          "Admin user not found in Supabase — create a user matching ADMIN_EMAIL first",
      },
      { status: 404 }
    );
  }

  // Create a session without requiring the Supabase password
  const { data: sessionData, error: sessionError } =
    await svc.auth.admin.createSession({ user_id: adminUser.id });
  if (sessionError || !sessionData?.session) {
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }

  const response = NextResponse.json({ ok: true });

  // Persist the session in the standard Supabase SSR cookies
  const cookieClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  await cookieClient.auth.setSession({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  });

  return response;
}
