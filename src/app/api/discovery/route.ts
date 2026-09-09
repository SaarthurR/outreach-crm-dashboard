import { NextResponse } from "next/server";

import { appendActivity, upsertLeads } from "@/lib/db/repository";
import { discoverPublicLeads } from "@/lib/discovery";
import { generateAndStoreDraftBatch } from "@/lib/gmail";
import { isAlreadyWorkedThere } from "@/lib/outreach";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function POST(request: Request) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { query?: string; limit?: number };
    // Never let discovery re-add a company Saarth already interned at.
    const discovered = (await discoverPublicLeads(body.query, body.limit)).filter(
      (lead) => !isAlreadyWorkedThere(lead),
    );
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
