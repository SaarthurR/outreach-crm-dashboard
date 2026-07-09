import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/env";
import { renewGmailWatch, syncInboxReplies } from "@/lib/gmail";

function readSecret(request: Request) {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }

  return new URL(request.url).searchParams.get("secret");
}

export async function POST(request: Request) {
  const secret = readSecret(request);
  if (!isCronAuthorized(secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const renewed = await renewGmailWatch();
    const synced = await syncInboxReplies();

    return NextResponse.json({
      ok: true,
      renewed,
      synced,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Cron failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
