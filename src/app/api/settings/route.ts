import { NextResponse } from "next/server";

import { saveProfileSettings } from "@/lib/db/repository";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function POST(request: Request) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as Parameters<typeof saveProfileSettings>[0];
    const settings = await saveProfileSettings(body);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save settings" },
      { status: 500 },
    );
  }
}
