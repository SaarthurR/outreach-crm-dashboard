import { randomUUID } from "node:crypto";

import { desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  activityEvents,
  companies,
  integrationState,
  outreachThreads,
  profileSettings,
} from "@/lib/db/schema";
import { demoIntegration, demoThreads, demoLeads, defaultSettings } from "@/lib/seed-data";
import type {
  ActivityEvent,
  DashboardData,
  IntegrationStatus,
  Lead,
  OutreachThread,
  ProfileSettings,
} from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

let seedPromise: Promise<void> | null = null;

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function serializeStringArray(value: string[]) {
  return JSON.stringify(value);
}

function mapSettings(row: typeof profileSettings.$inferSelect): ProfileSettings {
  return {
    id: row.id,
    fullName: row.fullName,
    firstName: row.firstName,
    schoolName: row.schoolName,
    districtName: row.districtName,
    city: row.city,
    state: row.state,
    targetSeason: row.targetSeason,
    remotePreference: row.remotePreference,
    internshipPreference: row.internshipPreference,
    availabilityNotes: row.availabilityNotes,
    tone: row.tone,
    accomplishments: parseStringArray(row.accomplishments),
    skills: parseStringArray(row.skills),
    closingNotes: row.closingNotes,
    dailySendTarget: row.dailySendTarget,
    followUpWindowDays: row.followUpWindowDays,
    parentSupport: row.parentSupport,
  };
}

function mapIntegration(row: typeof integrationState.$inferSelect | undefined): IntegrationStatus {
  if (!row) {
    return demoIntegration;
  }

  return {
    connected: Boolean(row.refreshToken || row.accessToken),
    emailAddress: row.emailAddress,
    watchExpiresAt: row.watchExpiration,
    lastSyncedAt: row.lastSyncedAt,
    mode: row.refreshToken ? "live" : "demo",
  };
}

function mapLead(row: typeof companies.$inferSelect): Lead {
  return {
    id: row.id,
    companyName: row.companyName,
    website: row.website,
    domain: row.domain,
    companyType: row.companyType,
    location: row.location,
    contactEmail: row.contactEmail,
    contactName: row.contactName,
    contactType: row.contactType as Lead["contactType"],
    source: row.source,
    confidence: row.confidence,
    status: row.status as Lead["status"],
    followUpDate: row.followUpDate,
    notes: row.notes,
    lastThreadId: row.lastThreadId,
  };
}

function mapThread(row: typeof outreachThreads.$inferSelect): OutreachThread {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.companyName,
    gmailThreadId: row.gmailThreadId,
    subject: row.subject,
    latestSnippet: row.latestSnippet,
    gmailThreadUrl: row.gmailThreadUrl,
    bucket: row.bucket as OutreachThread["bucket"],
    needsAttention: row.needsAttention,
    draftStatus: row.draftStatus as OutreachThread["draftStatus"],
    lastMessageAt: row.lastMessageAt,
    sentAt: row.sentAt,
    draftBody: row.draftBody,
    lastReplySummary: row.lastReplySummary,
    outcomeLabel: row.outcomeLabel,
  };
}

function mapActivity(row: typeof activityEvents.$inferSelect): ActivityEvent {
  return {
    id: row.id,
    type: row.type as ActivityEvent["type"],
    title: row.title,
    detail: row.detail,
    occurredAt: row.occurredAt,
    companyName: row.companyName ?? undefined,
  };
}

export async function ensureSeeded() {
  if (seedPromise) {
    await seedPromise;
    return;
  }

  seedPromise = (async () => {
    const db = getDb();
    await db.run(sql`
    CREATE TABLE IF NOT EXISTS profile_settings (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      school_name TEXT NOT NULL,
      district_name TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      target_season TEXT NOT NULL,
      remote_preference TEXT NOT NULL,
      internship_preference TEXT NOT NULL,
      availability_notes TEXT NOT NULL,
      tone TEXT NOT NULL,
      accomplishments TEXT NOT NULL,
      skills TEXT NOT NULL,
      closing_notes TEXT NOT NULL,
      daily_send_target INTEGER NOT NULL,
      follow_up_window_days INTEGER NOT NULL,
      parent_support TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS integration_state (
      id TEXT PRIMARY KEY,
      email_address TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date INTEGER,
      history_id TEXT,
      watch_expiration TEXT,
      last_synced_at TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      website TEXT NOT NULL,
      domain TEXT NOT NULL,
      company_type TEXT NOT NULL,
      location TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      contact_name TEXT,
      contact_type TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      follow_up_date TEXT,
      notes TEXT NOT NULL,
      last_thread_id TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS outreach_threads (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      gmail_thread_id TEXT,
      subject TEXT NOT NULL,
      latest_snippet TEXT NOT NULL,
      gmail_thread_url TEXT,
      bucket TEXT NOT NULL,
      needs_attention INTEGER NOT NULL,
      draft_status TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      sent_at TEXT,
      draft_body TEXT NOT NULL,
      last_reply_summary TEXT NOT NULL,
      outcome_label TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      company_name TEXT
    )
  `);
    const existing = await db.select({ id: profileSettings.id }).from(profileSettings).limit(1);

    if (existing.length > 0) {
      return;
    }

    await db.insert(profileSettings).values({
      id: defaultSettings.id,
      fullName: defaultSettings.fullName,
      firstName: defaultSettings.firstName,
      schoolName: defaultSettings.schoolName,
      districtName: defaultSettings.districtName,
      city: defaultSettings.city,
      state: defaultSettings.state,
      targetSeason: defaultSettings.targetSeason,
      remotePreference: defaultSettings.remotePreference,
      internshipPreference: defaultSettings.internshipPreference,
      availabilityNotes: defaultSettings.availabilityNotes,
      tone: defaultSettings.tone,
      accomplishments: serializeStringArray(defaultSettings.accomplishments),
      skills: serializeStringArray(defaultSettings.skills),
      closingNotes: defaultSettings.closingNotes,
      dailySendTarget: defaultSettings.dailySendTarget,
      followUpWindowDays: defaultSettings.followUpWindowDays,
      parentSupport: defaultSettings.parentSupport,
      updatedAt: nowIso(),
    });

    await db.insert(integrationState).values({
      id: "default",
      emailAddress: demoIntegration.emailAddress,
      accessToken: null,
      refreshToken: null,
      expiryDate: null,
      historyId: null,
      watchExpiration: null,
      lastSyncedAt: null,
      updatedAt: nowIso(),
    });

    await db.insert(companies).values(
      demoLeads.map((lead) => ({
        id: lead.id,
        companyName: lead.companyName,
        website: lead.website,
        domain: lead.domain,
        companyType: lead.companyType,
        location: lead.location,
        contactEmail: lead.contactEmail,
        contactName: lead.contactName,
        contactType: lead.contactType,
        source: lead.source,
        confidence: lead.confidence,
        status: lead.status,
        followUpDate: lead.followUpDate,
        notes: lead.notes,
        lastThreadId: lead.lastThreadId,
        updatedAt: nowIso(),
      })),
    );

    await db.insert(outreachThreads).values(
      demoThreads.map((thread) => ({
        id: thread.id,
        companyId: thread.companyId,
        companyName: thread.companyName,
        gmailThreadId: thread.gmailThreadId,
        subject: thread.subject,
        latestSnippet: thread.latestSnippet,
        gmailThreadUrl: thread.gmailThreadUrl,
        bucket: thread.bucket,
        needsAttention: thread.needsAttention,
        draftStatus: thread.draftStatus,
        lastMessageAt: thread.lastMessageAt,
        sentAt: thread.sentAt,
        draftBody: thread.draftBody,
        lastReplySummary: thread.lastReplySummary,
        outcomeLabel: thread.outcomeLabel,
        updatedAt: nowIso(),
      })),
    );
  })();

  try {
    await seedPromise;
  } finally {
    seedPromise = null;
  }
}

export async function getProfileSettings() {
  await ensureSeeded();
  const db = getDb();
  const [row] = await db.select().from(profileSettings).limit(1);
  return row ? mapSettings(row) : defaultSettings;
}

export async function saveProfileSettings(input: Partial<ProfileSettings>) {
  await ensureSeeded();
  const db = getDb();
  const current = await getProfileSettings();
  const next = {
    ...current,
    ...input,
    accomplishments: input.accomplishments ?? current.accomplishments,
    skills: input.skills ?? current.skills,
  };

  await db
    .update(profileSettings)
    .set({
      fullName: next.fullName,
      firstName: next.firstName,
      schoolName: next.schoolName,
      districtName: next.districtName,
      city: next.city,
      state: next.state,
      targetSeason: next.targetSeason,
      remotePreference: next.remotePreference,
      internshipPreference: next.internshipPreference,
      availabilityNotes: next.availabilityNotes,
      tone: next.tone,
      accomplishments: serializeStringArray(next.accomplishments),
      skills: serializeStringArray(next.skills),
      closingNotes: next.closingNotes,
      dailySendTarget: next.dailySendTarget,
      followUpWindowDays: next.followUpWindowDays,
      parentSupport: next.parentSupport,
      updatedAt: nowIso(),
    })
    .where(eq(profileSettings.id, current.id));

  return next;
}

export async function getIntegrationRow() {
  await ensureSeeded();
  const db = getDb();
  const [row] = await db.select().from(integrationState).limit(1);
  return row;
}

export async function getIntegrationStatus() {
  const row = await getIntegrationRow();
  return mapIntegration(row);
}

export async function saveIntegrationState(
  input: Partial<{
    emailAddress: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    expiryDate: number | null;
    historyId: string | null;
    watchExpiration: string | null;
    lastSyncedAt: string | null;
  }>,
) {
  await ensureSeeded();
  const db = getDb();
  const current = await getIntegrationRow();

  if (!current) {
    return;
  }

  await db
    .update(integrationState)
    .set({
      emailAddress: input.emailAddress ?? current.emailAddress,
      accessToken: input.accessToken ?? current.accessToken,
      refreshToken: input.refreshToken ?? current.refreshToken,
      expiryDate: input.expiryDate ?? current.expiryDate,
      historyId: input.historyId ?? current.historyId,
      watchExpiration: input.watchExpiration ?? current.watchExpiration,
      lastSyncedAt: input.lastSyncedAt ?? current.lastSyncedAt,
      updatedAt: nowIso(),
    })
    .where(eq(integrationState.id, current.id));
}

export async function listLeads() {
  await ensureSeeded();
  const db = getDb();
  const rows = await db.select().from(companies).orderBy(desc(companies.confidence));
  return rows.map(mapLead);
}

export async function findLeadById(leadId: string) {
  await ensureSeeded();
  const db = getDb();
  const [row] = await db.select().from(companies).where(eq(companies.id, leadId)).limit(1);
  return row ? mapLead(row) : null;
}

export async function upsertLeads(leads: Lead[]) {
  await ensureSeeded();
  const db = getDb();

  for (const lead of leads) {
    await db
      .insert(companies)
      .values({
        id: lead.id,
        companyName: lead.companyName,
        website: lead.website,
        domain: lead.domain,
        companyType: lead.companyType,
        location: lead.location,
        contactEmail: lead.contactEmail,
        contactName: lead.contactName,
        contactType: lead.contactType,
        source: lead.source,
        confidence: lead.confidence,
        status: lead.status,
        followUpDate: lead.followUpDate,
        notes: lead.notes,
        lastThreadId: lead.lastThreadId,
        updatedAt: nowIso(),
      })
      .onConflictDoUpdate({
        target: companies.id,
        set: {
          companyName: lead.companyName,
          website: lead.website,
          domain: lead.domain,
          companyType: lead.companyType,
          location: lead.location,
          contactEmail: lead.contactEmail,
          contactName: lead.contactName,
          contactType: lead.contactType,
          source: lead.source,
          confidence: lead.confidence,
          status: lead.status,
          followUpDate: lead.followUpDate,
          notes: lead.notes,
          lastThreadId: lead.lastThreadId,
          updatedAt: nowIso(),
        },
      });
  }

  return listLeads();
}

export async function updateLeadStatus(leadId: string, status: Lead["status"], lastThreadId?: string | null) {
  await ensureSeeded();
  const db = getDb();
  await db
    .update(companies)
    .set({
      status,
      lastThreadId: lastThreadId ?? null,
      updatedAt: nowIso(),
    })
    .where(eq(companies.id, leadId));
}

export async function listThreads() {
  await ensureSeeded();
  const db = getDb();
  const rows = await db.select().from(outreachThreads).orderBy(desc(outreachThreads.lastMessageAt));
  return rows.map(mapThread);
}

export async function findThreadByLeadId(leadId: string) {
  await ensureSeeded();
  const db = getDb();
  const [row] = await db
    .select()
    .from(outreachThreads)
    .where(eq(outreachThreads.companyId, leadId))
    .limit(1);
  return row ? mapThread(row) : null;
}

export async function findThreadByGmailThreadId(gmailThreadId: string) {
  await ensureSeeded();
  const db = getDb();
  const [row] = await db
    .select()
    .from(outreachThreads)
    .where(eq(outreachThreads.gmailThreadId, gmailThreadId))
    .limit(1);
  return row ? mapThread(row) : null;
}

export async function upsertThread(thread: OutreachThread) {
  await ensureSeeded();
  const db = getDb();
  await db
    .insert(outreachThreads)
    .values({
      id: thread.id,
      companyId: thread.companyId,
      companyName: thread.companyName,
      gmailThreadId: thread.gmailThreadId,
      subject: thread.subject,
      latestSnippet: thread.latestSnippet,
      gmailThreadUrl: thread.gmailThreadUrl,
      bucket: thread.bucket,
      needsAttention: thread.needsAttention,
      draftStatus: thread.draftStatus,
      lastMessageAt: thread.lastMessageAt,
      sentAt: thread.sentAt,
      draftBody: thread.draftBody,
      lastReplySummary: thread.lastReplySummary,
      outcomeLabel: thread.outcomeLabel,
      updatedAt: nowIso(),
    })
    .onConflictDoUpdate({
      target: outreachThreads.id,
      set: {
        companyId: thread.companyId,
        companyName: thread.companyName,
        gmailThreadId: thread.gmailThreadId,
        subject: thread.subject,
        latestSnippet: thread.latestSnippet,
        gmailThreadUrl: thread.gmailThreadUrl,
        bucket: thread.bucket,
        needsAttention: thread.needsAttention,
        draftStatus: thread.draftStatus,
        lastMessageAt: thread.lastMessageAt,
        sentAt: thread.sentAt,
        draftBody: thread.draftBody,
        lastReplySummary: thread.lastReplySummary,
        outcomeLabel: thread.outcomeLabel,
        updatedAt: nowIso(),
      },
    });
}

export async function appendActivity(event: Omit<ActivityEvent, "id">) {
  await ensureSeeded();
  const db = getDb();
  const next: ActivityEvent = {
    id: randomUUID(),
    ...event,
  };

  await db.insert(activityEvents).values({
    id: next.id,
    type: next.type,
    title: next.title,
    detail: next.detail,
    occurredAt: next.occurredAt,
    companyName: next.companyName ?? null,
  });

  return next;
}

export async function listActivity() {
  await ensureSeeded();
  const db = getDb();
  const rows = await db.select().from(activityEvents).orderBy(desc(activityEvents.occurredAt)).limit(20);
  return rows.map(mapActivity);
}

export async function getDashboardSnapshot(): Promise<Omit<DashboardData, "stats">> {
  const [settings, integration, leads, threads] = await Promise.all([
    getProfileSettings(),
    getIntegrationStatus(),
    listLeads(),
    listThreads(),
  ]);

  return {
    settings,
    integration,
    leads,
    threads,
  };
}
