import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { after, test } from "node:test";

const dbPath = `/tmp/crm2-dashboard-${randomUUID()}.db`;

process.env.DATABASE_URL = `file:${dbPath}`;

after(async () => {
  await Promise.allSettled([
    rm(dbPath, { force: true }),
    rm(`${dbPath}-shm`, { force: true }),
    rm(`${dbPath}-wal`, { force: true }),
  ]);
});

test("dashboard stats reflect the simplified unsent and sent workflow", async () => {
  const { loadDashboardData } = await import("./dashboard");

  const data = await loadDashboardData();

  assert.deepEqual(Object.keys(data.stats).sort(), [
    "emailsSent",
    "optedOut",
    "sendableLeads",
    "unsentLeads",
  ]);
  assert.equal(data.stats.unsentLeads, 2);
  assert.equal(data.stats.sendableLeads, 1);
  assert.equal(data.stats.optedOut, 1);
  assert.equal(data.stats.emailsSent, 2);
});
