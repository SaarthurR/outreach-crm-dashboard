import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { resolveBackfillOptions } from "./backfill-public-leads-config.js";

const originalTarget = process.env.YC_TARGET_ADDITIONAL_LEADS;
const originalPool = process.env.YC_CANDIDATE_POOL;
const originalOffset = process.env.YC_COMPANY_OFFSET;

afterEach(() => {
  if (originalTarget === undefined) {
    delete process.env.YC_TARGET_ADDITIONAL_LEADS;
  } else {
    process.env.YC_TARGET_ADDITIONAL_LEADS = originalTarget;
  }

  if (originalPool === undefined) {
    delete process.env.YC_CANDIDATE_POOL;
  } else {
    process.env.YC_CANDIDATE_POOL = originalPool;
  }

  if (originalOffset === undefined) {
    delete process.env.YC_COMPANY_OFFSET;
  } else {
    process.env.YC_COMPANY_OFFSET = originalOffset;
  }
});

test("resolveBackfillOptions uses defaults when env overrides are absent", () => {
  delete process.env.YC_TARGET_ADDITIONAL_LEADS;
  delete process.env.YC_CANDIDATE_POOL;
  delete process.env.YC_COMPANY_OFFSET;

  assert.deepEqual(resolveBackfillOptions(), {
    targetAdditionalLeads: 250,
    candidatePool: 1400,
    companyOffset: 0,
  });
});

test("resolveBackfillOptions respects positive integer env overrides", () => {
  process.env.YC_TARGET_ADDITIONAL_LEADS = "300";
  process.env.YC_CANDIDATE_POOL = "1800";
  process.env.YC_COMPANY_OFFSET = "1200";

  assert.deepEqual(resolveBackfillOptions(), {
    targetAdditionalLeads: 300,
    candidatePool: 1800,
    companyOffset: 1200,
  });
});

test("resolveBackfillOptions falls back when env overrides are invalid", () => {
  process.env.YC_TARGET_ADDITIONAL_LEADS = "-12";
  process.env.YC_CANDIDATE_POOL = "abc";
  process.env.YC_COMPANY_OFFSET = "-1";

  assert.deepEqual(resolveBackfillOptions(), {
    targetAdditionalLeads: 250,
    candidatePool: 1400,
    companyOffset: 0,
  });
});
