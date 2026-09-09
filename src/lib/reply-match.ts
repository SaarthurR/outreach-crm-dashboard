/**
 * WarmStack-style outbound ↔ inbound matching, adapted for CRM2's one mailbox.
 * Ported from warmstack/src/modules/tracking/poll.ts (normalizeSubject + header/fallback match).
 */

export const REPLY_FALLBACK_MATCH_DAYS = 30;

export function normalizeMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, "").toLowerCase();
}

export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  while (/^(re|fwd|fw):\s*/i.test(s)) {
    s = s.replace(/^(re|fwd|fw):\s*/i, "").trim();
  }
  return s.toLowerCase();
}

export function extractEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon)@/i;
const BOUNCE_SUBJECT =
  /(delivery status notification|undelivered mail|mail delivery (failed|subsystem)|failure notice|returned mail)/i;

/** Gmail/most MTAs send bounces from a daemon address or with one of these subjects. */
export function isBounceMessage(input: { fromEmail: string | null; subject: string | null }): boolean {
  if (input.fromEmail && BOUNCE_SENDER.test(input.fromEmail)) return true;
  if (input.subject && BOUNCE_SUBJECT.test(input.subject)) return true;
  return false;
}

/** Gmail's message.snippet sometimes comes back with entities un-decoded (seen on
 * quoted "wrote:" text pulled from an HTML body). Decode numeric entities first so a
 * literal "&amp;lt;" in the source doesn't get double-unescaped by the &amp; pass. */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const IGNORED_BOUNCE_SENDERS = /^(mailer-daemon|postmaster|mail-daemon|no-reply|noreply)@/i;

/** Bounce bodies are DSN text: the first email address that isn't the daemon or us is the dead recipient. */
export function extractBouncedRecipient(bodyText: string, ownEmail: string | null | undefined): string | null {
  const own = ownEmail?.trim().toLowerCase() ?? "";
  const matches = bodyText.match(/[^\s<>"']+@[^\s<>"']+\.[a-z]{2,}/gi) ?? [];
  for (const raw of matches) {
    const email = raw.replace(/[.,;:]+$/, "").toLowerCase();
    if (email === own || IGNORED_BOUNCE_SENDERS.test(email)) continue;
    return email;
  }
  return null;
}

/** Pull Message-ID tokens from In-Reply-To / References header values. */
export function messageIdTokens(...sources: Array<string | null | undefined>): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const match of source.matchAll(/<([^>]+)>|[^\s<>]+@[^\s<>]+/g)) {
      const token = normalizeMessageId(match[1] ?? match[0] ?? "");
      if (token.includes("@")) ids.add(token);
    }
  }
  return [...ids];
}

export interface OutboundCandidate {
  id: string;
  companyId: string;
  contactEmail: string;
  subject: string;
  sentAt: string | null;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  gmailMessageId: string | null;
}

export type MatchReason = "header" | "fallback" | "thread" | null;

export interface MatchResult {
  threadId: string;
  companyId: string;
  reason: Exclude<MatchReason, null>;
}

export function matchByHeaders(
  inReplyToIds: string[],
  candidates: OutboundCandidate[],
): MatchResult | null {
  if (inReplyToIds.length === 0) return null;
  const wanted = new Set(inReplyToIds.map(normalizeMessageId));

  for (const candidate of candidates) {
    if (!candidate.rfcMessageId) continue;
    if (wanted.has(normalizeMessageId(candidate.rfcMessageId))) {
      return { threadId: candidate.id, companyId: candidate.companyId, reason: "header" };
    }
  }
  return null;
}

/**
 * Fallback when headers are stripped: same contact email + same normalized subject,
 * latest send inside the window. Ambiguous (multiple distinct subjects/threads) → null.
 */
export function matchByFallback(
  fromEmail: string | null,
  replySubject: string | null,
  candidates: OutboundCandidate[],
  now = new Date(),
  windowDays = REPLY_FALLBACK_MATCH_DAYS,
): MatchResult | null {
  const from = fromEmail?.trim().toLowerCase() ?? "";
  if (!from) return null;

  const windowStart = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  let matched = candidates.filter((c) => {
    if (!c.sentAt) return false;
    if (new Date(c.sentAt).getTime() < windowStart) return false;
    return c.contactEmail.trim().toLowerCase() === from;
  });

  if (matched.length === 0) return null;

  const subject = (replySubject ?? "").trim();
  if (subject) {
    const normalizedReply = normalizeSubject(subject);
    const bySubject = matched.filter((c) => normalizeSubject(c.subject) === normalizedReply);
    if (bySubject.length > 0) matched = bySubject;
  }

  // Group by gmail thread (or thread id). Exactly one group → take latest send in that group.
  const groups = new Map<string, OutboundCandidate>();
  for (const candidate of matched) {
    const key = candidate.gmailThreadId ?? candidate.id;
    const existing = groups.get(key);
    if (!existing || (candidate.sentAt ?? "") > (existing.sentAt ?? "")) {
      groups.set(key, candidate);
    }
  }

  if (groups.size !== 1) return null;

  const winner = [...groups.values()][0]!;
  return { threadId: winner.id, companyId: winner.companyId, reason: "fallback" };
}

export function matchByGmailThreadId(
  gmailThreadId: string | null | undefined,
  candidates: OutboundCandidate[],
): MatchResult | null {
  if (!gmailThreadId) return null;
  const hit = candidates.find((c) => c.gmailThreadId === gmailThreadId);
  if (!hit) return null;
  return { threadId: hit.id, companyId: hit.companyId, reason: "thread" };
}

/** Resolve outbound thread for an inbound message. Prefer headers, then fallback, then thread id. */
export function resolveOutboundThread(input: {
  fromEmail: string | null;
  subject: string | null;
  inReplyTo: string | null;
  references: string | null;
  gmailThreadId: string | null;
  candidates: OutboundCandidate[];
  ownEmail?: string | null;
  now?: Date;
}): MatchResult | null {
  const own = input.ownEmail?.trim().toLowerCase() ?? "";
  const from = input.fromEmail?.trim().toLowerCase() ?? "";
  if (own && from && from === own) return null;

  const headerIds = messageIdTokens(input.inReplyTo, input.references);
  return (
    matchByHeaders(headerIds, input.candidates) ??
    matchByFallback(input.fromEmail, input.subject, input.candidates, input.now) ??
    matchByGmailThreadId(input.gmailThreadId, input.candidates)
  );
}
