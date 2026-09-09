import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { inArray, sql } from "drizzle-orm";

import * as client from "../src/lib/db/client";
import * as repository from "../src/lib/db/repository";
import * as schema from "../src/lib/db/schema";
import * as envModule from "../src/lib/env";

// This repo's .mts scripts import .ts modules across a CJS/ESM boundary, so named
// exports land under `.default` here even though they're plain named exports from
// the .ts side. Same unwrap as scripts/backfill-public-leads.mts.
const { getDb } = (client as { default?: typeof client }).default ?? client;
const { ensureSeeded } = (repository as { default?: typeof repository }).default ?? repository;
const { activityEvents, companies, inboundSeen, outreachThreads } =
  (schema as { default?: typeof schema }).default ?? schema;
const { env } = (envModule as { default?: typeof envModule }).default ?? envModule;

// Only a local file: database can be backed up with a plain file copy. A remote
// DATABASE_URL (Turso, etc.) has no local file to copy; skip rather than guess.
function backupDbFile() {
  if (!env.databaseUrl.startsWith("file:")) {
    console.log(`DATABASE_URL (${env.databaseUrl}) isn't a local file. Skipping backup.`);
    return;
  }

  const dbPath = resolve(process.cwd(), env.databaseUrl.slice("file:".length));
  if (!existsSync(dbPath)) {
    console.log(`No database file at ${dbPath}. Nothing to back up.`);
    return;
  }

  const backupDir = resolve(process.cwd(), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(backupDir, `local-${stamp}.db`);
  copyFileSync(dbPath, backupPath);
  console.log(`Backed up ${dbPath} -> ${backupPath}`);
}

async function main() {
  backupDbFile();
  await ensureSeeded();
  const db = getDb();

  const [{ n: threadCount }] = await db.select({ n: sql<number>`count(*)` }).from(outreachThreads);
  const [{ n: resendableCount }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(companies)
    .where(inArray(companies.status, ["sent", "replied"]));

  await db.delete(outreachThreads);
  await db.delete(activityEvents);
  await db.delete(inboundSeen);

  // Leave "invalid" (bounced) and "skipped" (opted out) leads alone: those are
  // decisions about the address/person, not about the sent/replied counters.
  await db
    .update(companies)
    .set({ status: "new", lastThreadId: null, followUpDate: null, updatedAt: new Date().toISOString() })
    .where(inArray(companies.status, ["sent", "replied"]));

  console.log(
    `Cleared ${threadCount} thread(s) and activity log. Reset ${resendableCount} sent/replied lead(s) to "new".`,
  );
  console.log('Leads marked "invalid" or "skipped" were left untouched.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
