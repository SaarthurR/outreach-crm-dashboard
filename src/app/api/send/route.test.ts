import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { test } from "node:test";

process.env.AUTHORIZED_GMAIL_ADDRESS = "";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.NEXTAUTH_SECRET = "";
process.env.OPENAI_API_KEY = "";

async function cleanupDb(dbPath: string) {
  await Promise.allSettled([
    rm(dbPath, { force: true }),
    rm(`${dbPath}-shm`, { force: true }),
    rm(`${dbPath}-wal`, { force: true }),
  ]);
}

test("bulk send accepts multiple lead ids and skips ineligible rows", async () => {
  const dbPath = `/tmp/crm2-send-route-${randomUUID()}.db`;
  process.env.DATABASE_URL = `file:${dbPath}`;
  const { POST } = await import("./route");

  try {
    const response = await POST(
      new Request("http://localhost/api/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leadIds: ["lead-openai-tools", "lead-invalid-demo", "lead-founder-micro"],
        }),
      }),
    );

    assert.equal(response.status, 200);

    const data = await response.json();

    assert.equal(data.ok, true);
    assert.equal(data.sentCount, 1);
    assert.equal(data.skippedCount, 2);
    assert.equal(data.results.length, 3);
  } finally {
    await cleanupDb(dbPath);
  }
});

test("send route without ids sends the full eligible queue", async () => {
  const dbPath = `/tmp/crm2-send-route-${randomUUID()}.db`;
  process.env.DATABASE_URL = `file:${dbPath}`;
  const { POST } = await import("./route");

  try {
    const response = await POST(
      new Request("http://localhost/api/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    assert.equal(response.status, 200);

    const data = await response.json();

    assert.equal(data.ok, true);
    assert.equal(data.sentCount >= 1, true);
    assert.equal(data.skippedCount >= 1, true);
  } finally {
    await cleanupDb(dbPath);
  }
});
