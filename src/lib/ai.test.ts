import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.OPENAI_API_KEY = "";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("fallback draft uses the exact internship subject and technical template for founder-led AI companies", async () => {
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

  assert.equal(draft.subject, "Internship Inquiriy");
  assert.equal(fetchCalls, 0);
  assert.match(draft.body, /^Hey there,/);
  assert.match(draft.body, /I'm Saarth Ranka\. I'm 14, from Cupertino, and I'm looking for a summer internship this summer\./i);
  assert.match(draft.body, /building trading-adjacent AI infrastructure tools for developers/i);
  assert.match(draft.body, /I know 14 is younger than most people who send emails like this, so I'll keep it simple/i);
  assert.match(draft.body, /I came across Signal Forge while looking for AI teams, and your work on building trading-adjacent AI infrastructure tools for developers stood out to me\./i);
  assert.match(draft.body, /Because of that, I thought I could probably be useful with testing edge cases, QA, docs, research, or small automation work\./i);
  assert.doesNotMatch(draft.body, /extra set of hands|help out at an AI startup|—|--/i);
});

test("fallback draft uses the broader useful template for general startup outreach", async () => {
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

  assert.equal(draft.subject, "Internship Inquiriy");
  assert.match(draft.body, /^Hey there,/);
  assert.match(draft.body, /Quick background: I built and sold a small gaming\/proxy site at school with about 20 customers/i);
  assert.match(draft.body, /Outside tech, I've played tabla for nine years/i);
  assert.match(draft.body, /I don't need anything formal\. I'd just like a chance to help and learn/i);
  assert.match(draft.body, /If it makes more sense to start with a small trial task, I'd be happy to do that first\./i);
  assert.doesNotMatch(draft.body, /fancy title|chance to be useful|lighten the load|—|--/i);
});

test("normalizes personalized greetings to a consistent hey there opener", async () => {
  const { normalizeDraftGreeting } = await import("./ai");

  assert.equal(
    normalizeDraftGreeting("Hi Channel3 team,\n\nBody paragraph."),
    "Hey there,\n\nBody paragraph.",
  );
  assert.equal(
    normalizeDraftGreeting("Hello Chris,\n\nBody paragraph."),
    "Hey there,\n\nBody paragraph.",
  );
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

  assert.match(draft.body, /\bOnlook\b/);
  assert.doesNotMatch(draft.body, /Cursor for Designers|extra set of hands|fancy title|lighten the load|—|--/i);
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
  assert.match(draft.body, /I found Archal through YC/i);
  assert.match(draft.body, /the eval platform for autonomous software/i);
  assert.match(draft.body, /Because of that, I thought I could probably be useful with testing edge cases, QA, docs, research, or small automation work\./i);
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
  assert.match(draft.body, /I checked out Onlook's site/i);
  assert.match(draft.body, /visual editor for React apps/i);
  assert.match(draft.body, /testing product flows, user feedback, docs, or support/i);
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

  assert.doesNotMatch(draft.body, /page not found|404|does not exist/i);
  assert.match(draft.body, /Because of that, I thought I could probably be useful with testing, research, docs, support, or simple web tasks\./i);
});
