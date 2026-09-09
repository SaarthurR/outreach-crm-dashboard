"use client";

import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, CheckCircle2, Inbox, MailOpen, MailWarning, Star } from "lucide-react";

import { cn } from "@/lib/cn";
import { hasReceivedReply, needsResponse } from "@/lib/outreach";
import type { OutreachThread, ReplyBucket } from "@/lib/types";

interface RepliesTabsProps {
  threads: OutreachThread[];
  onToggleStar: (threadId: string, starred: boolean) => void;
}

function statusLabel(bucket: ReplyBucket, hasReply: boolean) {
  if (!hasReply) return { label: "Awaiting reply", tone: "muted" as const };
  switch (bucket) {
    case "yes":
      return { label: "Interested", tone: "positive" as const };
    case "maybe":
      return { label: "Maybe", tone: "warm" as const };
    case "no":
      return { label: "Not interested", tone: "negative" as const };
    case "bounced":
      return { label: "Bounced", tone: "negative" as const };
    default:
      return { label: "Needs reply", tone: "attention" as const };
  }
}

export function RepliesTabs({ threads, onToggleStar }: RepliesTabsProps) {
  const sorted = [...threads].sort(
    (left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime(),
  );

  // Every thread lands in exactly one section: bounced first (a dead address is
  // never a reply or a rejection), then starred (an explicit "I'm tracking this
  // myself" flag that takes it out of the auto-sorted flow), then by whether a
  // reply arrived and whether Saarth has answered it since.
  const bounced = sorted.filter((thread) => thread.bucket === "bounced");
  const starred = sorted.filter((thread) => thread.starred && thread.bucket !== "bounced");
  const remaining = sorted.filter((thread) => !bounced.includes(thread) && !starred.includes(thread));
  const needingResponse = remaining.filter((thread) => needsResponse(thread));
  const done = remaining.filter((thread) => hasReceivedReply(thread) && !needsResponse(thread));
  const awaiting = remaining.filter((thread) => !hasReceivedReply(thread));

  return (
    <div className="space-y-6">
      <section>
        <header className="mb-2.5 flex items-center gap-2">
          <Inbox className="h-4 w-4 text-[color:var(--accent-strong)]" strokeWidth={1.75} />
          <h3 className="text-sm font-semibold">
            Replies
            <span className="ml-1.5 font-normal tabular-nums text-[color:var(--muted-ink)]">
              {needingResponse.length}
            </span>
          </h3>
        </header>
        <ThreadList
          empty="No replies yet. They show up here after someone responds."
          onToggleStar={onToggleStar}
          threads={needingResponse}
        />
      </section>

      <section>
        <header className="mb-2.5 flex items-center gap-2">
          <Star className="h-4 w-4 text-[color:var(--accent-strong)]" strokeWidth={1.75} />
          <h3 className="text-sm font-semibold">
            Starred
            <span className="ml-1.5 font-normal tabular-nums text-[color:var(--muted-ink)]">
              {starred.length}
            </span>
          </h3>
        </header>
        <ThreadList
          empty="Star a promising reply to keep it here while you follow up."
          onToggleStar={onToggleStar}
          threads={starred}
        />
      </section>

      <section>
        <header className="mb-2.5 flex items-center gap-2">
          <MailOpen className="h-4 w-4 text-[color:var(--muted-ink)]" strokeWidth={1.75} />
          <h3 className="text-sm font-semibold">
            Waiting
            <span className="ml-1.5 font-normal tabular-nums text-[color:var(--muted-ink)]">
              {awaiting.length}
            </span>
          </h3>
        </header>
        <ThreadList
          empty="Sent emails still waiting on a response land here."
          onToggleStar={onToggleStar}
          threads={awaiting}
        />
      </section>

      <section>
        <header className="mb-2.5 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-[color:var(--muted-ink)]" strokeWidth={1.75} />
          <h3 className="text-sm font-semibold">
            Done
            <span className="ml-1.5 font-normal tabular-nums text-[color:var(--muted-ink)]">
              {done.length}
            </span>
          </h3>
        </header>
        <ThreadList
          empty="Once you've replied and it's not starred, it lands here — nothing left to do."
          onToggleStar={onToggleStar}
          threads={done}
        />
      </section>

      {bounced.length > 0 ? (
        <section>
          <header className="mb-2.5 flex items-center gap-2">
            <MailWarning className="h-4 w-4 text-[color:var(--muted-ink)]" strokeWidth={1.75} />
            <h3 className="text-sm font-semibold">
              Non-deliverable addresses
              <span className="ml-1.5 font-normal tabular-nums text-[color:var(--muted-ink)]">
                {bounced.length}
              </span>
            </h3>
          </header>
          <ThreadList empty="" onToggleStar={onToggleStar} threads={bounced} />
        </section>
      ) : null}
    </div>
  );
}

function ThreadList({
  threads,
  empty,
  onToggleStar,
}: {
  threads: OutreachThread[];
  empty: string;
  onToggleStar: (threadId: string, starred: boolean) => void;
}) {
  if (threads.length === 0) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-[color:var(--border-strong)] px-4 py-8 text-center text-sm text-[color:var(--muted-ink)]">
        {empty}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {threads.map((thread) => {
        const replied = hasReceivedReply(thread);
        const status = statusLabel(thread.bucket, replied);

        return (
          <article
            key={thread.id}
            className="rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--panel-muted)] p-3.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-[color:var(--ink)]">
                    {thread.companyName}
                  </p>
                  <StatusPill tone={status.tone} label={status.label} />
                </div>
                <p className="mt-1 truncate text-xs text-[color:var(--muted-ink)]">{thread.subject}</p>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                <div className="text-right text-xs text-[color:var(--muted-ink)]">
                  {thread.sentAt ? (
                    <p suppressHydrationWarning>
                      Sent {formatDistanceToNow(new Date(thread.sentAt), { addSuffix: true })}
                    </p>
                  ) : null}
                </div>
                <button
                  aria-label={thread.starred ? "Unstar this conversation" : "Star this conversation"}
                  aria-pressed={thread.starred}
                  className="rounded-full p-1 text-[color:var(--muted-ink)] hover:bg-black/5"
                  onClick={() => onToggleStar(thread.id, !thread.starred)}
                  type="button"
                >
                  <Star
                    className="h-4 w-4"
                    fill={thread.starred ? "currentColor" : "none"}
                    strokeWidth={1.75}
                  />
                </button>
              </div>
            </div>

            {thread.latestSnippet ? (
              <p className="mt-2.5 line-clamp-3 text-sm leading-6 text-[color:var(--muted-ink)]">
                {thread.latestSnippet}
              </p>
            ) : null}

            {thread.lastReplySummary && replied ? (
              <p className="mt-2 text-xs leading-5 text-[color:var(--ink)]">{thread.lastReplySummary}</p>
            ) : null}

            {thread.gmailThreadUrl ? (
              <a
                className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-[color:var(--accent-strong)] hover:text-[color:var(--ink)]"
                href={thread.gmailThreadUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open in Gmail
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </a>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "positive" | "warm" | "negative" | "attention" | "muted";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "positive" && "bg-emerald-50 text-emerald-800",
        tone === "warm" && "bg-amber-50 text-amber-900",
        tone === "negative" && "bg-slate-100 text-slate-700",
        tone === "attention" && "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]",
        tone === "muted" && "bg-white text-[color:var(--muted-ink)] ring-1 ring-[color:var(--border)]",
      )}
    >
      {label}
    </span>
  );
}
