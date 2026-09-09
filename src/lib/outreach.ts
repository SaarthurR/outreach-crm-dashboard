import type { DashboardStats, Lead, OutreachThread } from "@/lib/types";

const SENT_STATUSES = new Set<Lead["status"]>(["sent", "replied"]);

export function buildThreadMap(threads: OutreachThread[]) {
  return new Map(threads.map((thread) => [thread.companyId, thread]));
}

export function isLeadOptedOut(lead: Lead) {
  return lead.status === "skipped";
}

export function isLeadSent(lead: Lead, thread?: OutreachThread) {
  return SENT_STATUSES.has(lead.status) || Boolean(thread?.sentAt);
}

export function isLeadInvalid(lead: Lead) {
  return lead.status === "invalid" || !lead.contactEmail;
}

// A thread in any bucket other than needs_reply means a human (or a bounce) already
// came back. Cold-emailing them again is the worst outcome this app can produce:
// it re-pitches someone who said no, re-pitches a company he already worked at, or
// re-sends to a dead address and burns sender reputation. Checked independently of
// sentAt so a cleared or missing thread timestamp cannot let one through.
const REPLIED_BUCKETS = new Set(["yes", "maybe", "no"]);

export function hasReplied(thread?: OutreachThread) {
  return Boolean(thread && REPLIED_BUCKETS.has(thread.bucket));
}

/**
 * A thread's bucket alone can't tell "just sent, nothing back yet" apart from "a
 * reply came in but couldn't be read as yes/no/maybe" — both leave bucket at
 * needs_reply. The timestamp can: a real reply moves lastMessageAt well past sentAt.
 * Shared by the Replies/Waiting split and the Inbox reply count so they never disagree.
 */
export function hasReceivedReply(thread: OutreachThread) {
  if (thread.bucket !== "needs_reply") return true;
  if (!thread.sentAt) return false;
  return new Date(thread.lastMessageAt).getTime() > new Date(thread.sentAt).getTime() + 60_000;
}

/**
 * A reply came in, and Saarth hasn't sent a follow-up since. respondedAt is only set
 * when sync detects a message FROM Saarth in the thread (not the original cold email,
 * which never counts as "responding" to a reply that hadn't arrived yet) — see
 * ingestGmailMessage's self-branch in gmail.ts. Once respondedAt catches up to
 * lastMessageAt, this flips false on its own; a fresh reply moves lastMessageAt past
 * it again, so it flips back true with no extra bookkeeping.
 */
export function needsResponse(thread: OutreachThread) {
  // A bounce has no one on the other end to respond to.
  if (thread.bucket === "bounced") return false;
  if (!hasReceivedReply(thread)) return false;
  if (!thread.respondedAt) return true;
  return new Date(thread.respondedAt).getTime() < new Date(thread.lastMessageAt).getTime();
}

/**
 * Domains that already came back, from ANY row. The lead list holds several rows per
 * company (different inboxes at the same place), so a reply recorded against one row
 * leaves its siblings looking untouched. Frizzle and the Robotics Center, where Saarth
 * actually interned, each sit in the list twice.
 */
export function buildRepliedDomains(leads: Lead[], threads: OutreachThread[]) {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const domains = new Set<string>();

  for (const thread of threads) {
    const domain = leadById.get(thread.companyId)?.domain?.toLowerCase();
    if (domain && (hasReplied(thread) || thread.sentAt)) {
      domains.add(domain);
    }
  }

  return domains;
}

export function isLeadSendable(lead: Lead, thread?: OutreachThread) {
  return (
    !isLeadSent(lead, thread) &&
    !hasReplied(thread) &&
    !isLeadOptedOut(lead) &&
    !isLeadInvalid(lead)
  );
}

export function countSentToday(threads: OutreachThread[], today = new Date().toISOString().slice(0, 10)) {
  return threads.filter((thread) => thread.sentAt?.slice(0, 10) === today).length;
}

export function buildDashboardStats(
  leads: Lead[],
  threads: OutreachThread[],
  dailyCap = 0,
): DashboardStats {
  const threadMap = buildThreadMap(threads);
  const sentToday = countSentToday(threads);

  return {
    unsentLeads: leads.filter((lead) => !isLeadSent(lead, threadMap.get(lead.id))).length,
    sendableLeads: leads.filter((lead) => isLeadSendable(lead, threadMap.get(lead.id))).length,
    optedOut: leads.filter(isLeadOptedOut).length,
    emailsSent: leads.filter((lead) => isLeadSent(lead, threadMap.get(lead.id))).length,
    dailyCap,
    sentToday,
    remainingToday: Math.max(0, dailyCap - sentToday),
  };
}

export function sortLeadsForWorkspace(leads: Lead[], threads: OutreachThread[]) {
  const threadMap = buildThreadMap(threads);

  return [...leads].sort((left, right) => {
    const leftThread = threadMap.get(left.id);
    const rightThread = threadMap.get(right.id);

    const leftSendable = isLeadSendable(left, leftThread);
    const rightSendable = isLeadSendable(right, rightThread);
    if (leftSendable !== rightSendable) {
      return leftSendable ? -1 : 1;
    }

    const leftOptedOut = isLeadOptedOut(left);
    const rightOptedOut = isLeadOptedOut(right);
    if (leftOptedOut !== rightOptedOut) {
      return leftOptedOut ? 1 : -1;
    }

    return right.confidence - left.confidence;
  });
}

export function getUnsentLeads(leads: Lead[], threads: OutreachThread[]) {
  const threadMap = buildThreadMap(threads);

  return sortLeadsForWorkspace(leads, threads).filter((lead) => !isLeadSent(lead, threadMap.get(lead.id)));
}

export function getSentThreads(threads: OutreachThread[]) {
  return threads.filter((thread) => thread.sentAt);
}

export function getBulkSendLeadIds(leads: Lead[], threads: OutreachThread[], requestedLeadIds?: string[]) {
  const threadMap = buildThreadMap(threads);
  const fallbackIds = leads.map((lead) => lead.id);
  const seen = new Set<string>();
  const orderedIds = (requestedLeadIds?.length ? requestedLeadIds : fallbackIds).filter((leadId) => {
    if (seen.has(leadId)) {
      return false;
    }

    seen.add(leadId);
    return true;
  });

  return orderedIds.filter((leadId) => {
    const lead = leads.find((entry) => entry.id === leadId);
    return lead ? isLeadSendable(lead, threadMap.get(lead.id)) : false;
  });
}

export function getLeadEligibilityReason(lead: Lead, thread?: OutreachThread) {
  if (isLeadSent(lead, thread)) {
    return "Already sent";
  }

  if (hasReplied(thread)) {
    return "Already replied, never cold-email again";
  }

  if (isLeadOptedOut(lead)) {
    return "Opted out";
  }

  if (lead.status === "invalid") {
    return "Needs a safer email";
  }

  return "Ready to send";
}
