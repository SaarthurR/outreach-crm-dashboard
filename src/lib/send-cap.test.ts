import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { test } from "node:test";

process.env.AUTHORIZED_GMAIL_ADDRESS = "";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.NEXTAUTH_SECRET = "";
process.env.OPENAI_API_KEY = "";
process.env.GROQ_API_KEY = "";

const dbPath = `/tmp/crm2-send-cap-${randomUUID()}.db`;
process.env.DATABASE_URL = `file:${dbPath}`;

// Guards the fix for the April/May 2026 spam problem: 167, 250 and 189 emails
// went out on single days because dailySendTarget was stored but never enforced.
test("batch send stops at the daily cap instead of firing the whole queue", async () => {
  const { saveProfileSettings, upsertLeads, listLeads } = await import("./db/repository");
  const { sendOutreachBatch } = await import("./gmail");

  try {
    await saveProfileSettings({ dailySendTarget: 1 });

    // Two fresh sendable leads, so the cap has something to actually hold back.
    const [template] = await listLeads();
    await upsertLeads(
      [1, 2].map((n) => ({
        ...template,
        id: `cap-lead-${n}`,
        companyName: `Cap Test ${n}`,
        domain: `cap${n}.example.com`,
        contactEmail: `founders@cap${n}.example.com`,
        status: "new" as const,
        lastThreadId: null,
      })),
    );

    const batch = await sendOutreachBatch();

    assert.equal(batch.dailyCap, 1);
    assert.equal(batch.sentCount, 1);
    assert.ok(
      batch.results.some((result) => result.reason.includes("Daily send cap")),
      "expected at least one row held back by the cap",
    );

    // A second run on the same day must send nothing at all.
    const second = await sendOutreachBatch();
    assert.equal(second.sentCount, 0);
  } finally {
    await Promise.allSettled([
      rm(dbPath, { force: true }),
      rm(`${dbPath}-shm`, { force: true }),
      rm(`${dbPath}-wal`, { force: true }),
    ]);
  }
});
