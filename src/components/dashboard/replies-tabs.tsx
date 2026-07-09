"use client";

import { useId, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, CornerDownLeft, MailOpen, MessageSquare, Send, X } from "lucide-react";

import { REPLY_BUCKETS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { OutreachThread, ReplyBucket } from "@/lib/types";

interface RepliesTabsProps {
  threads: OutreachThread[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function RepliesTabs({ threads }: RepliesTabsProps) {
  const [activeTab, setActiveTab] = useState<ReplyBucket>("yes");
  const [chatThread, setChatThread] = useState<OutreachThread | null>(null);
  const tabsetId = useId();

  return (
    <div className="relative flex gap-6">
      <div className={cn("min-w-0 flex-1 space-y-5", chatThread && "lg:max-w-[calc(100%-420px)]")}>
        <div
          aria-label="Reply buckets"
          className="grid grid-cols-2 gap-2 rounded-2xl bg-[color:var(--panel-muted)] p-1.5 sm:grid-cols-4"
          role="tablist"
        >
          {REPLY_BUCKETS.map((bucket) => {
            const count = threads.filter((thread) => thread.bucket === bucket.id).length;
            const selected = bucket.id === activeTab;

            return (
              <button
                key={bucket.id}
                className={cn(
                  "rounded-xl px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]",
                  selected
                    ? "bg-[color:var(--panel)] text-[color:var(--ink)] shadow-sm"
                    : "text-[color:var(--muted-ink)] hover:bg-white/60 hover:text-[color:var(--ink)]",
                )}
                aria-controls={`${tabsetId}-${bucket.id}`}
                aria-selected={selected}
                id={`${tabsetId}-${bucket.id}-tab`}
                onClick={() => setActiveTab(bucket.id)}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <span className="block text-[11px] font-semibold uppercase tracking-[0.18em]">
                  {bucket.label}
                </span>
                <span className="mt-1 block text-xl font-semibold">{count}</span>
              </button>
            );
          })}
        </div>

        {REPLY_BUCKETS.map((bucket) => {
          const bucketThreads = threads.filter((thread) => thread.bucket === bucket.id);
          const selected = bucket.id === activeTab;

          return (
            <div
              key={bucket.id}
              aria-labelledby={`${tabsetId}-${bucket.id}-tab`}
              className={selected ? "block" : "hidden"}
              id={`${tabsetId}-${bucket.id}`}
              role="tabpanel"
            >
              <div className="space-y-3">
                {bucketThreads.length ? (
                  bucketThreads.map((thread) =>
                    bucket.id === "needs_reply" ? (
                      <article
                        key={thread.id}
                        className="rounded-2xl border border-black/5 bg-[color:var(--panel-muted)] p-4"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[color:var(--ink)]">
                              {thread.companyName}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-[color:var(--muted-ink)]">
                              {thread.subject}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-[color:var(--muted-ink)]">
                            {thread.sentAt
                              ? formatDistanceToNow(new Date(thread.sentAt), { addSuffix: true })
                              : "—"}
                          </span>
                        </div>
                      </article>
                    ) : (
                      <article
                        key={thread.id}
                        className={cn(
                          "rounded-2xl border bg-[color:var(--panel-muted)] p-4 transition",
                          chatThread?.id === thread.id
                            ? "border-[color:var(--accent-strong)]"
                            : "border-black/5",
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-[color:var(--ink)]">
                              {thread.companyName}
                            </p>
                            <p className="mt-1 text-sm text-[color:var(--muted-ink)]">
                              {thread.subject}
                            </p>
                          </div>
                          {thread.needsAttention ? (
                            <span className="rounded-full bg-[color:var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-strong)]">
                              Needs you
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-4 text-sm leading-6 text-[color:var(--muted-ink)]">
                          {thread.lastReplySummary}
                        </p>

                        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[color:var(--muted-ink)]">
                          <span className="inline-flex items-center gap-1.5">
                            <CornerDownLeft className="h-3.5 w-3.5" />
                            {thread.outcomeLabel}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <MailOpen className="h-3.5 w-3.5" />
                            {formatDistanceToNow(new Date(thread.lastMessageAt), {
                              addSuffix: true,
                            })}
                          </span>
                          {thread.gmailThreadUrl ? (
                            <a
                              className="inline-flex items-center gap-1.5 font-medium text-[color:var(--accent-strong)] transition hover:text-[color:var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
                              href={thread.gmailThreadUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open thread
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                          <button
                            className={cn(
                              "inline-flex items-center gap-1.5 font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]",
                              chatThread?.id === thread.id
                                ? "text-[color:var(--accent-strong)]"
                                : "text-[color:var(--muted-ink)] hover:text-[color:var(--ink)]",
                            )}
                            onClick={() =>
                              setChatThread(chatThread?.id === thread.id ? null : thread)
                            }
                            type="button"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {chatThread?.id === thread.id ? "Close chat" : "Brainstorm reply"}
                          </button>
                        </div>
                      </article>
                    ),
                  )
                ) : (
                  <div className="rounded-2xl border border-dashed border-black/10 bg-[color:var(--panel-muted)] px-4 py-8 text-center text-sm text-[color:var(--muted-ink)]">
                    {bucket.id === "needs_reply"
                      ? "No emails awaiting a reply."
                      : "No conversations in this bucket yet."}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {chatThread ? (
        <ChatPanel thread={chatThread} onClose={() => setChatThread(null)} />
      ) : null}
    </div>
  );
}

function ChatPanel({
  thread,
  onClose,
}: {
  thread: OutreachThread;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/reply-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName: thread.companyName,
          originalEmail: thread.draftBody,
          replySnippet: thread.latestSnippet,
          replySummary: thread.lastReplySummary,
          messages: next,
        }),
      });

      const payload = (await response.json()) as { ok: boolean; message?: string; error?: string };
      if (payload.ok && payload.message) {
        setMessages((prev) => [...prev, { role: "assistant", content: payload.message! }]);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="sticky top-4 flex h-[calc(100vh-2rem)] w-[400px] shrink-0 flex-col rounded-[28px] border border-black/8 bg-[color:var(--panel)] shadow-[0_20px_60px_rgba(17,60,57,0.10)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-black/6 p-5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-ink)]">
            Reply brainstorm
          </p>
          <p className="mt-1 truncate text-sm font-semibold">{thread.companyName}</p>
          <p className="mt-1 text-xs leading-5 text-[color:var(--muted-ink)]">
            {thread.latestSnippet}
          </p>
        </div>
        <button
          className="mt-0.5 shrink-0 rounded-xl p-1.5 text-[color:var(--muted-ink)] hover:bg-[color:var(--panel-muted)] hover:text-[color:var(--ink)]"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-[color:var(--muted-ink)]">
            <p className="font-medium">Ask anything about this reply.</p>
            <p className="mt-1.5 text-xs leading-5">
              Try: "How should I respond?", "Should I follow up?", or "Write me a draft reply."
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6",
                  msg.role === "user"
                    ? "ml-auto bg-[color:var(--accent-strong)] text-white"
                    : "bg-[color:var(--panel-muted)] text-[color:var(--ink)]",
                )}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            ))}
            {loading ? (
              <div className="max-w-[85%] rounded-2xl bg-[color:var(--panel-muted)] px-4 py-3">
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--muted-ink)] [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--muted-ink)] [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[color:var(--muted-ink)] [animation-delay:300ms]" />
                </span>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-black/6 p-4">
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-[44px] flex-1 resize-none rounded-2xl border border-black/8 bg-[color:var(--panel-muted)] px-4 py-3 text-sm outline-none placeholder:text-[color:var(--muted-ink)] focus:border-[color:var(--ring)]"
            disabled={loading}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask how to reply… (Enter to send)"
            rows={1}
            value={input}
          />
          <button
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--accent-strong)] text-white hover:bg-[color:var(--accent-deep)] disabled:opacity-50"
            disabled={!input.trim() || loading}
            onClick={() => void send()}
            type="button"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
