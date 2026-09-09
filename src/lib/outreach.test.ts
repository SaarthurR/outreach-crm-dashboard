import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasReceivedReply, isAlreadyWorkedThere, isLeadSendable, needsResponse } from "@/lib/outreach";
import type { Lead, OutreachThread } from "@/lib/types";

function lead(partial: Partial<Lead>): Lead {
  return {
    id: "l1",
    companyName: "Acme",
    website: "https://acme.example.com",
    domain: "acme.example.com",
    companyType: "Startup",
    location: "",
    contactEmail: "founders@acme.example.com",
    contactName: null,
    contactType: "general",
    source: "test",
    confidence: 0.9,
    status: "new",
    followUpDate: null,
    notes: "",
    lastThreadId: null,
    ...partial,
  };
}

function thread(partial: Partial<OutreachThread>): OutreachThread {
  return {
    id: "t1",
    companyId: "c1",
    companyName: "Acme",
    gmailThreadId: null,
    gmailMessageId: null,
    rfcMessageId: null,
    lastInboundMessageId: null,
    respondedAt: null,
    starred: false,
    subject: "Internship Inquiry",
    latestSnippet: "",
    gmailThreadUrl: null,
    bucket: "needs_reply",
    needsAttention: false,
    draftStatus: "sent",
    lastMessageAt: "2026-09-08T20:00:00.000Z",
    sentAt: "2026-09-08T20:00:00.000Z",
    draftBody: "",
    lastReplySummary: "",
    outcomeLabel: "Sent",
    ...partial,
  };
}

describe("hasReceivedReply", () => {
  it("is false right after a send, before any reply lands", () => {
    assert.equal(hasReceivedReply(thread({})), false);
  });

  it("is true once a later message arrives, even if it couldn't be classified", () => {
    assert.equal(
      hasReceivedReply(
        thread({ sentAt: "2026-09-08T20:00:00.000Z", lastMessageAt: "2026-09-08T20:05:00.000Z" }),
      ),
      true,
    );
  });

  it("is true for any classified bucket regardless of timestamps", () => {
    assert.equal(hasReceivedReply(thread({ bucket: "yes" })), true);
    assert.equal(hasReceivedReply(thread({ bucket: "bounced" })), true);
  });
});

describe("needsResponse", () => {
  it("is false before any reply lands", () => {
    assert.equal(needsResponse(thread({})), false);
  });

  it("is true once a reply lands and nothing has been sent back yet", () => {
    assert.equal(needsResponse(thread({ bucket: "yes" })), true);
  });

  it("is false once Saarth's follow-up lands after their reply", () => {
    assert.equal(
      needsResponse(
        thread({
          bucket: "yes",
          lastMessageAt: "2026-09-08T20:05:00.000Z",
          respondedAt: "2026-09-08T20:10:00.000Z",
        }),
      ),
      false,
    );
  });

  it("is true again once a new reply arrives after Saarth's last follow-up", () => {
    assert.equal(
      needsResponse(
        thread({
          bucket: "yes",
          respondedAt: "2026-09-08T20:10:00.000Z",
          lastMessageAt: "2026-09-08T20:15:00.000Z",
        }),
      ),
      true,
    );
  });

  it("is always false for a bounce — there's no one to respond to", () => {
    assert.equal(needsResponse(thread({ bucket: "bounced" })), false);
  });
});

describe("isAlreadyWorkedThere / isLeadSendable", () => {
  it("blocks Frizzle by domain even under a different display name", () => {
    assert.equal(isAlreadyWorkedThere(lead({ companyName: "Frizzle AI", domain: "frizzle.com" })), true);
  });

  it("blocks DeepAware by name even without a tracked domain", () => {
    assert.equal(
      isAlreadyWorkedThere(lead({ companyName: "DeepAware AI", domain: "deepaware-unknown.example" })),
      true,
    );
  });

  it("leaves an unrelated company sendable", () => {
    assert.equal(isAlreadyWorkedThere(lead({ companyName: "Axiom Vision", domain: "axiomvision.ai" })), false);
  });

  it("keeps a former employer out of isLeadSendable even before anything is sent", () => {
    assert.equal(isLeadSendable(lead({ companyName: "Frizzle", domain: "frizzle.com", status: "new" })), false);
  });
});
