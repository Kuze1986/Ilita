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
    <Card className="flex h-[min(640px,80vh)] flex-col">
      <div className="mb-3 flex items-center gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        <KuzeAvatar size={40} />
        <div>
          <p className="text-sm font-semibold">Kuze</p>
          <p className="text-xs text-zinc-500">NEXUS Holdings</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto py-2">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Ask anything about the demo, products, or your use case.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {m.role === "assistant" && <KuzeAvatar size={32} />}
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-foreground text-background"
                  : "bg-zinc-100 text-foreground dark:bg-zinc-800"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {streaming &&
          messages[messages.length - 1]?.role === "assistant" &&
          messages[messages.length - 1]?.content === "" && (
            <div className="flex items-center gap-2 text-zinc-500">
              <LoadingSpinner className="h-5 w-5" />
              <span className="text-xs">Kuze is thinking…</span>
            </div>
          )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="mt-2 flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
        <input
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
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
        <Button disabled={streaming || !input.trim()} onClick={() => void send()}>
          Send
        </Button>
      </div>
    </Card>
  );
}
