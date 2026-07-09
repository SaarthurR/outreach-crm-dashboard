import { NextResponse } from "next/server";

import { generateAndStoreDraft } from "@/lib/gmail";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function POST(request: Request) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as { leadId?: string };
    if (!body.leadId) {
      return NextResponse.json({ ok: false, error: "leadId is required" }, { status: 400 });
    }

    const thread = await generateAndStoreDraft(body.leadId, true);
    return NextResponse.json({ ok: true, thread });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Draft generation failed" },
      { status: 500 },
    );
  }
}
