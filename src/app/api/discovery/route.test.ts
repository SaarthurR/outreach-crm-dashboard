import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, test } from "node:test";

process.env.AUTHORIZED_GMAIL_ADDRESS = "";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.NEXTAUTH_SECRET = "";
process.env.OPENAI_API_KEY = "";

const originalFetch = globalThis.fetch;

async function cleanupDb(dbPath: string) {
  await Promise.allSettled([
    rm(dbPath, { force: true }),
    rm(`${dbPath}-shm`, { force: true }),
    rm(`${dbPath}-wal`, { force: true }),
  ]);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("discovery queues ready drafts without sending emails", async () => {
  const dbPath = `/tmp/crm2-discovery-route-${randomUUID()}.db`;
  process.env.DATABASE_URL = `file:${dbPath}`;

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
              <a href="/team">Team</a>
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
              <a href="mailto:founders@acme.ai">founders@acme.ai</a>
            </body>
          </html>
        `,
        { status: 200 },
      );
    }

    if (
      url === "https://acme.ai/contact" ||
      url === "https://acme.ai/about" ||
      url === "https://acme.ai/careers"
    ) {
      return new Response("<html></html>", { status: 200 });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const { POST } = await import("./route");
  const { findThreadByLeadId } = await import("@/lib/db/repository");

  try {
    const response = await POST(
      new Request("http://localhost/api/discovery", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: "acme ai founders",
          limit: 1,
        }),
      }),
    );

    assert.equal(response.status, 200);

    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.discoveredCount, 1);

    const thread = await findThreadByLeadId("acme.ai:founders@acme.ai");
    assert.ok(thread);
    assert.equal(thread?.draftStatus, "ready");
    assert.equal(thread?.sentAt, null);
    assert.match(thread?.subject ?? "", /^Internship opportunities at .+ this summer\?$/);
  } finally {
    await cleanupDb(dbPath);
  }
});
