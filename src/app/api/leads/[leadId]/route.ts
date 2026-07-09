import { NextResponse } from "next/server";

import { findLeadById, findThreadByLeadId, updateLeadStatus } from "@/lib/db/repository";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ leadId: string }>;
  },
) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const { leadId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { optedOut?: boolean };
    const lead = await findLeadById(leadId);

    if (!lead) {
      return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
    }

    const thread = await findThreadByLeadId(leadId);
    const nextStatus = body.optedOut
      ? "skipped"
      : thread?.draftStatus === "ready"
        ? "queued"
        : "new";

    await updateLeadStatus(leadId, nextStatus, lead.lastThreadId);

    return NextResponse.json({
      ok: true,
      leadId,
      status: nextStatus,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not update lead" },
      { status: 500 },
    );
  }
}
