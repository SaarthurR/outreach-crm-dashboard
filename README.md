# Outreach CRM

Lightweight cold-email tracker for one Gmail account. Import a CSV, send outreach, and track replies — no Zapmail, no LLM, no paid infra.

Built with **Next.js**, **Drizzle + SQLite**, and the **Gmail API**.

## What it does

1. **Import CSV** — upload `email`, `company`, `firstName` columns
2. **Send** — one Gmail account, daily cap + pacing built in
3. **Track outbounds + replies** — every send stores Gmail + RFC Message-IDs; Sync matches inbound mail via In-Reply-To (WarmStack-style) with email+subject fallback. No open/click tracking (spam risk).

## Run

```bash
npm install
cp .env.example .env.local   # add Gmail OAuth creds for live mode
npm run dev                  # http://localhost:3000
```

Demo mode works with no credentials (seed data, no real sends).

After live sends: hit **Sync** (or `POST /api/sync`) to pull replies. `POST /api/sync-backfill` walks every sent thread once.

Live mode needs in `.env.local`:

```bash
AUTHORIZED_GMAIL_ADDRESS=you@gmail.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=...
DATABASE_URL=file:local.db
```

## CSV format

```csv
email,company,firstName,website,notes
founder@acme.ai,Acme AI,Jane,https://acme.ai,YC W24
```

## Scripts

```bash
npm run dev
npm test
npm run build
npm run lint
```

## Stack

Next.js · TypeScript · Drizzle ORM · libSQL/SQLite · Gmail API · Tailwind CSS
