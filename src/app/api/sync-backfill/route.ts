import { NextResponse } from "next/server";

import { backfillReplies } from "@/lib/gmail";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function POST() {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) return unauthorized;

  try {
    const result = await backfillReplies();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 500 },
    );
  }
}
