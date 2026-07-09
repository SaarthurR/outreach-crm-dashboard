import { NextResponse } from "next/server";

import { sendOutreachBatch, sendOutreachEmail } from "@/lib/gmail";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function POST(request: Request) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      leadId?: string;
      leadIds?: string[];
    };

    if (Array.isArray(body.leadIds) && body.leadIds.length > 0) {
      const batch = await sendOutreachBatch(body.leadIds);
      return NextResponse.json({ ok: true, ...batch });
    }

    if (!body.leadId) {
      const batch = await sendOutreachBatch();
      return NextResponse.json({ ok: true, ...batch });
    }

    const result = await sendOutreachEmail(body.leadId);
    return NextResponse.json({
      ok: true,
      sentCount: 1,
      skippedCount: 0,
      results: [
        {
          leadId: body.leadId,
          companyName: result.thread.companyName,
          status: "sent" as const,
          reason: "Sent",
        },
      ],
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Send failed" },
      { status: 500 },
    );
  }
}
