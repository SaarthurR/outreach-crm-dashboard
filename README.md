# Outreach CRM

A single-user outreach dashboard for cold email campaigns — discover leads, generate personalized drafts with an LLM, send them through Gmail, and track replies, all from one screen.

Built with **Next.js (App Router)**, **Drizzle ORM** over **libSQL/SQLite**, the **Gmail API**, and **OpenAI / Groq** for draft generation. Runs fully offline in a seeded demo mode, or in live mode once Google and AI credentials are provided.

## Features

- **Lead discovery** — scrapes company directories and the web to find contact emails, deduped into a working queue.
- **AI-personalized drafts** — generates a tailored email per lead (OpenAI `gpt-4o`, falling back to Groq `llama-3.3-70b`, then to static templates). Multi-pass website scraping enriches each draft with company-specific context.
- **Gmail-backed sending** — sends through your own Gmail account with OAuth, restricted to a single authorized address.
- **Reply tracking** — Gmail history sync plus a Google Pub/Sub push webhook classify incoming replies and update thread state.
- **Unsent / Sent queues** — mass-send eligible rows under review, with a full sent history.
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

**Demo vs. live mode** is controlled by `isLiveGmailConfigured()` in `src/lib/env.ts`. Without Google env vars the app runs on seeded demo data and makes no real Gmail calls; every mutation route is a no-op guard in demo mode.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000 (demo mode)
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
