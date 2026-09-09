import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeHtmlEntities,
  extractBouncedRecipient,
  isBounceMessage,
  matchByFallback,
  matchByHeaders,
  messageIdTokens,
  normalizeMessageId,
  normalizeSubject,
  resolveOutboundThread,
  type OutboundCandidate,
} from "@/lib/reply-match";

function candidate(partial: Partial<OutboundCandidate> & Pick<OutboundCandidate, "id" | "companyId">): OutboundCandidate {
  return {
    contactEmail: "founder@acme.ai",
    subject: "Internship Inquiry",
    sentAt: "2026-09-01T12:00:00.000Z",
    gmailThreadId: "thread-1",
    rfcMessageId: "abc123@mail.gmail.com",
    gmailMessageId: "gmail-1",
    ...partial,
  };
}

describe("normalizeSubject", () => {
  it("strips nested Re/Fwd prefixes", () => {
    assert.equal(normalizeSubject("Re: Fwd: Re: Internship Inquiry"), "internship inquiry");
  });
});

describe("messageIdTokens", () => {
  it("parses angle-bracket and bare ids", () => {
    const ids = messageIdTokens("<a@x.com> <b@y.com>", "c@z.com");
    assert.deepEqual(ids.sort(), ["a@x.com", "b@y.com", "c@z.com"]);
  });
});

describe("matchByHeaders", () => {
  it("matches In-Reply-To to stored rfcMessageId", () => {
    const result = matchByHeaders(
      [normalizeMessageId("<abc123@mail.gmail.com>")],
      [candidate({ id: "t1", companyId: "c1" })],
    );
    assert.deepEqual(result, { threadId: "t1", companyId: "c1", reason: "header" });
  });

  it("returns null when no rfc id matches", () => {
    assert.equal(matchByHeaders(["other@mail.com"], [candidate({ id: "t1", companyId: "c1" })]), null);
  });
});

describe("matchByFallback", () => {
  it("matches same email + subject inside the window", () => {
    const result = matchByFallback(
      "founder@acme.ai",
      "Re: Internship Inquiry",
      [candidate({ id: "t1", companyId: "c1" })],
      new Date("2026-09-08T12:00:00.000Z"),
    );
    assert.deepEqual(result, { threadId: "t1", companyId: "c1", reason: "fallback" });
  });

  it("returns null when multiple distinct threads match", () => {
    const result = matchByFallback(
      "founder@acme.ai",
      "Re: Internship Inquiry",
      [
        candidate({ id: "t1", companyId: "c1", gmailThreadId: "th-a" }),
        candidate({ id: "t2", companyId: "c2", gmailThreadId: "th-b" }),
      ],
      new Date("2026-09-08T12:00:00.000Z"),
    );
    assert.equal(result, null);
  });

  it("ignores sends outside the window", () => {
    const result = matchByFallback(
      "founder@acme.ai",
      "Re: Internship Inquiry",
      [candidate({ id: "t1", companyId: "c1", sentAt: "2025-01-01T00:00:00.000Z" })],
      new Date("2026-09-08T12:00:00.000Z"),
    );
    assert.equal(result, null);
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes the entities Gmail's snippet leaves un-decoded", () => {
    const raw = "Sure saarth i&#39;d love to talk. On Tue wrote saarth &lt;a@b.com&gt;";
    assert.equal(decodeHtmlEntities(raw), "Sure saarth i'd love to talk. On Tue wrote saarth <a@b.com>");
  });

  it("decodes &amp; last so a literal &amp;lt; doesn't get double-unescaped", () => {
    assert.equal(decodeHtmlEntities("Tom &amp; Jerry"), "Tom & Jerry");
  });
});

describe("isBounceMessage", () => {
  it("flags a mailer-daemon sender", () => {
    assert.equal(
      isBounceMessage({ fromEmail: "mailer-daemon@googlemail.com", subject: "hi" }),
      true,
    );
  });

  it("flags a delivery-failure subject from a normal-looking address", () => {
    assert.equal(
      isBounceMessage({ fromEmail: "someone@acme.ai", subject: "Delivery Status Notification (Failure)" }),
      true,
    );
  });

  it("does not flag an ordinary reply", () => {
    assert.equal(isBounceMessage({ fromEmail: "founder@acme.ai", subject: "Re: Internship Inquiry" }), false);
  });
});

describe("extractBouncedRecipient", () => {
  it("picks the first address that isn't the daemon or the owner", () => {
    const body =
      "Delivery to the following recipient failed permanently:\n\n" +
      "     bad-contact@acme.ai\n\n" +
      "Message will be deleted from the queue. For more information, see mailer-daemon@googlemail.com.";
    assert.equal(extractBouncedRecipient(body, "saarth@gmail.com"), "bad-contact@acme.ai");
  });

  it("returns null when no usable address is found", () => {
    assert.equal(extractBouncedRecipient("no addresses here", "saarth@gmail.com"), null);
  });
});

describe("resolveOutboundThread", () => {
  it("prefers header match over fallback", () => {
    const result = resolveOutboundThread({
      fromEmail: "founder@acme.ai",
      subject: "Re: Internship Inquiry",
      inReplyTo: "<abc123@mail.gmail.com>",
      references: null,
      gmailThreadId: "wrong-thread",
      candidates: [
        candidate({ id: "header-hit", companyId: "c1", gmailThreadId: "thread-1" }),
        candidate({
          id: "other",
          companyId: "c2",
          gmailThreadId: "wrong-thread",
          rfcMessageId: "zzz@mail.gmail.com",
          contactEmail: "other@acme.ai",
        }),
      ],
      ownEmail: "saarth@gmail.com",
    });
    assert.equal(result?.reason, "header");
    assert.equal(result?.threadId, "header-hit");
  });

  it("skips mail from the authorized mailbox", () => {
    const result = resolveOutboundThread({
      fromEmail: "saarth@gmail.com",
      subject: "Re: Internship Inquiry",
      inReplyTo: "<abc123@mail.gmail.com>",
      references: null,
      gmailThreadId: "thread-1",
      candidates: [candidate({ id: "t1", companyId: "c1" })],
      ownEmail: "saarth@gmail.com",
    });
    assert.equal(result, null);
  });
});
