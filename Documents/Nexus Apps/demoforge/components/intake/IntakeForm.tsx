"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  DEMO_PRODUCT_CARDS,
  ORG_TYPE_OPTIONS,
  PAIN_POINT_OPTIONS,
  ROLE_OPTIONS,
} from "@/lib/constants";
import { RoutingLoader } from "./RoutingLoader";

const STEPS = 4;

export function IntakeForm({
  initialUtm = {},
  adminMode = false,
}: {
  initialUtm?: Record<string, string>;
  adminMode?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState(ROLE_OPTIONS[0].value);
  const [orgType, setOrgType] = useState<string>(ORG_TYPE_OPTIONS[0].value);
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [productInterest, setProductInterest] = useState<string[]>([]);

  function togglePain(p: string) {
    setPainPoints((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  function toggleProduct(id: string) {
    if (id === "unsure") {
      setProductInterest(["unsure"]);
      return;
    }
    setProductInterest((prev) => {
      const without = prev.filter((x) => x !== "unsure");
      if (without.includes(id)) return without.filter((x) => x !== id);
      return [...without, id];
    });
  }

  function canNext(): boolean {
    if (step === 1) {
      return Boolean(
        firstName.trim() &&
          lastName.trim() &&
          email.trim() &&
          organization.trim()
      );
    }
    if (step === 2) return Boolean(role && orgType);
    if (step === 3) return painPoints.length > 0;
    if (step === 4) return productInterest.length > 0;
    return false;
  }

  function handleBack() {
    if (step > 1) {
      setStep((s) => Math.max(1, s - 1));
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const utm = {
        utm_source: initialUtm.utm_source ?? "",
        utm_medium: initialUtm.utm_medium ?? "",
        utm_campaign: initialUtm.utm_campaign ?? "",
        utm_term: initialUtm.utm_term ?? "",
        utm_content: initialUtm.utm_content ?? "",
      };
      const res = await fetch("/api/route-prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          organization: organization.trim(),
          role,
          orgType,
          painPoints,
          productInterest,
          utm,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        qualified?: boolean;
        reason?: string;
        sessionId?: string;
        sessionToken?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Request failed");
      }
      if (data.qualified === false) {
        setError(data.reason ?? "Thanks — we are not running a demo for this profile right now.");
        setLoading(false);
        return;
      }
      if (!data.sessionId || !data.sessionToken) {
        throw new Error("Missing session from server");
      }
      const nextParams = new URLSearchParams({
        token: data.sessionToken,
      });
      for (const [key, value] of Object.entries(utm)) {
        if (value) nextParams.set(key, value);
      }
      if (adminMode) {
        nextParams.set("admin_mode", "1");
      }
      router.push(`/demo/${data.sessionId}?${nextParams.toString()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  if (loading) {
    return <RoutingLoader />;
  }

  return (
    <Card className="mx-auto max-w-lg">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Demo intake</h1>
        <span className="text-xs text-zinc-500">
          Step {step} / {STEPS}
        </span>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">First name</label>
          <input
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
          />
          <label className="text-sm font-medium">Last name</label>
          <input
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
          />
          <label className="text-sm font-medium">Work email</label>
          <input
            type="email"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <label className="text-sm font-medium">Organization</label>
          <input
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            autoComplete="organization"
          />
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">Your role</label>
          <select
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.value}
              </option>
            ))}
          </select>
          <label className="text-sm font-medium">Organization type</label>
          <select
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            value={orgType}
            onChange={(e) => setOrgType(e.target.value)}
          >
            {ORG_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            What is your biggest challenge? (select all that apply)
          </p>
          <div className="flex flex-col gap-2">
            {PAIN_POINT_OPTIONS.map((p) => (
              <label
                key={p}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
              >
                <input
                  type="checkbox"
                  checked={painPoints.includes(p)}
                  onChange={() => togglePain(p)}
                />
                {p}
              </label>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            What are you most interested in?
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {DEMO_PRODUCT_CARDS.map((c) => {
              const selected = productInterest.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleProduct(c.id)}
                  className={`rounded-xl border p-3 text-left text-sm transition ${
                    selected
                      ? "border-foreground bg-zinc-50 dark:bg-zinc-800"
                      : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"
                  }`}
                >
                  <div className="font-semibold">{c.title}</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {c.blurb}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-between gap-2">
        <Button variant="secondary" onClick={handleBack}>
          Back
        </Button>
        {step < STEPS ? (
          <Button disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
            Next
          </Button>
        ) : (
          <Button disabled={!canNext()} onClick={submit}>
            Start demo
          </Button>
        )}
      </div>
    </Card>
  );
}
