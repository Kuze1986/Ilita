import Link from "next/link";
import { IntakeForm } from "@/components/intake/IntakeForm";

export default async function DemoIntakePage({
  searchParams,
}: {
  searchParams: Promise<{
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
    admin_mode?: string;
  }>;
}) {
  const {
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    admin_mode,
  } =
    await searchParams;
  const initialUtm = {
    ...(utm_source ? { utm_source } : {}),
    ...(utm_medium ? { utm_medium } : {}),
    ...(utm_campaign ? { utm_campaign } : {}),
    ...(utm_term ? { utm_term } : {}),
    ...(utm_content ? { utm_content } : {}),
  };
  const isAdminMode = admin_mode === "1";

  return (
    <div className="flex min-h-full flex-col items-center px-4 py-12">
      {isAdminMode && (
        <div className="mb-4 w-full max-w-lg">
          <Link href="/admin" className="text-sm text-[color:var(--accent)] hover:underline">
            ← Back to admin mode
          </Link>
        </div>
      )}
      <div className="mb-6 text-center">
        <p className="text-xs uppercase tracking-[0.24em] soft-muted">Kuze Guided Demo</p>
        <h1 className="text-3xl font-semibold">Build your personalized walkthrough</h1>
      </div>
      <IntakeForm initialUtm={initialUtm} adminMode={isAdminMode} />
    </div>
  );
}
