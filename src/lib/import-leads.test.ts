import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLeadCsv } from "./import-leads.js";

test("parseLeadCsv accepts email and company columns", () => {
  const csv = `email,company,firstName
founder@acme.ai,Acme AI,Jane
bad-row,,Bob
founder@acme.ai,Duplicate,Skip`;

  const result = parseLeadCsv(csv);

  assert.equal(result.parsedRows, 3);
  assert.equal(result.validRows, 2);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0]?.contactEmail, "founder@acme.ai");
  assert.equal(result.leads[0]?.companyName, "Acme AI");
  assert.equal(result.leads[0]?.contactName, "Jane");
});

test("classifyReply uses keyword rules without AI", async () => {
  const { classifyReply } = await import("./ai.js");

  assert.equal(classifyReply({ subject: "Re:", companyName: "Acme" }, "Sounds good, send your resume").bucket, "yes");
  assert.equal(classifyReply({ subject: "Re:", companyName: "Acme" }, "Not hiring right now, thanks").bucket, "no");
});
