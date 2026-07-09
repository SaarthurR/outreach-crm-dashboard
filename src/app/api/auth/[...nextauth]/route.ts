import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth";

const unavailableHandler = async () =>
  NextResponse.json(
    {
      ok: false,
      error: "Google auth is not configured yet.",
    },
    { status: 503 },
  );

const handler = authOptions ? NextAuth(authOptions) : unavailableHandler;

export { handler as GET, handler as POST };
