import assert from "node:assert/strict";
import { test } from "node:test";

process.env.AUTHORIZED_GMAIL_ADDRESS = "";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.NEXTAUTH_SECRET = "";

// A text/plain-only message renders in Gmail as a narrow fixed-width column.
// These guard the multipart/alternative fix.
test("outgoing mail carries both a plain and an HTML part", async () => {
  const { __testables } = await import("./gmail");
  const raw = __testables.buildGmailMessage(
    "someone@example.com",
    "Interested in Learning More About Internship Opportunities at Acme",
    "Hi there,\n\nFirst paragraph.\n\nWarmly,\nSaarth Ranka\nranka.saarth@gmail.com\n+1 650 441 7661",
  );

  const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

  assert.match(decoded, /Content-Type: multipart\/alternative/);
  assert.match(decoded, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(decoded, /Content-Type: text\/html; charset=utf-8/);

  const html = __testables.buildHtmlBody(
    "Hi there,\n\nFirst paragraph.\n\nWarmly,\nSaarth Ranka\nranka.saarth@gmail.com\n+1 650 441 7661",
  );

  // Paragraphs, not baked-in line breaks, so the mail reflows to the reader's window.
  assert.match(html, /<p>Hi there,<\/p>/);
  assert.match(html, /<p>First paragraph\.<\/p>/);
  // Address and phone become real anchors rather than bare text Gmail rewrites.
  assert.match(html, /<a href="mailto:ranka\.saarth@gmail\.com">/);
  assert.match(html, /<a href="tel:\+16504417661">/);
  assert.doesNotMatch(html, /<script/i);
});

test("the resume rides along as a PDF attachment", async () => {
  const { __testables } = await import("./gmail");

  const attachment = __testables.getResumeAttachment();
  assert.ok(attachment, "assets/Saarth-Ranka-Resume.pdf should be readable from the repo");
  assert.equal(attachment.filename, "Saarth-Ranka-Resume.pdf");

  const raw = __testables.buildGmailMessage("someone@example.com", "Subject", "Hi there,\n\nBody.");
  const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

  // mixed wraps alternative, so the reader keeps the formatted body AND gets the file.
  assert.match(decoded, /Content-Type: multipart\/mixed/);
  assert.match(decoded, /Content-Type: multipart\/alternative/);
  assert.match(decoded, /Content-Type: application\/pdf; name="Saarth-Ranka-Resume\.pdf"/);
  assert.match(decoded, /Content-Disposition: attachment; filename="Saarth-Ranka-Resume\.pdf"/);
  // The PDF must survive base64 intact.
  const part = decoded.split('Content-Disposition: attachment')[1] ?? "";
  const payload = part.split("\r\n\r\n")[1]?.split("\r\n--")[0]?.replace(/\r\n/g, "") ?? "";
  assert.equal(Buffer.from(payload, "base64").subarray(0, 5).toString("latin1"), "%PDF-");
});
