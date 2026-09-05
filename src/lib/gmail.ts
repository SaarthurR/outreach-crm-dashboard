import { google } from "googleapis";

import { classifyReply, generateOutreachDraft } from "@/lib/ai";
import {
  appendActivity,
  findLeadById,
  findThreadByGmailThreadId,
  findThreadByLeadId,
  getIntegrationRow,
  getProfileSettings,
  listLeads,
  listThreads,
  saveIntegrationState,
  updateLeadStatus,
  upsertThread,
} from "@/lib/db/repository";
import { env, isLiveGmailConfigured } from "@/lib/env";
import { buildThreadMap, getLeadEligibilityReason, isLeadSendable } from "@/lib/outreach";
import type { Lead, OutreachThread } from "@/lib/types";

function base64UrlEncode(input: string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildGmailMessage(to: string, subject: string, body: string) {
  return base64UrlEncode(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`);
}

function parseHeader(headers: { name?: string | null; value?: string | null }[] | undefined, name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function extractEmailAddress(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function threadUrl(threadId: string | null) {
  return threadId ? `https://mail.google.com/mail/u/0/#inbox/${threadId}` : null;
}

async function getOauthClient() {
  const integration = await getIntegrationRow();
  if (!integration || !integration.refreshToken || !env.googleClientId || !env.googleClientSecret) {
    return null;
  }

  const oauth2 = new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.nextAuthUrl ? `${env.nextAuthUrl}/api/auth/callback/google` : undefined,
  );

  oauth2.setCredentials({
    access_token: integration.accessToken ?? undefined,
    refresh_token: integration.refreshToken ?? undefined,
    expiry_date: integration.expiryDate ?? undefined,
  });

  return oauth2;
}

async function getGmailClient() {
  const auth = await getOauthClient();
  if (!auth) {
    return null;
  }

  return google.gmail({
    version: "v1",
    auth,
  });
}

async function ensureDraft(lead: Lead, force = false) {
  const existing = await findThreadByLeadId(lead.id);
  if (!force && existing?.draftBody) {
    return existing;
  }

  const settings = await getProfileSettings();
  const draft = await generateOutreachDraft(lead, settings);
  const next: OutreachThread = {
    id: existing?.id ?? `thread-${lead.id}`,
    companyId: lead.id,
    companyName: lead.companyName,
    gmailThreadId: existing?.gmailThreadId ?? null,
    subject: draft.subject,
    latestSnippet: "Draft ready. Waiting for approval.",
    gmailThreadUrl: existing?.gmailThreadUrl ?? null,
    bucket: existing?.bucket ?? "needs_reply",
    needsAttention: existing?.needsAttention ?? false,
    draftStatus: "ready",
    lastMessageAt: new Date().toISOString(),
    sentAt: existing?.sentAt ?? null,
    draftBody: draft.body,
    lastReplySummary: existing?.lastReplySummary ?? draft.personalization,
    outcomeLabel: "Ready to send",
  };

  await upsertThread(next);
  await updateLeadStatus(lead.id, "queued", next.id);
  await appendActivity({
    type: "draft_ready",
    title: `Draft ready for ${lead.companyName}`,
    detail: draft.followUpNote,
    occurredAt: new Date().toISOString(),
    companyName: lead.companyName,
  });

  return next;
}

export async function generateAndStoreDraft(leadId: string, force = false) {
  const lead = await findLeadById(leadId);
  if (!lead) {
    throw new Error("Lead not found");
  }

  return ensureDraft(lead, force);
}

export async function generateAndStoreDraftBatch(leadIds?: string[]) {
  const [leads, threads] = await Promise.all([listLeads(), listThreads()]);
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
  const threadMap = buildThreadMap(threads);
  const requestedIds = leadIds?.length ? leadIds : leads.map((lead) => lead.id);
  const seen = new Set<string>();
  const results: Array<{
    leadId: string;
    companyName: string;
    status: "ready" | "skipped";
    reason: string;
  }> = [];

  for (const leadId of requestedIds) {
    if (seen.has(leadId)) {
      continue;
    }

    seen.add(leadId);

    const lead = leadMap.get(leadId);
    if (!lead) {
      results.push({
        leadId,
        companyName: "Unknown company",
        status: "skipped",
        reason: "Lead not found",
      });
      continue;
    }

    const thread = threadMap.get(lead.id);
    if (!isLeadSendable(lead, thread)) {
      results.push({
        leadId: lead.id,
        companyName: lead.companyName,
        status: "skipped",
        reason: getLeadEligibilityReason(lead, thread),
      });
      continue;
    }

    await ensureDraft(lead);
    results.push({
      leadId: lead.id,
      companyName: lead.companyName,
      status: "ready",
      reason: "Draft ready",
    });
  }

  return {
    readyCount: results.filter((result) => result.status === "ready").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    results,
  };
}

export async function sendOutreachEmail(leadId: string) {
  const lead = await findLeadById(leadId);
  if (!lead) {
    throw new Error("Lead not found");
  }

  const draft = await ensureDraft(lead, true);
  const now = new Date().toISOString();

  if (!isLiveGmailConfigured()) {
    // Demo mode: record the send locally and make no Gmail call, so the dashboard
    // is usable (and testable) without Google credentials.
    const demoThread: OutreachThread = {
      ...draft,
      draftStatus: "sent",
      latestSnippet: "Demo mode. No email was actually sent.",
      outcomeLabel: "Sent (demo)",
      sentAt: now,
      lastMessageAt: now,
    };

    await upsertThread(demoThread);
    await updateLeadStatus(lead.id, "sent", demoThread.id);
    await appendActivity({
      type: "thread_sent",
      title: `Demo send to ${lead.companyName}`,
      detail: `Would have gone to ${lead.contactEmail}`,
      occurredAt: now,
      companyName: lead.companyName,
    });

    return { mode: "demo" as const, thread: demoThread };
  }

  const gmail = await getGmailClient();
  if (!gmail) {
    throw new Error("Gmail client unavailable. Re-authenticate to send emails.");
  }

  const raw = buildGmailMessage(lead.contactEmail, draft.subject, draft.draftBody);
  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
    },
  });

  const nextThreadId = response.data.threadId ?? draft.gmailThreadId ?? draft.id;
  const thread: OutreachThread = {
    ...draft,
    gmailThreadId: nextThreadId,
    gmailThreadUrl: threadUrl(nextThreadId),
    draftStatus: "sent",
    latestSnippet: "Message sent through Gmail.",
    outcomeLabel: "Sent",
    sentAt: now,
    lastMessageAt: now,
  };

  await upsertThread(thread);
  await updateLeadStatus(lead.id, "sent", thread.id);
  await appendActivity({
    type: "thread_sent",
    title: `Sent outreach to ${lead.companyName}`,
    detail: `Sent to ${lead.contactEmail}`,
    occurredAt: now,
    companyName: lead.companyName,
  });

  return {
    mode: "live" as const,
    thread,
  };
}

// Gmail spam-flags a personal account that fires a burst of near-identical mail.
// The April/May 2026 run sent 167, 250 and 189 in single days and got filtered.
// ponytail: fixed jittered gap, swap for a real scheduler if sending moves off a single click.
const SEND_GAP_MS = 8_000;
const SEND_JITTER_MS = 12_000;

function sentTodayCount(threads: OutreachThread[]) {
  const today = new Date().toISOString().slice(0, 10);
  return threads.filter((thread) => thread.sentAt?.slice(0, 10) === today).length;
}

export async function sendOutreachBatch(leadIds?: string[]) {
  const [leads, threads, settings] = await Promise.all([listLeads(), listThreads(), getProfileSettings()]);
  const dailyCap = Math.max(1, settings.dailySendTarget);
  let remainingToday = Math.max(0, dailyCap - sentTodayCount(threads));
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
  const threadMap = buildThreadMap(threads);
  const requestedIds = leadIds?.length ? leadIds : leads.map((lead) => lead.id);
  const seen = new Set<string>();
  const results: Array<{
    leadId: string;
    companyName: string;
    status: "sent" | "skipped";
    reason: string;
  }> = [];

  for (const leadId of requestedIds) {
    if (seen.has(leadId)) {
      continue;
    }

    seen.add(leadId);

    const lead = leadMap.get(leadId);
    if (!lead) {
      results.push({
        leadId,
        companyName: "Unknown company",
        status: "skipped",
        reason: "Lead not found",
      });
      continue;
    }

    const thread = threadMap.get(lead.id);
    if (!isLeadSendable(lead, thread)) {
      results.push({
        leadId: lead.id,
        companyName: lead.companyName,
        status: "skipped",
        reason: getLeadEligibilityReason(lead, thread),
      });
      continue;
    }

    if (remainingToday <= 0) {
      results.push({
        leadId: lead.id,
        companyName: lead.companyName,
        status: "skipped",
        reason: `Daily send cap of ${dailyCap} reached. Queued for tomorrow.`,
      });
      continue;
    }

    if (results.some((result) => result.status === "sent")) {
      await new Promise((resolve) =>
        setTimeout(resolve, SEND_GAP_MS + Math.random() * SEND_JITTER_MS),
      );
    }

    await sendOutreachEmail(lead.id);
    remainingToday -= 1;
    results.push({
      leadId: lead.id,
      companyName: lead.companyName,
      status: "sent",
      reason: "Sent",
    });
  }

  return {
    dailyCap,
    remainingToday,
    sentCount: results.filter((result) => result.status === "sent").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    results,
  };
}

export async function renewGmailWatch() {
  if (!isLiveGmailConfigured() || !env.gmailPubsubTopic) {
    return {
      mode: "demo" as const,
      renewed: false,
    };
  }

  const gmail = await getGmailClient();
  if (!gmail) {
    return {
      mode: "demo" as const,
      renewed: false,
    };
  }

  const response = await gmail.users.watch({
    userId: "me",
    requestBody: {
      labelIds: ["INBOX"],
      topicName: env.gmailPubsubTopic,
    },
  });

  await saveIntegrationState({
    historyId: response.data.historyId ?? null,
    watchExpiration: response.data.expiration ? new Date(Number(response.data.expiration)).toISOString() : null,
    lastSyncedAt: new Date().toISOString(),
  });

  await appendActivity({
    type: "watch_renewed",
    title: "Gmail watch renewed",
    detail: "Push sync channel has been refreshed.",
    occurredAt: new Date().toISOString(),
  });

  return {
    mode: "live" as const,
    renewed: true,
    historyId: response.data.historyId ?? null,
  };
}

async function syncMessage(gmailThreadId: string, snippet: string, fromHeader: string | null, subject: string | null, internalDate?: string | null) {
  const existing = await findThreadByGmailThreadId(gmailThreadId);
  // Only process replies to threads we actually sent — ignore unrelated inbox mail.
  if (!existing) {
    return null;
  }
  const companyName = existing.companyName;
  const classification = await classifyReply(
    {
      subject: subject ?? existing?.subject ?? "Inbox reply",
      companyName,
    },
    snippet,
  );

  const thread: OutreachThread = {
    id: existing.id,
    companyId: existing.companyId,
    companyName,
    gmailThreadId,
    subject: existing.subject,
    latestSnippet: snippet,
    gmailThreadUrl: threadUrl(gmailThreadId),
    bucket: classification.bucket,
    needsAttention: classification.bucket !== "no",
    draftStatus: existing.draftStatus,
    lastMessageAt: internalDate ? new Date(Number(internalDate)).toISOString() : new Date().toISOString(),
    sentAt: existing.sentAt,
    draftBody: existing.draftBody,
    lastReplySummary: classification.summary,
    outcomeLabel:
      classification.bucket === "yes"
        ? "Positive reply"
        : classification.bucket === "maybe"
          ? "Maybe / redirect"
          : classification.bucket === "no"
            ? "No"
            : "Needs reply",
  };

  await upsertThread(thread);
  await appendActivity({
    type: "reply_received",
    title: `${companyName} replied`,
    detail: classification.summary,
    occurredAt: new Date().toISOString(),
    companyName,
  });

  return thread;
}

export async function syncInboxReplies(historyId?: string | null) {
  if (!isLiveGmailConfigured()) {
    return {
      mode: "demo" as const,
      synced: 0,
    };
  }

  const gmail = await getGmailClient();
  const integration = await getIntegrationRow();

  if (!gmail || !integration) {
    return {
      mode: "demo" as const,
      synced: 0,
    };
  }

  let synced = 0;

  try {
    if (historyId || integration.historyId) {
      const response = await gmail.users.history.list({
        userId: "me",
        startHistoryId: historyId ?? integration.historyId ?? undefined,
        historyTypes: ["messageAdded"],
        maxResults: 20,
      });

      for (const history of response.data.history ?? []) {
        for (const entry of history.messagesAdded ?? []) {
          const message = entry.message;
          if (!message?.id || !message.threadId) {
            continue;
          }

          const details = await gmail.users.messages.get({
            userId: "me",
            id: message.id,
            format: "metadata",
            metadataHeaders: ["From", "Subject"],
          });

          const fromHeader = parseHeader(details.data.payload?.headers, "From");
          const fromEmail = extractEmailAddress(fromHeader);
          if (fromEmail === env.authorizedGmailAddress) {
            continue;
          }

          await syncMessage(
            message.threadId,
            details.data.snippet ?? "New reply received.",
            fromHeader,
            parseHeader(details.data.payload?.headers, "Subject"),
            details.data.internalDate,
          );
          synced += 1;
        }
      }

      await saveIntegrationState({
        historyId: response.data.historyId ?? integration.historyId,
        lastSyncedAt: new Date().toISOString(),
      });

      return {
        mode: "live" as const,
        synced,
      };
    }
  } catch {
    // Fall through to inbox sampling.
  }

  const inbox = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["INBOX"],
    maxResults: 10,
  });

  for (const message of inbox.data.messages ?? []) {
    if (!message.id || !message.threadId) {
      continue;
    }

    const details = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject"],
    });

    const fromHeader = parseHeader(details.data.payload?.headers, "From");
    const fromEmail = extractEmailAddress(fromHeader);
    if (fromEmail === env.authorizedGmailAddress) {
      continue;
    }

    await syncMessage(
      message.threadId,
      details.data.snippet ?? "New reply received.",
      fromHeader,
      parseHeader(details.data.payload?.headers, "Subject"),
      details.data.internalDate,
    );
    synced += 1;
  }

  await saveIntegrationState({
    lastSyncedAt: new Date().toISOString(),
  });

  return {
    mode: "live" as const,
    synced,
  };
}

export async function backfillReplies() {
  if (!isLiveGmailConfigured()) {
    return { mode: "demo" as const, checked: 0, found: 0 };
  }

  const gmail = await getGmailClient();
  if (!gmail) {
    return { mode: "demo" as const, checked: 0, found: 0 };
  }

  const threads = await listThreads();
  const candidates = threads.filter(
    (t) => t.draftStatus === "sent" && t.gmailThreadId && t.latestSnippet === "Message sent through Gmail.",
  );

  let checked = 0;
  let found = 0;

  for (const thread of candidates) {
    try {
      const gmailThread = await gmail.users.threads.get({
        userId: "me",
        id: thread.gmailThreadId!,
        format: "metadata",
        metadataHeaders: ["From", "Subject"],
      });

      const messages = gmailThread.data.messages ?? [];
      // Find the most recent message not sent by us
      const reply = [...messages].reverse().find((msg) => {
        const from = parseHeader(msg.payload?.headers, "From");
        const fromEmail = extractEmailAddress(from);
        return fromEmail !== env.authorizedGmailAddress;
      });

      checked++;

      if (reply) {
        const from = parseHeader(reply.payload?.headers, "From");
        const subject = parseHeader(reply.payload?.headers, "Subject");
        await syncMessage(
          thread.gmailThreadId!,
          reply.snippet ?? "Reply received.",
          from,
          subject,
          reply.internalDate,
        );
        found++;
      }
    } catch {
      // Skip threads that can't be fetched (deleted, permission issues, etc.)
    }
  }

  await saveIntegrationState({ lastSyncedAt: new Date().toISOString() });

  return { mode: "live" as const, checked, found };
}
