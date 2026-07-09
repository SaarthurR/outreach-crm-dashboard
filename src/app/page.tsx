import Link from "next/link";

import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { loadDashboardData } from "@/lib/dashboard";
import { env, isLiveGmailConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  const liveConfigured = isLiveGmailConfigured();
  const session = await auth();

  if (liveConfigured && env.authorizedGmailAddress && session?.user?.email !== env.authorizedGmailAddress) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[color:var(--canvas)] px-6">
        <div className="w-full max-w-xl rounded-[32px] border border-black/6 bg-[color:var(--panel)] p-8 text-center shadow-[0_20px_60px_rgba(17,60,57,0.08)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:var(--muted-ink)]">
            Private dashboard
          </p>
          <h1 className="mt-4 font-heading text-4xl tracking-[-0.04em] text-[color:var(--ink)]">
            Sign in with the connected Gmail account
          </h1>
          <p className="mt-4 text-base leading-7 text-[color:var(--muted-ink)]">
            This workspace is reserved for {env.authorizedGmailAddress}. Once you sign in, the
            live Gmail sending and the full dashboard will unlock.
          </p>
          <Link
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-[color:var(--accent-strong)] px-6 py-3 text-sm font-semibold text-white hover:bg-[color:var(--accent-deep)]"
            href="/api/auth/signin/google"
          >
            Sign in with Google
          </Link>
        </div>
      </main>
    );
  }

  const dashboardData = await loadDashboardData();

  return <DashboardShell canConnectGmail={liveConfigured} data={dashboardData} />;
}
