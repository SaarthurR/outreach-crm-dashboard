import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.OPENAI_API_KEY = "";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// One place that encodes what a good draft looks like. Wording can change; these can't.
// Structure is Zach Lin's: credibility line, the specific thing about them tied back to
// Saarth's own work, one small ask, friction removed.
function assertDraftContract(draft: { subject: string; body: string }) {
  assert.equal(draft.subject, "quick question from a 14 year old who shipped at 2 startups");
  assert.match(draft.body, /^Hi\b/);
  assert.match(draft.body, /DeepAware/);
  assert.match(draft.body, /Frizzle/);
  assert.match(draft.body, /caught my attention because/);
  assert.match(draft.body, /Would love 15 minutes/);
  assert.match(draft.body, /Happy to work around your schedule\.\n\nSaarth$/);
  // The conference story is real and belongs in an essay, not in a cold email.
  assert.doesNotMatch(draft.body, /200 people|Builders Conference|arms table|award/i);
  // Saarth's voice rules: no em dashes, never "genuinely"/"honestly".
  assert.doesNotMatch(draft.body, /[—–]|--/);
  assert.doesNotMatch(draft.body, /genuinely|honestly/i);
  // Tells that make a cold email read as automated, plus pre-negotiating on pay.
  assert.doesNotMatch(draft.body, /passionate|excited|thrilled|leverage|robust|delve|landscape/i);
  assert.doesNotMatch(draft.body, /unpaid|free of charge|no pay|pick your brain/i);
  assert.doesNotMatch(draft.body, /I know (?:I'm|my age|14 is)/i);
  // The first email asks for a conversation, never for the job.
  assert.doesNotMatch(draft.body, /I'd (?:like|love) to (?:do a|intern|have an internship)/i);
  // One ask only, phrased as a statement.
  assert.ok((draft.body.match(/\?/g) ?? []).length <= 1, "at most one question mark");
  assert.ok(draft.body.split(/\s+/).length <= 130, `body is ${draft.body.split(/\s+/).length} words`);
}

test("draft leads with one credibility line and passes the contract", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Should not fetch when lead notes already provide a clear company detail");
  };

  const { generateOutreachDraft } = await import("./ai");
  const { defaultSettings } = await import("./seed-data");

  const draft = await generateOutreachDraft(
    {
      id: "lead-technical",
      companyName: "Signal Forge",
      website: "https://signalforge.ai",
      domain: "signalforge.ai",
      companyType: "Founder-led AI startup",
      location: "San Francisco, CA",
      contactEmail: "founders@signalforge.ai",
      contactName: "Founding team",
      contactType: "founder",
      source: "Public team page",
      confidence: 0.93,
      status: "new",
      followUpDate: null,
      notes: "Building trading-adjacent AI infrastructure tools for developers.",
      lastThreadId: null,
    },
    defaultSettings,
  );

  assertDraftContract(draft);
  assert.equal(fetchCalls, 0);
  assert.match(draft.body, /trading-adjacent AI infrastructure tools for developers/i);
});

test("draft connects the company detail back to Saarth's own work", async () => {
  const { generateOutreachDraft } = await import("./ai");
  const { defaultSettings } = await import("./seed-data");

  const draft = await generateOutreachDraft(
    {
      id: "lead-general",
      companyName: "Northstar Labs",
      website: "https://northstarlabs.ai",
      domain: "northstarlabs.ai",
      companyType: "AI startup",
      location: "Remote",
      contactEmail: "hello@northstarlabs.ai",
      contactName: null,
      contactType: "contact",
      source: "Public contact page",
      confidence: 0.81,
      status: "new",
      followUpDate: null,
      notes: "General startup support, docs, and product operations.",
      lastThreadId: null,
    },
    defaultSettings,
  );

  assertDraftContract(draft);

});

test("keeps a real greeting and only adds one when it is missing", async () => {
  const { normalizeDraftGreeting } = await import("./ai");

  // A named greeting outperforms a generic one, so it is left alone.
  assert.equal(
    normalizeDraftGreeting("Hi Channel3 team,\n\nBody paragraph."),
    "Hi Channel3 team,\n\nBody paragraph.",
  );
  assert.equal(
    normalizeDraftGreeting("Hello Chris,\n\nBody paragraph."),
    "Hello Chris,\n\nBody paragraph.",
  );
  assert.equal(normalizeDraftGreeting("Body paragraph."), "Hi,\n\nBody paragraph.");
});

test("drafts strip scraped taglines and avoid canned startup phrases", async () => {
  const { generateOutreachDraft } = await import("./ai");
  const { defaultSettings } = await import("./seed-data");

  const draft = await generateOutreachDraft(
    {
      id: "lead-onlook",
      companyName: "Onlook — Cursor for Designers",
      website: "https://onlook.com",
      domain: "onlook.com",
      companyType: "AI design tooling startup",
      location: "San Francisco, CA",
      contactEmail: "contact@onlook.com",
      contactName: null,
      contactType: "contact",
      source: "YC AI directory • W2025",
      confidence: 0.89,
      status: "new",
      followUpDate: null,
      notes: "AI design tooling company.",
      lastThreadId: null,
    },
    defaultSettings,
  );

  assertDraftContract(draft);
  assert.match(draft.body, /\bOnlook\b/);
  assert.doesNotMatch(draft.body, /Cursor for Designers/i);
});

test("drafts personalize from stored lead notes without scraping when the lead already has a strong description", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Should not scrape when lead notes are enough");
  };

  const { generateOutreachDraft } = await import("./ai");
  const { defaultSettings } = await import("./seed-data");

  const draft = await generateOutreachDraft(
    {
      id: "lead-archal",
      companyName: "Archal",
      website: "https://archal.ai",
      domain: "archal.ai",
      companyType: "YC AI startup (S2026)",
      location: "San Francisco, CA",
      contactEmail: "founders@archal.ai",
      contactName: "Founding team",
      contactType: "founder",
      source: "YC AI directory • S2026",
      confidence: 0.95,
      status: "new",
      followUpDate: null,
      notes:
        "Found in YC's public AI startup directory (S2026). The eval platform for autonomous software. Found on the contact page through a public mailto link. Public page: https://www.archal.ai/contact. This is a same-domain inbox, which makes it safer for outreach.",
      lastThreadId: null,
    },
    defaultSettings,
  );

  assert.equal(fetchCalls, 0);
  assertDraftContract(draft);
  assert.match(draft.body, /I saw Archal is the eval platform for autonomous software/i);
});

test("drafts keep a cold-email tone without explicit hiring language", async () => {
  const fetchCalls: string[] = [];
  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    fetchCalls.push(url);

    if (url === "https://onlook.com" || url === "https://onlook.com/") {
      return new Response(
        `
          <html>
            <head>
              <title>Onlook</title>
              <meta name="description" content="A visual editor for React apps that helps designers and engineers work in the same codebase." />
            </head>
            <body>
              <a href="/careers">Careers</a>
              <h1>Design and code in the same React codebase</h1>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (url === "https://onlook.com/careers") {
      return new Response(
        `
          <html>
            <body>
              <h1>Design Engineer</h1>
              <p>Help shape the editor experience.</p>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const { generateOutreachDraft } = await import("./ai");
  const { defaultSettings } = await import("./seed-data");

  const draft = await generateOutreachDraft(
    {
      id: "lead-onlook-scrape",
      companyName: "Onlook",
      website: "https://onlook.com",
      domain: "onlook.com",
      companyType: "AI startup",
      location: "San Francisco, CA",
      contactEmail: "contact@onlook.com",
      contactName: null,
      contactType: "contact",
      source: "Public contact page",
      confidence: 0.84,
      status: "new",
      followUpDate: null,
      notes: "Found on the contact page through a public mailto link. Public page: https://onlook.com/contact.",
      lastThreadId: null,
    },
    defaultSettings,
  );

  assert.ok(fetchCalls.length >= 1);
  assertDraftContract(draft);
  assert.match(draft.body, /Onlook/);
  assert.match(draft.body, /visual editor for react apps/i);
  assert.doesNotMatch(draft.body, /hiring for|not applying for that role/i);
});

test("drafts ignore error-page copy like page not found when scraping company details", async () => {
  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://broken.ai" || url === "https://broken.ai/") {
      return new Response(
        `
          <html>
            <head>
              <title>Page Not Found</title>
              <meta name="description" content="404 page not found" />
            </head>
            <body>
              <h1>Page not found</h1>
              <p>Sorry, this page does not exist.</p>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (url === "https://broken.ai/careers" || url === "https://broken.ai/jobs") {
      return new Response("<html><body><h1>Page not found</h1></body></html>", { status: 200 });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const { generateOutreachDraft } = await import("./ai");
  const { defaultSettings } = await import("./seed-data");

  const draft = await generateOutreachDraft(
    {
      id: "lead-broken",
      companyName: "Broken AI",
      website: "https://broken.ai",
      domain: "broken.ai",
      companyType: "AI startup",
      location: "Remote",
      contactEmail: "hello@broken.ai",
      contactName: null,
      contactType: "contact",
      source: "Public contact page",
      confidence: 0.7,
      status: "new",
      followUpDate: null,
      notes: "Found on the contact page through a public mailto link.",
      lastThreadId: null,
    },
    defaultSettings,
  );

  assertDraftContract(draft);
  assert.doesNotMatch(draft.body, /page not found|404|does not exist/i);
});
