export type NavView = "unsent" | "sent" | "replies";

export type ReplyBucket = "needs_reply" | "yes" | "maybe" | "no";

export type ContactType = "founder" | "careers" | "general" | "contact";

export type LeadStatus =
  | "new"
  | "queued"
  | "sent"
  | "replied"
  | "invalid"
  | "skipped";

export type DraftStatus = "idle" | "generating" | "ready" | "sent";

export type ActivityType =
  | "reply_received"
  | "draft_ready"
  | "lead_discovered"
  | "thread_sent"
  | "invalid_address"
  | "watch_renewed";

export interface ProfileSettings {
  id: string;
  fullName: string;
  firstName: string;
  schoolName: string;
  districtName: string;
  city: string;
  state: string;
  targetSeason: string;
  remotePreference: string;
  internshipPreference: string;
  availabilityNotes: string;
  tone: string;
  accomplishments: string[];
  skills: string[];
  closingNotes: string;
  dailySendTarget: number;
  followUpWindowDays: number;
  parentSupport: string;
}

export interface IntegrationStatus {
  connected: boolean;
  emailAddress: string | null;
  watchExpiresAt: string | null;
  lastSyncedAt: string | null;
  mode: "demo" | "live";
}

export interface Lead {
  id: string;
  companyName: string;
  website: string;
  domain: string;
  companyType: string;
  location: string;
  contactEmail: string;
  contactName: string | null;
  contactType: ContactType;
  source: string;
  confidence: number;
  status: LeadStatus;
  followUpDate: string | null;
  notes: string;
  lastThreadId: string | null;
}

export interface OutreachThread {
  id: string;
  companyId: string;
  companyName: string;
  gmailThreadId: string | null;
  subject: string;
  latestSnippet: string;
  gmailThreadUrl: string | null;
  bucket: ReplyBucket;
  needsAttention: boolean;
  draftStatus: DraftStatus;
  lastMessageAt: string;
  sentAt: string | null;
  draftBody: string;
  lastReplySummary: string;
  outcomeLabel: string;
}

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  title: string;
  detail: string;
  occurredAt: string;
  companyName?: string;
}

export interface DashboardStats {
  unsentLeads: number;
  sendableLeads: number;
  optedOut: number;
  emailsSent: number;
  /** Daily send budget, so the UI can never promise more than the sender will do. */
  dailyCap: number;
  sentToday: number;
  remainingToday: number;
}

export interface DashboardData {
  settings: ProfileSettings;
  integration: IntegrationStatus;
  stats: DashboardStats;
  leads: Lead[];
  threads: OutreachThread[];
}

export interface DraftRequestPayload {
  leadId: string;
}

export interface DiscoveryRequestPayload {
  query?: string;
  limit?: number;
}
