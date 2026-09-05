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
  assert.match(draft.subject, /^Interested in Learning More About Internship Opportunities at .+$/);
  assert.match(draft.body, /^Hi\b/);
  // The template, followed exactly.
  assert.match(draft.body, /I hope you're doing well\. My name is Saarth Ranka, and I'm currently a freshman at Monta Vista High School in Cupertino\./);
  assert.match(draft.body, /Last summer I interned at two YC companies, DeepAware AI in San Francisco and Frizzle AI, working on robot teleoperation software and cold outreach campaigns\./);
  assert.match(draft.body, /I was searching for internships this summer and came across .+ in the YC directory/);
  assert.match(draft.body, /I'm particularly drawn to .+, and I'm eager to gain real-world experience/);
  assert.match(draft.body, /potential internships, job shadowing, or even volunteer roles/);
  assert.match(draft.body, /Thanks so much for your time/);
  assert.match(draft.body, /Warmly,\nSaarth Ranka/);
  // Blank lines between paragraphs are what the HTML part turns into <p> blocks.
  // Without them the whole email renders as one wall of <br>.
  assert.equal(draft.body.split(/\n\s*\n/).length, 6, "expected 6 paragraph blocks");
  assert.match(draft.body, /\+1 650 441 7661$/);
  // The old line claimed every recipient does "meaningful work in this space",
  // which is nonsense on a list this varied.
  assert.doesNotMatch(draft.body, /meaningful work in this space/);
  // Not one em dash or en dash anywhere, including in scraped company copy.
  assert.doesNotMatch(draft.body, /[\u2014\u2013]|--/);
  assert.doesNotMatch(draft.body, /Hey there/i);
  // Over-claiming the internships is what he asked to cut.
  assert.doesNotMatch(draft.body, /200 people|Builders Conference|arms table|1,000 sends|OpenArm/i);
  assert.doesNotMatch(draft.body, /genuinely|honestly/i);
  assert.doesNotMatch(draft.body, /passionate|excited|thrilled|leverage|robust|delve|landscape|innovative|commitment to/i);
  assert.doesNotMatch(draft.body, /unpaid|free of charge|no pay/i);
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
  assert.match(draft.body, /I'm particularly drawn to what you're building with the eval platform for autonomous software/i);
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

test("the drawn-to clause keeps acronyms and brand casing", async () => {
  const { buildDrawnTo } = await import("./draft-personalization");
  const lead = (companyName: string) => ({ companyName, notes: "" }) as never;

  assert.match(buildDrawnTo("AI for portfolio managers", lead("X")), /with AI for portfolio managers$/);
  assert.match(buildDrawnTo("Ramp for Real Estate", lead("X")), /with ramp for Real Estate$/);
  assert.match(buildDrawnTo("iOS tooling for teams", lead("X")), /with iOS tooling for teams$/);
});

test("a model clause that reads as AI is rejected in favour of the template fill", async () => {
  const { buildOutreachBody } = await import("./ai");
  const { defaultSettings } = await import("./seed-data");
  const lead = {
    id: "l", companyName: "Acme", website: "https://acme.com", domain: "acme.com",
    companyType: "YC AI startup (S2025)", location: "SF", contactEmail: "founders@acme.com",
    contactName: null, contactType: "contact", source: "YC AI directory", confidence: 0.9,
    status: "new", followUpDate: null, notes: "Robots.", lastThreadId: null,
  } as never;

  // Any em dash the model or a scrape sneaks in must not survive into the body.
  const body = buildOutreachBody(lead, defaultSettings, "your work on robots — all of it");
  assert.doesNotMatch(body, /[—–]/);
});
