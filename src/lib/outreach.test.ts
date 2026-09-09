import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasReceivedReply, needsResponse } from "@/lib/outreach";
import type { OutreachThread } from "@/lib/types";

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
