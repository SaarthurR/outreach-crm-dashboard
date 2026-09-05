# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # start dev server at localhost:3000
npm run build        # production build
npm run lint         # ESLint
npx tsc --noEmit     # type-check without emitting
npm test             # run all tests (tsx --test)
npm test -- src/lib/ai.test.ts  # run a single test file

npm run db:generate  # generate Drizzle migration files
npm run db:push      # apply schema to database
npm run db:studio    # open Drizzle Studio
```

## Architecture

Single-page dashboard (`src/app/page.tsx` → `src/components/dashboard/dashboard-shell.tsx`) backed by REST API routes under `src/app/api/`.

### Demo vs. Live mode

`isLiveGmailConfigured()` in `src/lib/env.ts` controls mode. When Google env vars are absent, the app runs in demo mode with seeded data and no real Gmail calls. All mutation routes check `ensureAuthorizedUser()` from `src/lib/route-auth.ts`, which is a no-op in demo mode.

### Data layer

- **Schema**: `src/lib/db/schema.ts` — 5 tables: `profile_settings`, `integration_state`, `companies` (leads), `outreach_threads`, `activity_events`
- **Repository**: `src/lib/db/repository.ts` — all DB access goes through here. `ensureSeeded()` runs on every call, creating tables and inserting seed data if empty. Arrays (`accomplishments`, `skills`) are stored as JSON strings.
- **Client**: `src/lib/db/client.ts` — singleton LibSQL client; defaults to `file:local.db`

### Key lib modules

| File | Purpose |
|------|---------|
| `src/lib/types.ts` | All shared TypeScript interfaces and enums |
| `src/lib/env.ts` | Env var accessors + `isLiveGmailConfigured()`, `isAiConfigured()` |
| `src/lib/ai.ts` | Draft generation + reply classification; tries Groq first, falls back to OpenAI |
| `src/lib/gmail.ts` | Gmail API: send, token refresh, history sync, Pub/Sub watch |
| `src/lib/discovery.ts` | YC directory scraping + DuckDuckGo search for company contact emails |
| `src/lib/draft-personalization.ts` | Multi-pass website scraping to enrich email drafts |
| `src/lib/dashboard.ts` | `DashboardStats` computation (lead eligibility logic lives here) |
| `src/lib/outreach.ts` | Orchestrates send flow: draft → Gmail send → thread upsert → activity log |

### API routes

| Route | Purpose |
|-------|---------|
| `POST /api/discovery` | Discover new leads from YC/web |
| `POST /api/drafts` | Generate AI draft for a lead |
| `POST /api/send` | Send outreach email via Gmail |
| `GET/POST /api/settings` | Read/write profile settings |
| `GET /api/dashboard` | Full dashboard snapshot |
| `PATCH /api/leads/[leadId]` | Update lead status or opt-out |
| `POST /api/sync` | Manual Gmail history sync |
| `POST /api/gmail/webhook` | Google Pub/Sub push handler |
| `GET /api/cron/renew-watch` | Renew Gmail push watch (call daily) |
| `POST /api/reply-chat` | Streaming AI reply brainstorming |

### Tests

Test files are co-located with source (`*.test.ts`). Run with `npm test` (uses Node's built-in test runner via `tsx --test`). Scripts under `scripts/` have their own `.test.ts` files and run the same way.

## Outreach emails

### Sender background

Saarth Ranka, 14, Cupertino (Monta Vista High School). Key facts used in every email:

- Built **Ascenta** — a Vercel + Firebase gaming/proxy site — to 20 paying customers at school
- Runs **autonomous trading strategies via the IBKR API**; also builds strategies with Pine Script and Streamlit dashboards
- ~4 years trading options and futures; developing systematic strategies with LLMs
- Played **tabla for 9 years**, teaches at a local temple, placed **2nd nationally at Chaitradhun**
- Unpaid is fine; parents supportive; remote preferred; available summer

Tone: calm, curious, slightly bold, ambitious, respectful. No hollow phrases ("passionate about", "excited about the opportunity", "innovative", "demonstrate my abilities").

### Email structure

Subject is always **"Internship Inquiry"** — no company name.

Seven paragraphs, each separated by a blank line:

1. **Greeting** — `Hi [ContactFirstName] -` if contact name known, otherwise `Hey there -`
2. **Cold open** — acknowledge this is unusual; introduce name + age (14); mention something specific about the company as context, not as a compliment
3. **Background** — 1–2 sentences using real specifics (20 customers, IBKR API, Pine Script, Vercel + Firebase — pick whichever fit the company best); no vague summaries
4. **Offer** — what Saarth could help with, tied to what this company actually does; specific, not generic
5. **Interest** — genuine statement of wanting to intern there; unpaid is fine; happy to start with a small trial task
6. **Closing question** — one simple question (e.g. "Would you be open to a quick chat?")
7. **Sign-off** — `Best,\nSaarth`

### Template variants (no-AI fallback)

`chooseTemplateVariant()` in `src/lib/ai.ts` picks based on signals in company type/source/notes:

- **Technical** — leads with signals like `founder`, `llm`, `infra`, `trading`, `api`, `automation`; emphasizes LLM/trading/automation, omits tabla
- **General** — all other leads; includes broader background including tabla and music

### AI model priority

When AI is configured, `generateOutreachDraft()` uses **OpenAI gpt-4o** if `OPENAI_API_KEY` is set, otherwise **Groq llama-3.3-70b-versatile**. Falls back to the hardcoded templates if both fail. Reply classification uses OpenAI only (no Groq fallback beyond keyword matching).

### Personalization

`buildDraftPersonalization()` in `src/lib/draft-personalization.ts` scrapes the company website to produce an `introLine` (why Saarth is reaching out to this specific company) and an `offerLine` (what he could concretely help with). These two lines are the only per-company variable content in the templates.
