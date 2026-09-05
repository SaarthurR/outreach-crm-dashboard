import { NextResponse } from "next/server";

import { sendTestEmail } from "@/lib/gmail";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function POST(request: Request) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { to?: string; leadId?: string };

    if (!body.to) {
      return NextResponse.json(
        { ok: false, error: "A destination address is required." },
        { status: 400 },
      );
    }

    const result = await sendTestEmail(body.to, body.leadId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Test send failed" },
      { status: 500 },
    );
  }
}
