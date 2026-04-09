"use client";

import { useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export function LiveKuzeButton({
  sessionId,
  token,
}: {
  sessionId: string;
  token: string;
}) {
  const fired = useRef(false);

  async function logStart() {
    if (fired.current) return;
    fired.current = true;
    try {
      await fetch("/api/track-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken: token,
          eventType: "kuze_live_start",
        }),
      });
    } catch {
      fired.current = false;
    }
  }

  const href = `/demo/${sessionId}/live?token=${encodeURIComponent(token)}`;

  return (
    <Link href={href} onClick={() => void logStart()}>
      <Button variant="secondary" className="w-full sm:w-auto">
        Talk to Kuze live
      </Button>
    </Link>
  );
}
