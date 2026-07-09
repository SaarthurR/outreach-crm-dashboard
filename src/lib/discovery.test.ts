import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("discovery prefers same-domain public inboxes over third-party emails", async () => {
  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://html.duckduckgo.com/html/?q=")) {
      return new Response(`<a href="https://acme.ai">Acme AI</a>`, { status: 200 });
    }

    if (url === "https://acme.ai/") {
      return new Response(
        `
          <html>
            <head><title>Acme AI | Home</title></head>
            <body>
              <a href="mailto:careers@recruitinghub.com">Careers inbox</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (url === "https://acme.ai/contact") {
      return new Response(
        `
          <html>
            <head><title>Contact | Acme AI</title></head>
            <body>
              <a href="mailto:hello@acme.ai">hello@acme.ai</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (url === "https://acme.ai/about" || url === "https://acme.ai/careers") {
      return new Response("<html></html>", { status: 200 });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const { discoverPublicLeads } = await import("./discovery");
  const [lead] = await discoverPublicLeads("acme ai companies", 1);

  assert.ok(lead);
  assert.equal(lead.contactEmail, "hello@acme.ai");
  assert.ok(lead.confidence >= 0.9);
  assert.match(lead.notes, /same-domain/i);
  assert.match(lead.source, /contact/i);
});

test("discovery prefers public same-domain personal emails on team pages over generic contact inboxes", async () => {
  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://html.duckduckgo.com/html/?q=")) {
      return new Response(`<a href="https://acme.ai">Acme AI</a>`, { status: 200 });
    }

    if (url === "https://acme.ai/") {
      return new Response(
        `
          <html>
            <head><title>Acme AI | Home</title></head>
            <body>
              <a href="/contact">Contact</a>
              <a href="/team">Team</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (url === "https://acme.ai/contact") {
      return new Response(
        `
          <html>
            <head><title>Contact | Acme AI</title></head>
            <body>
              <a href="mailto:info@acme.ai">info@acme.ai</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (url === "https://acme.ai/team") {
      return new Response(
        `
          <html>
            <head><title>Team | Acme AI</title></head>
            <body>
              <p>Founders</p>
              <a href="mailto:aisha@acme.ai">aisha@acme.ai</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (url === "https://acme.ai/about" || url === "https://acme.ai/careers") {
      return new Response("<html></html>", { status: 200 });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const { discoverPublicLeads } = await import("./discovery");
  const [lead] = await discoverPublicLeads("acme ai companies", 1);

  assert.ok(lead);
  assert.equal(lead.contactEmail, "aisha@acme.ai");
  assert.equal(lead.contactType, "founder");
  assert.match(lead.notes, /team page/i);
});

test("default discovery prioritizes recent YC AI startups before generic search", async () => {
  const ycPayload = {
    component: "ycdc_new/pages/Companies/company_list_page/CompanyListPage",
    props: {
      companies: [
        {
          _type: "company",
          id: 1,
          slug: "small-ai-2026",
          name: "Small AI 2026",
          batch_name: "p2026",
          website: "https://smallai.dev",
          one_liner: "Tiny team building agent software",
          long_description: "A small AI startup.",
          tags: ["ai", "developer-tools"],
          ycdc_status: "Active",
          team_size: 3,
          location: "San Francisco, CA, USA",
          ycdc_company_url: "/companies/small-ai-2026",
        },
        {
          _type: "company",
          id: 2,
          slug: "big-old-ai",
          name: "Big Old AI",
          batch_name: "s2019",
          website: "https://bigold.ai",
          one_liner: "Large mature AI company",
          long_description: "Old AI company.",
          tags: ["artificial-intelligence"],
          ycdc_status: "Active",
          team_size: 900,
          location: "San Francisco, CA, USA",
          ycdc_company_url: "/companies/big-old-ai",
        },
      ],
      currentPage: 1,
      totalPages: 1,
      hasMore: false,
      industrySlug: "ai",
    },
  };

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://www.ycombinator.com/companies/industry/ai?page=1") {
      return new Response(
        `<div data-page="${JSON.stringify(ycPayload).replace(/"/g, "&quot;")}"></div>`,
        { status: 200 },
      );
    }

    if (url === "https://smallai.dev/" || url === "https://smallai.dev/contact") {
      return new Response(
        `
          <html>
            <head><title>Small AI 2026</title></head>
            <body>
              <a href="mailto:hello@smallai.dev">hello@smallai.dev</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (
      url === "https://smallai.dev/about" ||
      url === "https://smallai.dev/careers" ||
      url === "https://smallai.dev/team"
    ) {
      return new Response("<html></html>", { status: 200 });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const { discoverPublicLeads } = await import("./discovery");
  const leads = await discoverPublicLeads(undefined, 1);

  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.companyName, "Small AI 2026");
  assert.match(leads[0]?.source ?? "", /yc/i);
});

test("discovery strips YC marketing taglines from company names", async () => {
  const ycPayload = {
    component: "ycdc_new/pages/Companies/company_list_page/CompanyListPage",
    props: {
      companies: [
        {
          _type: "company",
          id: 1,
          slug: "onlook",
          name: "Onlook — Cursor for Designers",
          batch_name: "w2025",
          website: "https://onlook.com",
          one_liner: "Design tool",
          long_description: "A design tool company.",
          tags: ["ai", "design-tools"],
          ycdc_status: "Active",
          team_size: 8,
          location: "San Francisco, CA, USA",
          ycdc_company_url: "/companies/onlook",
        },
      ],
      currentPage: 1,
      totalPages: 1,
      hasMore: false,
      industrySlug: "ai",
    },
  };

  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://www.ycombinator.com/companies/industry/ai?page=1") {
      return new Response(
        `<div data-page="${JSON.stringify(ycPayload).replace(/"/g, "&quot;")}"></div>`,
        { status: 200 },
      );
    }

    if (url === "https://onlook.com/" || url === "https://onlook.com/contact") {
      return new Response(
        `
          <html>
            <head><title>Onlook — Cursor for Designers</title></head>
            <body>
              <a href="mailto:contact@onlook.com">contact@onlook.com</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (
      url === "https://onlook.com/about" ||
      url === "https://onlook.com/careers" ||
      url === "https://onlook.com/team"
    ) {
      return new Response("<html></html>", { status: 200 });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const { discoverPublicLeads } = await import("./discovery");
  const leads = await discoverPublicLeads(undefined, 1);

  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.companyName, "Onlook");
});

test("discovery ignores emails found on error-like pages", async () => {
  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://html.duckduckgo.com/html/?q=")) {
      return new Response(`<a href="https://acme.ai">Acme AI</a>`, { status: 200 });
    }

    if (url === "https://acme.ai/") {
      return new Response(
        `
          <html>
            <head><title>Acme AI</title></head>
            <body>
              <a href="/contact">Contact</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (url === "https://acme.ai/contact") {
      return new Response(
        `
          <html>
            <head><title>Page Not Found</title></head>
            <body>
              <h1>404 Page Not Found</h1>
              <a href="mailto:hello@acme.ai">hello@acme.ai</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (url === "https://acme.ai/about" || url === "https://acme.ai/careers" || url === "https://acme.ai/team") {
      return new Response("<html></html>", { status: 200 });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const { discoverPublicLeads } = await import("./discovery");
  const [lead] = await discoverPublicLeads("acme ai companies", 1);

  assert.ok(lead);
  assert.equal(lead.companyName, "Fallback AI Startup");
});
