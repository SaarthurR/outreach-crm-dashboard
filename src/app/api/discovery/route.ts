import { NextResponse } from "next/server";

import { appendActivity, upsertLeads } from "@/lib/db/repository";
import { discoverPublicLeads } from "@/lib/discovery";
import { generateAndStoreDraftBatch } from "@/lib/gmail";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function POST(request: Request) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { query?: string; limit?: number };
    const discovered = await discoverPublicLeads(body.query, body.limit);
    const leads = await upsertLeads(discovered);
    const drafts = await generateAndStoreDraftBatch(discovered.map((lead) => lead.id));

    await appendActivity({
      type: "lead_discovered",
      title: `Discovery found ${discovered.length} public contacts`,
      detail: body.query ? `Query: ${body.query}` : "Ran the default AI-company search set.",
      occurredAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      leads,
      discoveredCount: discovered.length,
      draftedCount: drafts.readyCount,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Discovery failed" },
      { status: 500 },
    );
  }
}
