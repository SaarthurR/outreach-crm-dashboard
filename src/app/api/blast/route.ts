import { NextResponse } from "next/server";

import { parseRecipients } from "@/lib/blast";
import { sendBlast } from "@/lib/gmail";
import { ensureAuthorizedUser } from "@/lib/route-auth";

// Sends are spaced 8-20s apart to stay out of the spam folder, so a 30-person
// blast runs for several minutes and the default function timeout is too short.
export const maxDuration = 800;

export async function POST(request: Request) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      recipients?: string;
      subject?: string;
      body?: string;
      attachResume?: boolean;
    };

    // Parse server-side too: the browser is not the only thing that can POST here.
    const { addresses } = parseRecipients(body.recipients ?? "");

    const result = await sendBlast({
      recipients: addresses,
      subject: body.subject ?? "",
      body: body.body ?? "",
      attachResume: body.attachResume ?? true,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Blast failed" },
      { status: 500 },
    );
  }
}
