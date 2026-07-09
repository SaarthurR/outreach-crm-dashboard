import { NextResponse } from "next/server";

import { isWebhookAuthorized } from "@/lib/env";
import { syncInboxReplies } from "@/lib/gmail";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (!isWebhookAuthorized(secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const envelope = (await request.json()) as {
      message?: {
        data?: string;
      };
    };

    const payload = envelope.message?.data
      ? JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8"))
      : null;

    const result = await syncInboxReplies(payload?.historyId ?? null);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Webhook handling failed" },
      { status: 500 },
    );
  }
}
