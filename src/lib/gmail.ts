import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { google } from "googleapis";

import { classifyReply, generateOutreachDraft } from "@/lib/ai";
import {
  appendActivity,
  findLeadById,
  findThreadById,
  findThreadByLeadId,
  getIntegrationRow,
  getProfileSettings,
  hasSeenInbound,
  listLeads,
  listOutboundCandidates,
  listThreads,
  markInboundSeen,
  markThreadResponded,
  saveIntegrationState,
  updateLeadStatus,
  upsertThread,
} from "@/lib/db/repository";
import { env, isLiveGmailConfigured } from "@/lib/env";
import { connectionFor } from "@/lib/draft-personalization";
import {
  buildRepliedDomains,
  buildThreadMap,
  getLeadEligibilityReason,
  isLeadSendable,
} from "@/lib/outreach";
import {
  decodeHtmlEntities,
  extractBouncedRecipient,
  extractEmailAddress,
  isBounceMessage,
  matchByFallback,
  matchByGmailThreadId,
  normalizeMessageId,
  resolveOutboundThread,
} from "@/lib/reply-match";
import type { Lead, OutreachThread } from "@/lib/types";

function base64UrlEncode(input: string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A text/plain message renders in Gmail as a narrow fixed-width column with the
 * sender's own line breaks baked in. Sending multipart/alternative lets the HTML
 * part reflow to the reader's window, and turns the address and phone number into
 * real anchors rather than bare text Gmail rewrites through a redirect.
 */
function buildHtmlBody(body: string) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n").map((line) => {
        const safe = escapeHtml(line);
        if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(line.trim())) {
          return `<a href="mailto:${escapeHtml(line.trim())}">${safe}</a>`;
        }
        if (/^\+?[\d ()-]{9,}$/.test(line.trim())) {
          return `<a href="tel:${line.replace(/[^+\d]/g, "")}">${safe}</a>`;
        }
        if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(line.trim()) && !line.includes("@")) {
          return `<a href="https://${line.trim()}">${safe}</a>`;
        }
        return safe;
      });
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("\n");

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#202124">\n${paragraphs}\n</div>`;
}

/**
 * The resume, read once and cached. Missing or unreadable means the email still goes
 * out without it: a send is worth more than an attachment, and a throw here would take
 * down the whole batch.
 */
let cachedAttachment: { filename: string; base64: string } | null | undefined;

function getResumeAttachment() {
  if (cachedAttachment !== undefined) {
    return cachedAttachment;
  }

  const path = env.resumePath ?? resolve(process.cwd(), "assets/Saarth-Ranka-Resume.pdf");

  try {
    const bytes = readFileSync(path);
    cachedAttachment = {
      filename: basename(path),
      base64: bytes.toString("base64").replace(/(.{76})/g, "$1\r\n"),
    };
  } catch {
    cachedAttachment = null;
  }

  return cachedAttachment;
}

function buildGmailMessage(to: string, subject: string, body: string, includeAttachment = true) {
  const boundary = `b_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const encodedSubject = `=?utf-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;

  const attachment = includeAttachment ? getResumeAttachment() : null;
  const altParts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(buildHtmlBody(body), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    "",
    `--${boundary}--`,
    "",
  ];

  if (!attachment) {
    return base64UrlEncode(
      [
        `To: ${to}`,
        `Subject: ${encodedSubject}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        ...altParts,
      ].join("\r\n"),
    );
  }

  // multipart/mixed wrapping the alternative part, so the resume rides along without
  // costing the reader the formatted body.
  const outer = `m_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  return base64UrlEncode(
    [
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${outer}"`,
      "",
      `--${outer}`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      ...altParts,
      "",
      `--${outer}`,
      `Content-Type: application/pdf; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      attachment.base64,
      "",
      `--${outer}--`,
      "",
    ].join("\r\n"),
  );
}

function parseHeader(headers: { name?: string | null; value?: string | null }[] | undefined, name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

type MessagePart = { mimeType?: string | null; body?: { data?: string | null } | null; parts?: MessagePart[] | null };

/** Depth-first search for the first text part. Good enough for a bounce's plain-language explanation. */
function extractBodyText(payload: MessagePart | null | undefined): string {
  if (!payload) return "";
  if (payload.mimeType?.startsWith("text/") && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  for (const part of payload.parts ?? []) {
    const text = extractBodyText(part);
    if (text) return text;
  }
  return "";
}

function threadUrl(threadId: string | null) {
  return threadId ? `https://mail.google.com/mail/u/0/#inbox/${threadId}` : null;
}

function emptyThreadIds(partial?: Partial<OutreachThread>): Pick<
  OutreachThread,
  "gmailMessageId" | "rfcMessageId" | "lastInboundMessageId" | "respondedAt" | "starred"
> {
  return {
    gmailMessageId: partial?.gmailMessageId ?? null,
    rfcMessageId: partial?.rfcMessageId ?? null,
    lastInboundMessageId: partial?.lastInboundMessageId ?? null,
    respondedAt: partial?.respondedAt ?? null,
    starred: partial?.starred ?? false,
  };
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
    ...emptyThreadIds(existing ?? undefined),
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
  // Send the companies Saarth has a real thread to first. Under a daily cap the
  // queue order decides who actually gets emailed this week, so the strongest
  // emails should not sit behind 227 generic ones.
  const requestedIds = leadIds?.length
    ? leadIds
    : [...leads]
        .sort((left, right) => {
          const leftStrong = connectionFor(left.notes, left).strength === "strong" ? 0 : 1;
          const rightStrong = connectionFor(right.notes, right).strength === "strong" ? 0 : 1;
          return leftStrong - rightStrong || right.confidence - left.confidence;
        })
        .map((lead) => lead.id);
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
    const demoMessageId = `demo-${lead.id}-${Date.now()}`;
    const demoThread: OutreachThread = {
      ...draft,
      gmailMessageId: demoMessageId,
      rfcMessageId: `${demoMessageId}@demo.local`,
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

  const gmailMessageId = response.data.id ?? null;
  const nextThreadId = response.data.threadId ?? draft.gmailThreadId ?? draft.id;
  let rfcMessageId: string | null = null;

  if (gmailMessageId) {
    try {
      const sent = await gmail.users.messages.get({
        userId: "me",
        id: gmailMessageId,
        format: "metadata",
        metadataHeaders: ["Message-ID"],
      });
      const rawId = parseHeader(sent.data.payload?.headers, "Message-ID");
      rfcMessageId = rawId ? normalizeMessageId(rawId) : null;
    } catch {
      // Matching can still fall back to email+subject without the RFC id.
    }
  }

  const thread: OutreachThread = {
    ...draft,
    gmailThreadId: nextThreadId,
    gmailMessageId,
    rfcMessageId,
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

// Sends one real draft to an address of your choosing so the formatting can be checked
// in a real inbox. Deliberately does NOT touch lead status, thread state, the daily
// counter or the activity log: a test must not consume a send or mark a company done.
export async function sendTestEmail(to: string, leadId?: string) {
  const address = to.trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(address)) {
    throw new Error(`"${address}" is not a valid email address.`);
  }

  const [leads, threads, settings] = await Promise.all([listLeads(), listThreads(), getProfileSettings()]);
  const threadMap = buildThreadMap(threads);
  const lead = leadId
    ? leads.find((candidate) => candidate.id === leadId)
    : leads.find((candidate) => isLeadSendable(candidate, threadMap.get(candidate.id)));

  if (!lead) {
    throw new Error("No lead available to build a test draft from.");
  }

  const draft = await generateOutreachDraft(lead, settings);
  const subject = `[TEST] ${draft.subject}`;
  const preamble = [
    `This is a test send. The real email would go to ${lead.contactEmail} at ${lead.companyName}.`,
    "Everything below the line is exactly what that company would receive.",
    "",
    "----------------------------------------",
    "",
  ].join("\n");

  if (!isLiveGmailConfigured()) {
    return {
      mode: "demo" as const,
      to: address,
      subject,
      body: `${preamble}${draft.body}`,
      sampleCompany: lead.companyName,
      sampleRecipient: lead.contactEmail,
    };
  }

  const gmail = await getGmailClient();
  if (!gmail) {
    throw new Error("Gmail client unavailable. Reconnect Gmail and try again.");
  }

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: buildGmailMessage(address, subject, `${preamble}${draft.body}`) },
  });

  return {
    mode: "live" as const,
    to: address,
    subject,
    body: `${preamble}${draft.body}`,
    sampleCompany: lead.companyName,
    sampleRecipient: lead.contactEmail,
  };
}

export async function sendOutreachBatch(leadIds?: string[]) {
  const [leads, threads, settings] = await Promise.all([listLeads(), listThreads(), getProfileSettings()]);
  const repliedDomains = buildRepliedDomains(leads, threads);
  const dailyCap = Math.max(1, settings.dailySendTarget);
  let remainingToday = Math.max(0, dailyCap - sentTodayCount(threads));
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
  const threadMap = buildThreadMap(threads);
  // Send the companies Saarth has a real thread to first. Under a daily cap the
  // queue order decides who actually gets emailed this week, so the strongest
  // emails should not sit behind 227 generic ones.
  const requestedIds = leadIds?.length
    ? leadIds
    : [...leads]
        .sort((left, right) => {
          const leftStrong = connectionFor(left.notes, left).strength === "strong" ? 0 : 1;
          const rightStrong = connectionFor(right.notes, right).strength === "strong" ? 0 : 1;
          return leftStrong - rightStrong || right.confidence - left.confidence;
        })
        .map((lead) => lead.id);
  const seen = new Set<string>();
  // The lead list has duplicate rows pointing at the same inbox. Two identical cold
  // emails to one address in one run is the fastest way back into the spam folder.
  const seenAddresses = new Set<string>();
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

    if (repliedDomains.has(lead.domain.toLowerCase())) {
      results.push({
        leadId: lead.id,
        companyName: lead.companyName,
        status: "skipped",
        reason: `Already contacted ${lead.domain} on another address`,
      });
      continue;
    }

    const address = lead.contactEmail.trim().toLowerCase();
    if (seenAddresses.has(address)) {
      results.push({
        leadId: lead.id,
        companyName: lead.companyName,
        status: "skipped",
        reason: `Duplicate address, already sending to ${address} in this run`,
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
    seenAddresses.add(address);
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

async function applyInboundReply(input: {
  gmailMessageId: string;
  gmailThreadId: string;
  snippet: string;
  fromHeader: string | null;
  subject: string | null;
  inReplyTo: string | null;
  references: string | null;
  internalDate?: string | null;
}) {
  const candidates = await listOutboundCandidates();
  const match = resolveOutboundThread({
    fromEmail: extractEmailAddress(input.fromHeader),
    subject: input.subject,
    inReplyTo: input.inReplyTo,
    references: input.references,
    gmailThreadId: input.gmailThreadId,
    candidates,
    ownEmail: env.authorizedGmailAddress,
  });

  if (!match) {
    await markInboundSeen(input.gmailMessageId, null);
    return { status: "unmatched" as const, thread: null };
  }

  const existing = await findThreadById(match.threadId);
  if (!existing) {
    await markInboundSeen(input.gmailMessageId, null);
    return { status: "unmatched" as const, thread: null };
  }

  const classification = classifyReply(
    {
      subject: input.subject ?? existing.subject,
      companyName: existing.companyName,
    },
    input.snippet,
  );

  const thread: OutreachThread = {
    ...existing,
    gmailThreadId: input.gmailThreadId || existing.gmailThreadId,
    gmailThreadUrl: threadUrl(input.gmailThreadId || existing.gmailThreadId),
    lastInboundMessageId: input.gmailMessageId,
    latestSnippet: input.snippet,
    bucket: classification.bucket,
    needsAttention: classification.bucket !== "no",
    lastMessageAt: input.internalDate
      ? new Date(Number(input.internalDate)).toISOString()
      : new Date().toISOString(),
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
  await updateLeadStatus(existing.companyId, "replied", thread.id);
  await markInboundSeen(input.gmailMessageId, thread.id);
  await appendActivity({
    type: "reply_received",
    title: `${existing.companyName} replied`,
    detail: `${classification.summary} (match: ${match.reason})`,
    occurredAt: new Date().toISOString(),
    companyName: existing.companyName,
  });

  return { status: "matched" as const, thread };
}

/**
 * A bounce arrives from a daemon address, not the contact, so it never carries a
 * useful In-Reply-To. The dead recipient's address is only findable in the DSN's
 * plain-language body, so this is the one path that needs a full (not metadata-only)
 * message fetch. Marks the lead invalid rather than "replied" so it's never re-sent
 * to but doesn't read as a real reply.
 */
async function applyBounce(gmail: GmailClient, messageId: string, subject: string | null) {
  const full = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const bodyText = extractBodyText(full.data.payload as MessagePart | undefined);
  const failedAddress = extractBouncedRecipient(bodyText, env.authorizedGmailAddress);

  const candidates = failedAddress ? await listOutboundCandidates() : [];
  const match = failedAddress ? matchByFallback(failedAddress, null, candidates) : null;
  const existing = match ? await findThreadById(match.threadId) : null;

  if (!existing) {
    await markInboundSeen(messageId, null);
    return { status: "unmatched" as const };
  }

  const thread: OutreachThread = {
    ...existing,
    lastInboundMessageId: messageId,
    bucket: "bounced",
    needsAttention: false,
    latestSnippet: failedAddress ? `Bounced: ${failedAddress} does not exist.` : "Bounced: delivery failed.",
    lastMessageAt: new Date().toISOString(),
    lastReplySummary: "Address does not exist. Marked invalid so it's never cold-emailed again.",
    outcomeLabel: "Non-deliverable address",
  };

  await upsertThread(thread);
  await updateLeadStatus(existing.companyId, "invalid", thread.id);
  await markInboundSeen(messageId, thread.id);
  await appendActivity({
    type: "invalid_address",
    title: `${existing.companyName} address bounced`,
    detail: subject ?? "Delivery failed",
    occurredAt: new Date().toISOString(),
    companyName: existing.companyName,
  });

  return { status: "bounced" as const, thread };
}

type GmailClient = NonNullable<Awaited<ReturnType<typeof getGmailClient>>>;

async function ingestGmailMessage(gmail: GmailClient, messageId: string, threadId: string) {
  // Check before spending a Gmail API call: most of what history/inbox sampling
  // hands back on a repeat sync is stuff already processed last time.
  if (await hasSeenInbound(messageId)) {
    return { status: "duplicate" as const };
  }

  const details = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "In-Reply-To", "References", "Message-ID"],
  });

  const fromHeader = parseHeader(details.data.payload?.headers, "From");
  const fromEmail = extractEmailAddress(fromHeader);
  const subject = parseHeader(details.data.payload?.headers, "Subject");

  if (fromEmail && fromEmail === env.authorizedGmailAddress?.trim().toLowerCase()) {
    // A message from Saarth in a known thread is either the original cold email
    // (already accounted for as thread.gmailMessageId) or a follow-up he sent from
    // Gmail itself. Only the latter counts as "responded" — see needsResponse().
    const candidates = await listOutboundCandidates();
    const match = matchByGmailThreadId(threadId, candidates);
    if (match) {
      const existing = await findThreadById(match.threadId);
      if (existing && existing.gmailMessageId !== messageId) {
        const respondedAt = details.data.internalDate
          ? new Date(Number(details.data.internalDate)).toISOString()
          : new Date().toISOString();
        await markThreadResponded(existing.id, respondedAt);
      }
    }
    await markInboundSeen(messageId, match?.threadId ?? null);
    return { status: "self" as const };
  }

  if (isBounceMessage({ fromEmail, subject })) {
    return applyBounce(gmail, messageId, subject);
  }

  return applyInboundReply({
    gmailMessageId: messageId,
    gmailThreadId: threadId,
    snippet: details.data.snippet ? decodeHtmlEntities(details.data.snippet) : "New reply received.",
    fromHeader,
    subject,
    inReplyTo: parseHeader(details.data.payload?.headers, "In-Reply-To"),
    references: parseHeader(details.data.payload?.headers, "References"),
    internalDate: details.data.internalDate,
  });
}

export async function syncInboxReplies(historyId?: string | null) {
  if (!isLiveGmailConfigured()) {
    return {
      mode: "demo" as const,
      synced: 0,
      matched: 0,
      unmatched: 0,
      duplicates: 0,
      bounced: 0,
    };
  }

  const gmail = await getGmailClient();
  const integration = await getIntegrationRow();

  if (!gmail || !integration) {
    return {
      mode: "demo" as const,
      synced: 0,
      matched: 0,
      unmatched: 0,
      duplicates: 0,
      bounced: 0,
    };
  }

  let synced = 0;
  let matched = 0;
  let unmatched = 0;
  let duplicates = 0;
  let bounced = 0;
  const startHistoryId = historyId ?? integration.historyId ?? undefined;
  let newestHistoryId = startHistoryId;

  try {
    if (startHistoryId) {
      let pageToken: string | undefined;
      do {
        const response = await gmail.users.history.list({
          userId: "me",
          startHistoryId,
          historyTypes: ["messageAdded"],
          maxResults: 100,
          pageToken,
        });

        for (const history of response.data.history ?? []) {
          for (const entry of history.messagesAdded ?? []) {
            const message = entry.message;
            if (!message?.id || !message.threadId) continue;

            const result = await ingestGmailMessage(gmail, message.id, message.threadId);
            synced += 1;
            if (result.status === "matched") matched += 1;
            else if (result.status === "unmatched") unmatched += 1;
            else if (result.status === "duplicate") duplicates += 1;
            else if (result.status === "bounced") bounced += 1;
          }
        }

        if (response.data.historyId) {
          newestHistoryId = response.data.historyId;
        }
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      await saveIntegrationState({
        historyId: newestHistoryId ?? integration.historyId,
        lastSyncedAt: new Date().toISOString(),
      });

      return {
        mode: "live" as const,
        synced,
        matched,
        unmatched,
        duplicates,
        bounced,
      };
    }
  } catch {
    // Fall through to inbox sampling when history id is stale/expired.
  }

  // No labelIds: a filter can send a bounce straight to Trash before it ever
  // touches the Inbox, and this cold-start fallback needs to see it anyway.
  const inbox = await gmail.users.messages.list({
    userId: "me",
    q: "in:anywhere",
    maxResults: 50,
  });

  for (const message of inbox.data.messages ?? []) {
    if (!message.id || !message.threadId) continue;
    const result = await ingestGmailMessage(gmail, message.id, message.threadId);
    synced += 1;
    if (result.status === "matched") matched += 1;
    else if (result.status === "unmatched") unmatched += 1;
    else if (result.status === "duplicate") duplicates += 1;
    else if (result.status === "bounced") bounced += 1;
  }

  const profile = await gmail.users.getProfile({ userId: "me" });
  await saveIntegrationState({
    historyId: profile.data.historyId ?? integration.historyId,
    lastSyncedAt: new Date().toISOString(),
  });

  return {
    mode: "live" as const,
    synced,
    matched,
    unmatched,
    duplicates,
    bounced,
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
  const candidates = threads.filter((t) => t.sentAt && t.gmailThreadId);

  let checked = 0;
  let found = 0;

  for (const thread of candidates) {
    try {
      const gmailThread = await gmail.users.threads.get({
        userId: "me",
        id: thread.gmailThreadId!,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "In-Reply-To", "References", "Message-ID"],
      });

      // ingestGmailMessage already branches on self vs. bounce vs. reply, and
      // hasSeenInbound makes an already-processed message a cheap no-op — so just
      // feed it every message in the thread rather than trying to guess which one
      // matters. Picking only "the newest message not from Saarth" used to miss his
      // own follow-ups entirely, since that filter excluded them by definition.
      checked += 1;
      for (const msg of gmailThread.data.messages ?? []) {
        if (!msg.id) continue;
        const result = await ingestGmailMessage(gmail, msg.id, thread.gmailThreadId!);
        if (result.status === "matched" || result.status === "bounced") found += 1;
      }
    } catch {
      // Skip threads that can't be fetched (deleted, permission issues, etc.)
    }
  }

  // A bounce almost never lands in the original sent thread: Gmail gives the
  // failure notice its own thread, so the per-thread pass above can't see it.
  // Search the whole mailbox instead, Trash and Spam included, since a filter
  // can route mailer-daemon mail straight there before it ever reaches Inbox.
  try {
    const bounceSearch = await gmail.users.messages.list({
      userId: "me",
      q: "in:anywhere (from:mailer-daemon OR from:postmaster) newer_than:30d",
      maxResults: 50,
    });

    for (const message of bounceSearch.data.messages ?? []) {
      if (!message.id) continue;
      checked += 1;
      const result = await ingestGmailMessage(gmail, message.id, message.threadId ?? message.id);
      if (result.status === "bounced") found += 1;
    }
  } catch {
    // Search unavailable; the per-thread pass above still ran.
  }

  await saveIntegrationState({ lastSyncedAt: new Date().toISOString() });

  return { mode: "live" as const, checked, found };
}

export type BlastResult = {
  address: string;
  status: "sent" | "failed" | "skipped";
  reason: string;
};

/**
 * Sends one hand-written email, unchanged, to a pasted list of addresses.
 *
 * Deliberately separate from the lead pipeline: no AI, no draft generation, and it
 * touches neither the companies table, the threads table, the activity log nor the
 * daily cap. What it does keep is the jittered gap between sends — the same email
 * going to 40 inboxes back to back is exactly the pattern that got this account
 * filtered before.
 */
export async function sendBlast(input: {
  recipients: string[];
  subject: string;
  body: string;
  attachResume?: boolean;
}) {
  const subject = input.subject.trim();
  const body = input.body.trim();

  if (!input.recipients.length) {
    throw new Error("No valid email addresses were found in the list.");
  }
  if (!subject) {
    throw new Error("A subject is required.");
  }
  if (!body) {
    throw new Error("An email body is required.");
  }

  if (!isLiveGmailConfigured()) {
    return {
      mode: "demo" as const,
      sentCount: 0,
      failedCount: 0,
      results: input.recipients.map<BlastResult>((address) => ({
        address,
        status: "skipped",
        reason: "Demo mode. Connect Gmail to send for real.",
      })),
    };
  }

  const gmail = await getGmailClient();
  if (!gmail) {
    throw new Error("Gmail client unavailable. Reconnect Gmail and try again.");
  }

  const results: BlastResult[] = [];

  for (const address of input.recipients) {
    if (results.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, SEND_GAP_MS + Math.random() * SEND_JITTER_MS),
      );
    }

    try {
      await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: buildGmailMessage(address, subject, body, input.attachResume ?? true),
        },
      });
      results.push({ address, status: "sent", reason: "Sent" });
    } catch (error) {
      // One bad address must not abandon the rest of the list.
      results.push({
        address,
        status: "failed",
        reason: error instanceof Error ? error.message : "Send failed",
      });
    }
  }

  return {
    mode: "live" as const,
    sentCount: results.filter((result) => result.status === "sent").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    results,
  };
}

// Exported for tests only: message assembly has no other seam to check it through.
export const __testables = { buildGmailMessage, buildHtmlBody, getResumeAttachment };
