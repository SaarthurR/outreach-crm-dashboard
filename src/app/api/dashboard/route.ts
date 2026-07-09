import { loadDashboardData } from "@/lib/dashboard";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  const dashboard = await loadDashboardData();
  return Response.json(dashboard);
}
