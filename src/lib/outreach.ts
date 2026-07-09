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

export function isLeadSendable(lead: Lead, thread?: OutreachThread) {
  return !isLeadSent(lead, thread) && !isLeadOptedOut(lead) && !isLeadInvalid(lead);
}

export function buildDashboardStats(leads: Lead[], threads: OutreachThread[]): DashboardStats {
  const threadMap = buildThreadMap(threads);

  return {
    unsentLeads: leads.filter((lead) => !isLeadSent(lead, threadMap.get(lead.id))).length,
    sendableLeads: leads.filter((lead) => isLeadSendable(lead, threadMap.get(lead.id))).length,
    optedOut: leads.filter(isLeadOptedOut).length,
    emailsSent: leads.filter((lead) => isLeadSent(lead, threadMap.get(lead.id))).length,
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

  if (isLeadOptedOut(lead)) {
    return "Opted out";
  }

  if (lead.status === "invalid") {
    return "Needs a safer email";
  }

  return "Ready to send";
}
