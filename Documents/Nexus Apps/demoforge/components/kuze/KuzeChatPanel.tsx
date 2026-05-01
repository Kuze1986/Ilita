"use client";

import { useCallback, useRef, useState } from "react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { KuzeAvatar } from "./KuzeAvatar";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export function KuzeChatPanel({ sessionToken }: { sessionToken: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollDown = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setStreaming(true);
    scrollDown();

    const history: MessageParam[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      const res = await fetch("/api/kuze-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken,
          message: text,
          conversationHistory: history,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Chat request failed");
      }
      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let assistant = "";

      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload) as { text?: string };
            if (j.text) {
              assistant += j.text;
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  copy[copy.length - 1] = {
                    role: "assistant",
                    content: assistant,
                  };
                }
                return copy;
              });
              scrollDown();
            }
          } catch {
            /* ignore parse errors for partial lines */
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
      setMessages((m) => {
        if (m[m.length - 1]?.role === "assistant" && m[m.length - 1].content === "")
          return m.slice(0, -1);
        return m;
      });
    } finally {
      setStreaming(false);
      scrollDown();
    }
  }, [input, messages, scrollDown, sessionToken, streaming]);

  return (
    <Card className="flex h-[min(560px,86vh)] flex-col p-3 sm:h-[min(620px,84vh)] sm:p-4 md:h-[min(680px,82vh)]">
      <div className="mb-3 flex items-center gap-2 border-b border-[color:var(--panel-border)] pb-3">
        <span className="block sm:hidden">
          <KuzeAvatar size={32} />
        </span>
        <span className="hidden sm:block">
          <KuzeAvatar size={40} />
        </span>
        <div>
          <p className="text-sm font-semibold">Kuze</p>
          <p className="text-[11px] soft-muted sm:text-xs">NEXUS Holdings</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto py-2">
        {messages.length === 0 && (
          <p className="text-sm soft-muted">
            Ask anything about the demo, products, or your use case.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {m.role === "assistant" && (
              <>
                <span className="block sm:hidden">
                  <KuzeAvatar size={24} />
                </span>
                <span className="hidden sm:block">
                  <KuzeAvatar size={32} />
                </span>
              </>
            )}
            <div
              className={`max-w-[90%] rounded-xl px-3 py-2 text-sm sm:max-w-[85%] ${
                m.role === "user"
                  ? "bg-[color:var(--accent)] text-[#031218]"
                  : "bg-[rgba(255,255,255,0.08)] text-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {streaming &&
          messages[messages.length - 1]?.role === "assistant" &&
          messages[messages.length - 1]?.content === "" && (
            <div className="flex items-center gap-2 soft-muted">
              <LoadingSpinner className="h-5 w-5" />
              <span className="text-xs">Kuze is thinking…</span>
            </div>
          )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="mb-2 text-sm text-[color:var(--danger)]">{error}</p>
      )}

      <div className="mt-2 flex flex-col gap-2 border-t border-[color:var(--panel-border)] pt-3 sm:flex-row">
        <input
          className="min-w-0 flex-1 rounded-xl border border-[color:var(--panel-border)] bg-black/20 px-3 py-2 text-base outline-none focus:border-[color:var(--accent)] sm:text-sm"
          placeholder="Message Kuze…"
          value={input}
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          className="w-full sm:w-auto"
          disabled={streaming || !input.trim()}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </Card>
  );
}
