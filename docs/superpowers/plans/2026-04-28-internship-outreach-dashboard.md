# Internship Outreach Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Gmail-connected internship outreach dashboard with AI drafting, reply classification, public lead discovery, and a polished command-center UI.

**Architecture:** Use a Next.js App Router app with a single dashboard route, a small service layer for Gmail/AI/discovery logic, and a SQLite/LibSQL-backed persistence layer that works locally now and can move to cloud credentials later. Keep live integrations behind capability checks so the UI still works in demo mode.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, NextAuth/Auth.js, Gmail API, Vercel AI SDK + OpenAI provider, Drizzle ORM, LibSQL, Lucide.

---

### Task 1: App Foundation And Shared Types

**Files:**
- Modify: `package.json`
- Create: `src/lib/cn.ts`
- Create: `src/lib/types.ts`
- Create: `src/lib/constants.ts`
- Create: `src/lib/env.ts`
- Create: `src/lib/seed-data.ts`
- Create: `.env.example`

- [ ] Define the shared application types and constants for settings, leads, threads, activity events, and reply categories.
- [ ] Add environment parsing helpers for Gmail, Google OAuth, AI, database, and cron secrets.
- [ ] Seed default profile data from the user-provided bio so the product opens in a realistic state.

### Task 2: Persistence And Repository Layer

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/client.ts`
- Create: `src/lib/db/repository.ts`

- [ ] Create Drizzle schema tables for profile settings, integration state, companies, outreach threads, and activity events.
- [ ] Add a lazy LibSQL client that defaults to a local file database when `DATABASE_URL` is absent.
- [ ] Add repository helpers for dashboard reads, settings writes, lead upserts, thread sync, and activity logging.

### Task 3: Gmail/Auth/AI/Discovery Services

**Files:**
- Create: `src/auth.ts`
- Create: `src/lib/gmail.ts`
- Create: `src/lib/ai.ts`
- Create: `src/lib/discovery.ts`
- Create: `src/lib/dashboard.ts`

- [ ] Configure Google sign-in with Gmail scopes and single-user restriction.
- [ ] Implement Gmail helpers for sending, thread sync, watch renewal, and thread URL creation.
- [ ] Implement AI helpers for draft generation, reply summaries, and reply bucket classification.
- [ ] Implement public lead discovery via web search + contact page extraction with confidence scoring.
- [ ] Add a dashboard loader that combines repository data with integration health.

### Task 4: Route Handlers And Mutations

**Files:**
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/api/discovery/route.ts`
- Create: `src/app/api/drafts/route.ts`
- Create: `src/app/api/send/route.ts`
- Create: `src/app/api/settings/route.ts`
- Create: `src/app/api/gmail/webhook/route.ts`
- Create: `src/app/api/cron/renew-watch/route.ts`

- [ ] Add Auth.js route wiring.
- [ ] Add JSON endpoints for discovery, draft generation, sending, settings save, webhook sync, and watch renewal.
- [ ] Make every mutation support demo mode if credentials are missing.

### Task 5: Dashboard UI

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/page.tsx`
- Create: `src/components/dashboard-shell.tsx`
- Create: `src/components/sidebar.tsx`
- Create: `src/components/topbar.tsx`
- Create: `src/components/status-cards.tsx`
- Create: `src/components/activity-panel.tsx`
- Create: `src/components/leads-panel.tsx`
- Create: `src/components/replies-panel.tsx`
- Create: `src/components/sent-panel.tsx`
- Create: `src/components/settings-panel.tsx`
- Create: `src/components/empty-state.tsx`

- [ ] Replace the starter page with the editorial dashboard shell.
- [ ] Add the bottom-left settings card and the four primary workspace sections.
- [ ] Add responsive behavior so mobile uses stacked sections and desktop uses the left rail layout.

### Task 6: Verification And Documentation

**Files:**
- Modify: `README.md`

- [ ] Document local setup, required env vars, demo mode, and cloud deployment expectations.
- [ ] Run lint and build to verify the project compiles.
- [ ] Start the app and smoke-test the dashboard route and core interactions.
