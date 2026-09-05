import { buildDemoDashboardData } from "@/lib/seed-data";
import { getDashboardSnapshot } from "@/lib/db/repository";
import { buildDashboardStats } from "@/lib/outreach";

export async function loadDashboardData() {
  try {
    const snapshot = await getDashboardSnapshot();

    return {
      ...snapshot,
      stats: buildDashboardStats(snapshot.leads, snapshot.threads, snapshot.settings.dailySendTarget),
    };
  } catch {
    return buildDemoDashboardData();
  }
}
