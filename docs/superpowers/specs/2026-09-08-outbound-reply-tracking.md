# Spec: Outbound + reply tracking for CRM2

**Date:** 2026-09-08  
**Source:** WarmStack `src/modules/tracking/poll.ts` match logic  
**Target:** CRM2 one-Gmail-mailbox internship outreach

## Goal

Stop manually checking Gmail. After you send from CRM2, the app must:

1. Remember every outbound email (who, when, Gmail ids).
2. Detect replies to those emails.
3. Show them on the Replies tab and mark the lead so it never gets cold-emailed again.

**Out of scope:** open pixels, click tracking, multi-inbox fleets, Zapmail, LLM classification upgrades.

## Why current CRM2 sync fails

| Gap | Effect |
|-----|--------|
| Match only by `gmailThreadId` | Reply dropped if thread id missing/wrong |
| No RFC `Message-ID` stored on send | Cannot match `In-Reply-To` / `References` |
| No inbound dedupe | Same reply reprocessed; activity spam |
| Never sets lead `status = replied` | Lead can look "sent" forever in some views |
| History `maxResults: 20`, inbox sample `10` | Misses replies under volume |
| Backfill only snippets `=== "Message sent through Gmail."` | Misses almost all real threads |

## WarmStack pieces we port (adapted)

From WarmStack poll matching — **not** IMAP multi-inbox, **not** click links:

1. **`normalizeSubject`** — strip `Re:`/`Fwd:` then lowercase.
2. **`matchByHeaders`** — inbound `In-Reply-To`/`References` → stored outbound RFC Message-ID.
3. **`matchByFallback`** — sender email → lead contactEmail → subject match → latest sent in window (30 days). Ambiguous multi-thread same email → skip (log), do not guess.
4. **Inbound dedupe** — once an inbound Gmail message id is processed, never process again.
5. **Skip self** — ignore mail From your own authorized address.

CRM2 difference: one mailbox, SQLite, Gmail API (not IMAP). Matching runs on Gmail History + periodic backfill of sent threads.

## Data model

Add to `outreach_threads`:

| Column | Purpose |
|--------|---------|
| `gmail_message_id` | Gmail API message id from `messages.send` |
| `rfc_message_id` | Normalized RFC Message-ID from the Sent message |
| `last_inbound_message_id` | Last processed inbound Gmail message id |

New table `inbound_seen`:

| Column | Purpose |
|--------|---------|
| `gmail_message_id` PK | Inbound Gmail message id already handled |
| `thread_id` | Matched outreach thread id (nullable if unmatched skipped) |
| `seen_at` | ISO timestamp |

## Send path

After live `messages.send`:

1. Store `gmailThreadId`, `gmailMessageId` from response.
2. `messages.get` that id with headers `Message-ID`.
3. Normalize and store `rfcMessageId`.
4. Keep existing lead `sent` + activity `thread_sent`.

Demo mode: fake ids prefixed `demo-` so match tests still work offline.

## Sync path (replace `syncInboxReplies` core)

For each new inbox message (history pagination until empty, not capped at 20 forever):

1. Skip if From === authorized address.
2. Skip if `inbound_seen` already has this message id.
3. Load headers: From, Subject, In-Reply-To, References, Message-ID; body snippet for classify.
4. Resolve thread: headers → fallback email+subject → last resort existing `gmailThreadId` match.
5. If no match: record in `inbound_seen` with null thread (so we do not retry forever), do not create a ghost thread.
6. If match: classify (existing keyword `classifyReply`), update thread bucket/snippet, set lead `replied`, activity `reply_received`, mark `inbound_seen`.

## Backfill

Replace brittle snippet filter. For every thread with `sentAt` and `gmailThreadId`:

1. `threads.get`
2. Find newest message not from us
3. Run same match + apply path (dedupe via `inbound_seen`)

## UI / product rules

- Replies tab: unchanged shape; data quality improves underneath.
- Never cold-send again if `hasReplied` or domain already replied (existing `buildRepliedDomains`).
- No open/click tracking UI or endpoints.

## Success criteria

- [ ] Send stores `gmail_message_id` + `rfc_message_id`
- [ ] Reply with `In-Reply-To` matching stored RFC id attaches to the right company
- [ ] Reply from contact email with `Re: Internship Inquiry` attaches when headers missing
- [ ] Same inbound message synced twice → one activity row
- [ ] Lead status becomes `replied`
- [ ] Unit tests cover normalize + header match + fallback + dedupe without Gmail

## Build order

1. Schema + ensureSeeded ALTERs + types/repo helpers  
2. Pure match module + tests  
3. Wire send to store ids  
4. Rewrite sync + backfill  
5. Manual: Sync button after a real self-reply test email  
