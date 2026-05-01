"use client";

import { useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export function LiveKuzeButton({
  sessionId,
  token,
  adminMode = false,
}: {
  sessionId: string;
  token: string;
  adminMode?: boolean;
}) {
  const fired = useRef(false);

  async function logStart() {
    if (fired.current) return;
    fired.current = true;
    try {
      const res = await fetch("/api/track-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken: token,
          eventType: "kuze_live_start",
        }),
      });
      if (!res.ok) {
        fired.current = false;
      }
    } catch {
      fired.current = false;
    }
  }

  const params = new URLSearchParams({
    token,
  });
  if (adminMode) {
    params.set("admin_mode", "1");
  }
  const href = `/demo/${sessionId}/live?${params.toString()}`;

  return (
    <Link href={href} onClick={() => void logStart()}>
      <Button variant="secondary" className="w-full sm:w-auto">
        Talk to Kuze live
      </Button>
    </Link>
  );
}
