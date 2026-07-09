import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profileSettings = sqliteTable("profile_settings", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  firstName: text("first_name").notNull(),
  schoolName: text("school_name").notNull(),
  districtName: text("district_name").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  targetSeason: text("target_season").notNull(),
  remotePreference: text("remote_preference").notNull(),
  internshipPreference: text("internship_preference").notNull(),
  availabilityNotes: text("availability_notes").notNull(),
  tone: text("tone").notNull(),
  accomplishments: text("accomplishments").notNull(),
  skills: text("skills").notNull(),
  closingNotes: text("closing_notes").notNull(),
  dailySendTarget: integer("daily_send_target").notNull(),
  followUpWindowDays: integer("follow_up_window_days").notNull(),
  parentSupport: text("parent_support").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const integrationState = sqliteTable("integration_state", {
  id: text("id").primaryKey(),
  emailAddress: text("email_address"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiryDate: integer("expiry_date", { mode: "number" }),
  historyId: text("history_id"),
  watchExpiration: text("watch_expiration"),
  lastSyncedAt: text("last_synced_at"),
  updatedAt: text("updated_at").notNull(),
});

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  companyName: text("company_name").notNull(),
  website: text("website").notNull(),
  domain: text("domain").notNull(),
  companyType: text("company_type").notNull(),
  location: text("location").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name"),
  contactType: text("contact_type").notNull(),
  source: text("source").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status").notNull(),
  followUpDate: text("follow_up_date"),
  notes: text("notes").notNull(),
  lastThreadId: text("last_thread_id"),
  updatedAt: text("updated_at").notNull(),
});

export const outreachThreads = sqliteTable("outreach_threads", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  companyName: text("company_name").notNull(),
  gmailThreadId: text("gmail_thread_id"),
  subject: text("subject").notNull(),
  latestSnippet: text("latest_snippet").notNull(),
  gmailThreadUrl: text("gmail_thread_url"),
  bucket: text("bucket").notNull(),
  needsAttention: integer("needs_attention", { mode: "boolean" }).notNull(),
  draftStatus: text("draft_status").notNull(),
  lastMessageAt: text("last_message_at").notNull(),
  sentAt: text("sent_at"),
  draftBody: text("draft_body").notNull(),
  lastReplySummary: text("last_reply_summary").notNull(),
  outcomeLabel: text("outcome_label").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const activityEvents = sqliteTable("activity_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  occurredAt: text("occurred_at").notNull(),
  companyName: text("company_name"),
});
