"use client";

import { useMemo, useState } from "react";
import { CircleCheck, LoaderCircle, Send, TriangleAlert } from "lucide-react";

import { parseRecipients } from "@/lib/blast";

type BlastResult = {
  address: string;
  status: "sent" | "failed" | "skipped";
  reason: string;
};

// Matches the 8-20s jittered gap in sendBlast, so the estimate on the button is honest.
const SECONDS_PER_SEND = 14;

function estimateLabel(count: number) {
  const seconds = Math.max(0, count - 1) * SECONDS_PER_SEND;
  if (seconds < 60) {
    return "under a minute";
  }

  return `about ${Math.ceil(seconds / 60)} minutes`;
}

export function BlastPanel({ connected }: { connected: boolean }) {
  const [recipientText, setRecipientText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachResume, setAttachResume] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BlastResult[] | null>(null);

  const { addresses, duplicates } = useMemo(() => parseRecipients(recipientText), [recipientText]);
  const ready = Boolean(addresses.length && subject.trim() && body.trim()) && !sending;

  async function send() {
    const confirmed = window.confirm(
      `Send this email to ${addresses.length} ${addresses.length === 1 ? "person" : "people"}?\n\n` +
        `Subject: ${subject.trim()}\n\n` +
        `Each send waits 8 to 20 seconds, so this takes ${estimateLabel(addresses.length)}. ` +
        `Leave this tab open.\n\nThis cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setSending(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch("/api/blast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipients: recipientText,
          subject,
          body,
          attachResume,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        results?: BlastResult[];
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "The blast did not finish.");
      }

      setResults(payload.results ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The blast did not finish.");
    } finally {
      setSending(false);
    }
  }

  const sentCount = results?.filter((result) => result.status === "sent").length ?? 0;
  const failed = results?.filter((result) => result.status === "failed") ?? [];
  const skipped = results?.filter((result) => result.status === "skipped") ?? [];

  return (
    <section aria-labelledby="blast-title" className="surface p-5 sm:p-6">
      <header>
        <h2 id="blast-title" className="font-heading text-lg text-[color:var(--ink)]">
          Blast
        </h2>
        <p className="mt-1 text-sm leading-6 text-[color:var(--muted-ink)]">
          Paste a list of addresses and one email. Everyone gets the same message, sent one at a
          time from your Gmail. No AI, and nothing here touches your company queue.
        </p>
      </header>

      {connected ? null : (
        <p className="mt-4 flex items-start gap-2.5 rounded-[var(--radius-sm)] bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>Demo mode. Connect Gmail before sending, or nothing will actually go out.</span>
        </p>
      )}

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-[color:var(--ink)]">1. Addresses</span>
            <span className="text-xs tabular-nums text-[color:var(--muted-ink)]">
              {addresses.length} {addresses.length === 1 ? "address" : "addresses"}
              {duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} removed` : ""}
            </span>
          </span>
          <textarea
            className="input-field min-h-32 font-mono text-xs leading-6"
            disabled={sending}
            onChange={(event) => setRecipientText(event.target.value)}
            placeholder={"a@company.com, b@company.com\nAda Lovelace <ada@company.com>"}
            value={recipientText}
          />
          <span className="mt-1.5 block text-xs text-[color:var(--muted-ink)]">
            Commas, spaces, semicolons or one per line — all work. Duplicates are dropped.
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[color:var(--ink)]">
            2. Subject
          </span>
          <input
            className="input-field"
            disabled={sending}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Internship Inquiry"
            value={subject}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[color:var(--ink)]">
            3. Email
          </span>
          <textarea
            className="input-field min-h-64 leading-6"
            disabled={sending}
            onChange={(event) => setBody(event.target.value)}
            placeholder={"Hi there -\n\nPaste the email exactly as you want it sent.\n\nBest,\nSaarth"}
            value={body}
          />
          <span className="mt-1.5 block text-xs text-[color:var(--muted-ink)]">
            Sent exactly as written. A blank line starts a new paragraph.
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[color:var(--ink)]">
          <input
            checked={attachResume}
            className="h-4 w-4 cursor-pointer accent-[color:var(--accent-strong)]"
            disabled={sending}
            onChange={(event) => setAttachResume(event.target.checked)}
            type="checkbox"
          />
          Attach my resume
        </label>

        <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--border)] pt-4">
          <button
            className="btn-primary"
            disabled={!ready}
            onClick={() => void send()}
            type="button"
          >
            {sending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" strokeWidth={1.75} />
            )}
            {sending
              ? "Sending…"
              : `Send to ${addresses.length} ${addresses.length === 1 ? "person" : "people"}`}
          </button>

          {addresses.length > 1 && !sending ? (
            <span className="text-xs text-[color:var(--muted-ink)]">
              Takes {estimateLabel(addresses.length)}. Keep this tab open.
            </span>
          ) : null}

          {sending ? (
            <span className="text-xs text-[color:var(--muted-ink)]">
              Sending one at a time so Gmail does not flag the run. Do not close this tab.
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          aria-live="polite"
          className="mt-4 flex items-start gap-2.5 rounded-[var(--radius-sm)] bg-rose-50 px-3.5 py-3 text-sm text-rose-900"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{error}</span>
        </p>
      ) : null}

      {results ? (
        <div aria-live="polite" className="mt-5 border-t border-[color:var(--border)] pt-4">
          <p className="flex items-start gap-2.5 text-sm text-[color:var(--ink)]">
            <CircleCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--accent-strong)]"
              strokeWidth={1.75}
            />
            <span>
              {skipped.length
                ? `Demo mode, so nothing was sent. ${skipped.length} ${skipped.length === 1 ? "address was" : "addresses were"} ready to go.`
                : `Sent ${sentCount} of ${results.length}.${failed.length ? ` ${failed.length} failed.` : ""}`}
            </span>
          </p>

          {failed.length ? (
            <ul className="mt-3 space-y-1.5">
              {failed.map((result) => (
                <li
                  key={result.address}
                  className="rounded-[var(--radius-sm)] bg-rose-50 px-3 py-2 text-xs text-rose-900"
                >
                  <span className="font-mono">{result.address}</span> — {result.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
