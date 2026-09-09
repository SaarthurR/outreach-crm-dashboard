import { NextResponse } from "next/server";

import { findThreadById, setThreadStarred } from "@/lib/db/repository";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ threadId: string }>;
  },
) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const { threadId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { starred?: boolean };

    if (typeof body.starred !== "boolean") {
      return NextResponse.json({ ok: false, error: "starred (boolean) is required" }, { status: 400 });
    }

    const thread = await findThreadById(threadId);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "Thread not found" }, { status: 404 });
    }

    await setThreadStarred(threadId, body.starred);

    return NextResponse.json({ ok: true, threadId, starred: body.starred });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not update thread" },
      { status: 500 },
    );
  }
}
