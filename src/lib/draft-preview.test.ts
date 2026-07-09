import assert from "node:assert/strict";
import { test } from "node:test";

import { getLeadDraftPreview } from "./draft-preview";

test("getLeadDraftPreview returns trimmed subject and body when a draft exists", () => {
  const preview = getLeadDraftPreview({
    subject: " Internship Inquiriy ",
    draftBody: "\nHello there\n\nThis is the draft.\n",
  });

  assert.deepEqual(preview, {
    subject: "Internship Inquiriy",
    body: "Hello there\n\nThis is the draft.",
  });
});

test("getLeadDraftPreview returns null when subject or body is missing", () => {
  assert.equal(
    getLeadDraftPreview({
      subject: "Internship Inquiriy",
      draftBody: "   ",
    }),
    null,
  );

  assert.equal(getLeadDraftPreview(undefined), null);
});
