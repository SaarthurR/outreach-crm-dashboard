import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { env, isLiveGmailConfigured } from "@/lib/env";

export async function ensureAuthorizedUser() {
  if (!isLiveGmailConfigured() || !env.authorizedGmailAddress) {
    return null;
  }

  const session = await auth();
  if (session?.user?.email !== env.authorizedGmailAddress) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
      },
      { status: 401 },
    );
  }

  return null;
}
