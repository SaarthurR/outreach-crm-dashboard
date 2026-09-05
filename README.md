# Outreach CRM

A single-user outreach dashboard for cold email campaigns — discover leads, generate personalized drafts with an LLM, send them through Gmail, and track replies, all from one screen.

Built with **Next.js (App Router)**, **Drizzle ORM** over **libSQL/SQLite**, the **Gmail API**, and **OpenAI / Groq** for draft generation. Runs fully offline in a seeded demo mode, or in live mode once Google and AI credentials are provided.

## Features

- **Lead discovery** — scrapes company directories and the web to find contact emails, deduped into a working queue.
- **AI-personalized drafts** — generates a tailored email per lead (OpenAI `gpt-4o`, falling back to Groq `llama-3.3-70b`, then to static templates). Multi-pass website scraping enriches each draft with company-specific context.
- **Gmail-backed sending** — sends through your own Gmail account with OAuth, restricted to a single authorized address.
- **Reply tracking** — Gmail history sync plus a Google Pub/Sub push webhook classify incoming replies and update thread state.
- **Unsent / Sent queues** — mass-send eligible rows under review, with a full sent history.
- **Daily send cap + pacing** — batch sends stop at `dailySendTarget` and space each message out, so a personal Gmail account does not get spam-filtered for firing a burst.
- **Per-lead opt-out** — blocked companies stay visible but darkened and are skipped on send.
- **Editable sender profile** — the background used to personalize drafts is configurable in-app.

## Architecture

Single-page dashboard (`src/app/page.tsx` → `src/components/dashboard/`) backed by REST routes under `src/app/api/`.

| Layer | Where |
|-------|-------|
| Schema (5 tables) | `src/lib/db/schema.ts` — `profile_settings`, `integration_state`, `companies`, `outreach_threads`, `activity_events` |
| Data access | `src/lib/db/repository.ts` — single gateway; auto-seeds on first call |
| AI drafts | `src/lib/ai.ts` — OpenAI → Groq → template fallback |
| Gmail | `src/lib/gmail.ts` — send, token refresh, history sync, Pub/Sub watch |
| Discovery | `src/lib/discovery.ts` — directory + web scraping for contact emails |
| Send orchestration | `src/lib/outreach.ts` — draft → send → thread upsert → activity log |

### Test sends

`POST /api/test-send` with `{ "to": "someone@example.com" }` builds a real draft from the
next eligible lead and sends it to that address, prefixed with a note naming the company it
would really have gone to. It does **not** consume a daily send, mark any company as
contacted, or write to the activity log. In demo mode it returns the rendered email instead
of sending. The dashboard exposes it as **Send a test**.

### Sending limits

`sendOutreachBatch` in `src/lib/gmail.ts` enforces two things that the earlier version did not:

- **A daily cap.** `dailySendTarget` from profile settings is counted against messages already
  sent today. Anything over the cap is skipped with a reason, and stays queued for tomorrow.
- **A gap between sends.** Each message waits 8 to 20 seconds after the previous one.

- **Address de-duplication.** The lead list contains rows that share an inbox; a batch sends
  to each address at most once.
- **Never re-contact a reply.** `isLeadSendable` excludes any lead whose thread is in the
  `yes`, `maybe` or `no` bucket, independently of the lead's own status field. Bounces are
  classified `no`, so a dead address is never retried.
- **Strong matches first.** The queue is ordered by whether Saarth has a real connection to
  what the company does, so the daily cap spends itself on the best emails.

This exists because the April/May 2026 campaign sent 167, 250 and 189 emails on single days
from a personal Gmail address, which is well past the point where Gmail starts filtering.

**Demo vs. live mode** is controlled by `isLiveGmailConfigured()` in `src/lib/env.ts`. Without Google env vars the app runs on seeded demo data and makes no real Gmail calls; every mutation route is a no-op guard in demo mode.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000 (demo mode)
```

Demo mode needs no credentials at all. Leads, drafts and sends are simulated against
seeded data, and no email leaves the machine. That is the mode to use for a first look.

**If `npm run dev` or `npm run build` fails with `library load disallowed by system policy`:**
macOS quarantined the files (this happens when the folder arrives over AirDrop or a shared
folder). Next.js then cannot load its native binary and Turbopack refuses to start. Fix it once:

```bash
xattr -d -r com.apple.quarantine .
```

Copy `.env.example` to `.env.local` and fill in credentials to enable live mode:

```bash
AUTHORIZED_GMAIL_ADDRESS=you@gmail.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=...
OPENAI_API_KEY=...        # or GROQ_API_KEY
DATABASE_URL=file:local.db
```

## Scripts

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # ESLint
npm test             # tsx --test (tests are co-located as *.test.ts)
npm run db:generate  # generate Drizzle migrations
npm run db:push      # apply schema
npm run db:studio    # Drizzle Studio
```

## Stack

Next.js · TypeScript · Drizzle ORM · libSQL/SQLite · Gmail API · Google Pub/Sub · OpenAI · Groq · Tailwind CSS
