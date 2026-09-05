# Internship Outreach Dashboard Design

## Goal

Build a single-user, cloud-deployable dashboard for `ranka.saarth@gmail.com` that:

- connects to Gmail with Google OAuth
- drafts personalized cold emails for internship outreach
- sends approved emails through Gmail
- tracks sent threads, bounce/invalid signals, and replies
- classifies replies into `Needs Reply`, `Yes`, `Maybe`, and `No`
- discovers AI-company leads from public web sources and extracts public contact channels

## Product Shape

The app is a command-center dashboard, not a cluttered admin panel. The default screen shows:

- a left navigation rail for `Activity`, `Leads`, `Replies`, and `Sent`
- a bottom-left settings card where Sarth can update profile, tone, school, accomplishments, and outreach constraints
- a main activity surface with recent reply events, queued drafts, reply-needed items, and send readiness
- tabbed reply sections with Gmail thread links
- a lead table with contact confidence, company type, follow-up date, and outreach state

## UX Direction

- Style: editorial productivity dashboard with clean whitespace, strong typography, and restrained color
- Typography: `Lexend` for headings and navigation, `Source Sans 3` for body/UI text, `IBM Plex Mono` for metadata
- Palette:
  - ink `#0F172A`
  - teal `#0D9488`
  - warm accent `#EA580C`
  - mist background `#F0FDFA`
  - card `#FFFFFF`
- Motion: subtle fade/slide transitions only, with reduced-motion support
- Density: table-first and thread-first; no marketing clutter and no extra buttons

## Core Screens

### Activity

- Daily send progress
- Gmail connection/watch status
- Recent reply activity
- Draft queue needing approval
- Invalid/bounced address warnings
- Follow-up schedule summary

### Leads

- Table of discovered companies
- Domain, company type, lead source, contact channel, confidence score
- Status chips: `New`, `Queued`, `Sent`, `Replied`, `Invalid`, `Skipped`
- Per-row actions: draft, approve/send, open thread, mark skipped

### Replies

- Tabs: `Needs Reply`, `Yes`, `Maybe`, `No`
- Full latest reply snippet and AI summary
- Gmail deep link for each thread
- Contact and company context beside the thread

### Sent

- Outbound thread history
- Sent date, follow-up date, outcome, and latest thread status

### Settings

- Full name
- school and district
- location and remote preference
- summer availability notes
- accomplishments, trading/website/tabla notes
- tone controls
- outreach guardrails
- daily send target and follow-up interval

## Data Model

### Settings

Single profile row for Sarth's outreach identity and preferences.

### Integration State

Single integration row storing:

- authorized Gmail address
- OAuth refresh/access tokens
- watch expiration
- latest Gmail history id
- last sync timestamps

### Companies

One row per company/domain/contact combination with:

- company metadata
- extracted public contact email
- contact type (`founder`, `careers`, `general`, `contact`)
- confidence score
- lead source
- notes

### Threads

One row per outreach thread with:

- Gmail thread id
- subject
- draft/sent content
- latest snippet
- classification
- needs-attention flag
- Gmail thread URL

### Activity Events

Append-only event log for reply arrivals, sends, invalid-address detections, sync actions, and discovery runs.

## Integrations

### Gmail

- Use Google OAuth with Gmail scopes
- Send through Gmail API
- Read sent/inbox threads through Gmail API
- Use Gmail watch + Pub/Sub push notifications for near-real-time sync
- Use daily renewal + backfill route to keep the watch alive

### AI

- Generate company-personalized outreach drafts
- Summarize inbound replies
- Classify replies into workflow buckets
- Recommend follow-up timing and short notes

### Lead Discovery

- Search for AI companies via public web search queries
- Fetch public company/contact pages
- Extract public email channels only
- Score contact credibility instead of guessing private inboxes

## Safety / Guardrails

- No hidden mass-blast behavior
- Draft approval required before send
- Public contact channels only
- Invalid addresses should be downgraded and excluded from resend queues
- Gmail limits and status should be surfaced in the UI

## Technical Approach

- Next.js App Router application
- Single-user experience with Google sign-in restricted to the configured Gmail address
- LibSQL/SQLite-compatible database layer for local development and free cloud deployment via Turso or equivalent
- Route handlers for Gmail webhook, cron renewal, discovery, and send actions
- Server-rendered dashboard with client components for interactive filters/forms

## Assumptions

- This repository starts as a new app in `/Users/sranka/crm2`
- The user already has Google Cloud credentials and can supply env vars later
- V1 should be fully usable in demo mode without live Gmail credentials, while production mode activates when env vars are present
