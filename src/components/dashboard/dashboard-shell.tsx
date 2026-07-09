"use client";

import Link from "next/link";
import { useDeferredValue, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  LoaderCircle,
  Mail,
  MailCheck,
  MessageSquare,
  PanelsTopLeft,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldMinus,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import { NAV_ITEMS } from "@/lib/constants";
import { RepliesTabs } from "@/components/dashboard/replies-tabs";
import {
  buildThreadMap,
  getLeadEligibilityReason,
  getSentThreads,
  getUnsentLeads,
  isLeadOptedOut,
  isLeadSendable,
} from "@/lib/outreach";
import { getLeadDraftPreview } from "@/lib/draft-preview";
import type { DashboardData, Lead, NavView, OutreachThread } from "@/lib/types";

interface DashboardShellProps {
  data: DashboardData;
  canConnectGmail: boolean;
}

type SettingsDraft = {
  fullName: string;
  firstName: string;
  schoolName: string;
  city: string;
  state: string;
  targetSeason: string;
  tone: string;
  dailySendTarget: number;
  accomplishmentsText: string;
  closingNotes: string;
};

const navIcons: Record<NavView, typeof Mail> = {
  unsent: MailCheck,
  sent: Send,
  replies: MessageSquare,
};

const statCards = [
  {
    id: "unsent",
    label: "Public emails found",
    description: "Companies still sitting in the unsent queue.",
    icon: Building2,
    valueKey: "unsentLeads",
  },
  {
    id: "ready",
    label: "Ready to send",
    description: "Companies that can go out right now.",
    icon: Sparkles,
    valueKey: "sendableLeads",
  },
  {
    id: "opted-out",
    label: "Opted out",
    description: "Companies you explicitly removed from sending.",
    icon: ShieldMinus,
    valueKey: "optedOut",
  },
  {
    id: "sent",
    label: "Sent",
    description: "Threads already delivered from this workspace.",
    icon: Send,
    valueKey: "emailsSent",
  },
] as const;

function toSettingsDraft(settings: DashboardData["settings"]): SettingsDraft {
  return {
    fullName: settings.fullName,
    firstName: settings.firstName,
    schoolName: settings.schoolName,
    city: settings.city,
    state: settings.state,
    targetSeason: settings.targetSeason,
    tone: settings.tone,
    dailySendTarget: settings.dailySendTarget,
    accomplishmentsText: settings.accomplishments.join("\n"),
    closingNotes: settings.closingNotes,
  };
}

async function readDashboard() {
  const response = await fetch("/api/dashboard", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to refresh the dashboard.");
  }

  return (await response.json()) as DashboardData;
}

export function DashboardShell({ data, canConnectGmail }: DashboardShellProps) {
  const [dashboard, setDashboard] = useState(data);
  const [settingsDraft, setSettingsDraft] = useState(() => toSettingsDraft(data.settings));
  const [leadQuery, setLeadQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [previewPendingLeadId, setPreviewPendingLeadId] = useState<string | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const deferredLeadQuery = useDeferredValue(leadQuery);

  const threadMap = buildThreadMap(dashboard.threads);
  const unsentLeads = getUnsentLeads(dashboard.leads, dashboard.threads).filter((lead) => {
    const query = deferredLeadQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [lead.companyName, lead.companyType, lead.contactEmail, lead.source, lead.notes]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const sentThreads = getSentThreads(dashboard.threads).filter((thread) => {
    const query = deferredLeadQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [thread.companyName, thread.subject, thread.latestSnippet]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const eligibleLeadIds = getUnsentLeads(dashboard.leads, dashboard.threads)
    .filter((lead) => isLeadSendable(lead, threadMap.get(lead.id)))
    .map((lead) => lead.id);
  const lastSyncedLabel =
    dashboard.integration.connected && dashboard.integration.lastSyncedAt
      ? `Last checked ${formatDistanceToNow(new Date(dashboard.integration.lastSyncedAt), {
          addSuffix: true,
        })}`
      : "Demo mode only. Connect Gmail before live sending.";

  async function refreshDashboard(message?: string) {
    const next = await readDashboard();
    setDashboard(next);
    setSettingsDraft(toSettingsDraft(next.settings));
    if (message) {
      setNotice(message);
    }
  }

  function runAction(task: () => Promise<void>) {
    startTransition(async () => {
      try {
        setNotice(null);
        await task();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Something went wrong.");
      }
    });
  }

  function saveSettings() {
    runAction(async () => {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          fullName: settingsDraft.fullName,
          firstName: settingsDraft.firstName || settingsDraft.fullName.split(" ")[0] || "Student",
          schoolName: settingsDraft.schoolName,
          city: settingsDraft.city,
          state: settingsDraft.state,
          targetSeason: settingsDraft.targetSeason,
          tone: settingsDraft.tone,
          dailySendTarget: settingsDraft.dailySendTarget,
          accomplishments: settingsDraft.accomplishmentsText
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          closingNotes: settingsDraft.closingNotes,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not save your profile details.");
      }

      await refreshDashboard("Profile details saved.");
    });
  }

  function discoverLeads() {
    runAction(async () => {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 250 }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        discoveredCount?: number;
        draftedCount?: number;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Public email discovery did not finish cleanly.");
      }

      await refreshDashboard(
        `Added ${payload.discoveredCount ?? 0} public contacts and prepared ${payload.draftedCount ?? 0} drafts. Nothing was sent.`,
      );
    });
  }

  function sendAllEligibleLeads() {
    if (!eligibleLeadIds.length) {
      setNotice("No eligible companies are left in the unsent queue right now.");
      return;
    }

    runAction(async () => {
      const response = await fetch("/api/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        sentCount?: number;
        skippedCount?: number;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Bulk send failed.");
      }

      const sentCount = payload.sentCount ?? 0;
      const skippedCount = payload.skippedCount ?? 0;
      const message =
        skippedCount > 0
          ? `Sent ${sentCount} emails and skipped ${skippedCount} blocked rows.`
          : `Sent ${sentCount} emails.`;

      await refreshDashboard(message);
    });
  }

  function toggleOptOut(lead: Lead, optedOut: boolean) {
    runAction(async () => {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ optedOut }),
      });

      if (!response.ok) {
        throw new Error(optedOut ? "Could not opt out this company." : "Could not restore this company.");
      }

      await refreshDashboard(
        optedOut
          ? `${lead.companyName} will stay darkened and skipped during sends.`
          : `${lead.companyName} is back in the unsent queue.`,
      );
    });
  }

  async function regenerateDraft(lead: Lead) {
    try {
      setNotice(null);
      setPreviewPendingLeadId(lead.id);

      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not regenerate draft.");
      }

      await refreshDashboard(`Regenerated draft for ${lead.companyName}.`);
      setExpandedLeadId(lead.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not regenerate draft.");
    } finally {
      setPreviewPendingLeadId(null);
    }
  }

  async function toggleLeadPreview(lead: Lead, thread: OutreachThread | undefined) {
    if (expandedLeadId === lead.id) {
      setExpandedLeadId(null);
      return;
    }

    const preview = getLeadDraftPreview(thread);
    if (preview) {
      setExpandedLeadId(lead.id);
      return;
    }

    try {
      setNotice(null);
      setPreviewPendingLeadId(lead.id);

      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not prepare a draft preview.");
      }

      await refreshDashboard(`Prepared a preview draft for ${lead.companyName}.`);
      setExpandedLeadId(lead.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not prepare a draft preview.");
    } finally {
      setPreviewPendingLeadId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--canvas)] text-[color:var(--ink)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:flex-row lg:px-8">
        <aside className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:w-[360px] lg:self-start">
          <div className="flex h-full flex-col rounded-[32px] border border-black/6 bg-[color:var(--panel)] p-5 shadow-[0_20px_60px_rgba(17,60,57,0.08)]">
            <div className="flex items-center justify-between gap-3 border-b border-black/6 pb-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-[color:var(--muted-ink)]">
                  Outreach desk
                </p>
                <h1 className="mt-1.5 font-heading text-xl tracking-[-0.03em]">
                  Internship CRM
                </h1>
              </div>
              <div className="rounded-2xl bg-[color:var(--accent-soft)] p-2.5 text-[color:var(--accent-strong)]">
                <PanelsTopLeft className="h-4 w-4" />
              </div>
            </div>

            <nav aria-label="Dashboard sections" className="mt-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = navIcons[item.id];
                const value =
                  item.id === "unsent"
                    ? dashboard.stats.unsentLeads
                    : dashboard.stats.emailsSent;

                return (
                  <a
                    key={item.id}
                    className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-2xl border border-transparent px-3 py-2.5 transition hover:border-black/6 hover:bg-[color:var(--panel-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
                    href={`#${item.id}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="rounded-xl bg-[color:var(--panel-muted)] p-2 text-[color:var(--accent-strong)]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold">{item.label}</p>
                    </div>
                    <span className="rounded-full bg-[color:var(--panel-muted)] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[color:var(--muted-ink)]">
                      {String(value).padStart(2, "0")}
                    </span>
                  </a>
                );
              })}
            </nav>

            <div className="mt-4 rounded-[28px] bg-[color:var(--panel-muted)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted-ink)]">
                    Send status
                  </p>
                  <p className="mt-1.5 text-sm font-semibold">
                    {dashboard.integration.mode === "live"
                      ? "Live Gmail connected"
                      : "Safe demo workspace"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                    dashboard.integration.mode === "live"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {dashboard.integration.mode}
                </span>
              </div>
              <p className="mt-2.5 text-xs leading-5 text-[color:var(--muted-ink)]">
                {dashboard.integration.connected
                  ? `Tied to ${dashboard.integration.emailAddress ?? "your Gmail account"}.`
                  : "Local history only—connect Gmail before live sending."}
              </p>
              <p className="mt-2 text-xs font-medium text-[color:var(--accent-strong)]">
                {lastSyncedLabel}
              </p>
            </div>

            <section
              aria-labelledby="settings-card-title"
              className="mt-4 rounded-[28px] bg-[color:var(--ink)] p-5 text-[color:var(--panel)] lg:mt-auto"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/55">
                    Sender profile
                  </p>
                  <h2 id="settings-card-title" className="mt-1.5 font-heading text-lg leading-tight">
                    {settingsDraft.fullName || "Your name"}
                  </h2>
                </div>
                <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-white/60" />
              </div>

              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/65">
                <span>{settingsDraft.schoolName || "School"}</span>
                <span>·</span>
                <span>{settingsDraft.city || "City"}, {settingsDraft.state || "ST"}</span>
                <span>·</span>
                <span>{settingsDraft.targetSeason || "Target season"}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <MetricChip label="Daily target" value={`${settingsDraft.dailySendTarget}`} />
                <MetricChip label="Voice" value={settingsDraft.firstName || "Student"} />
              </div>

              <button
                aria-controls="settings-form"
                aria-expanded={settingsExpanded}
                className="mt-4 flex w-full cursor-pointer items-center justify-between rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-left transition hover:bg-white/10"
                onClick={() => setSettingsExpanded((v) => !v)}
                type="button"
              >
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-white/55" />
                  <span className="text-sm font-semibold">Edit profile</span>
                </div>
                {settingsExpanded ? (
                  <ChevronUp className="h-4 w-4 text-white/55" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-white/55" />
                )}
              </button>

              {settingsExpanded && (
                <div className="mt-3 space-y-3 rounded-2xl border border-white/10 bg-white/6 p-4 text-sm" id="settings-form">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LabeledInput
                      label="Full name"
                      onChange={(value) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          fullName: value,
                        }))
                      }
                      value={settingsDraft.fullName}
                    />
                    <LabeledInput
                      label="First name"
                      onChange={(value) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          firstName: value,
                        }))
                      }
                      value={settingsDraft.firstName}
                    />
                  </div>

                  <LabeledInput
                    label="School"
                    onChange={(value) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        schoolName: value,
                      }))
                    }
                    value={settingsDraft.schoolName}
                  />

                  <div className="grid gap-3 sm:grid-cols-[1.2fr_0.8fr]">
                    <LabeledInput
                      label="City"
                      onChange={(value) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          city: value,
                        }))
                      }
                      value={settingsDraft.city}
                    />
                    <LabeledInput
                      label="State"
                      onChange={(value) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          state: value,
                        }))
                      }
                      value={settingsDraft.state}
                    />
                  </div>

                  <LabeledInput
                    label="Target season"
                    onChange={(value) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        targetSeason: value,
                      }))
                    }
                    value={settingsDraft.targetSeason}
                  />

                  <LabeledTextarea
                    label="Tone"
                    minHeightClassName="min-h-20"
                    onChange={(value) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        tone: value,
                      }))
                    }
                    value={settingsDraft.tone}
                  />

                  <label className="block">
                    <span className="mb-1.5 block text-white/65">Daily send target</span>
                    <input
                      className="min-h-11 w-full rounded-2xl border border-white/10 bg-white/8 px-3 py-2.5 text-white outline-none placeholder:text-white/35 focus:border-white/30"
                      min={1}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          dailySendTarget: Number(event.target.value) || current.dailySendTarget,
                        }))
                      }
                      type="number"
                      value={settingsDraft.dailySendTarget}
                    />
                  </label>

                  <LabeledTextarea
                    label="Accomplishments"
                    minHeightClassName="min-h-24"
                    onChange={(value) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        accomplishmentsText: value,
                      }))
                    }
                    value={settingsDraft.accomplishmentsText}
                  />

                  <LabeledTextarea
                    label="Closing notes"
                    minHeightClassName="min-h-20"
                    onChange={(value) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        closingNotes: value,
                      }))
                    }
                    value={settingsDraft.closingNotes}
                  />

                  <button
                    className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-[color:var(--ink)] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isPending}
                    onClick={saveSettings}
                    type="button"
                  >
                    {isPending ? "Saving…" : "Save profile"}
                  </button>
                </div>
              )}
            </section>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="space-y-6">
            <section className="rounded-[32px] border border-black/6 bg-[color:var(--panel)] p-6 shadow-[0_18px_50px_rgba(17,60,57,0.07)] sm:p-7">
              <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-[color:var(--muted-ink)]">
                Internship outreach
              </p>
              <h2 className="mt-3 font-heading text-3xl leading-tight tracking-[-0.04em] sm:text-4xl">
                Find company emails.<br className="hidden sm:block" /> Send clean outreach.
              </h2>
              <p className="mt-3 max-w-xl text-base leading-7 text-[color:var(--muted-ink)]">
                Discover public inboxes, prep drafts automatically, and fire the clean list with one click. Nothing sends until you say so.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-[color:var(--accent-strong)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[color:var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                  onClick={discoverLeads}
                  type="button"
                >
                  {isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <WandSparkles className="h-4 w-4" />
                  )}
                  Find 250 AI startups
                </button>

                <button
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-black/8 px-5 py-2.5 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--panel-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending || eligibleLeadIds.length === 0}
                  onClick={sendAllEligibleLeads}
                  type="button"
                >
                  {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send {eligibleLeadIds.length > 0 ? `${eligibleLeadIds.length} eligible` : "eligible emails"}
                </button>

                {dashboard.integration.connected ? (
                  <span className="rounded-full border border-black/8 px-3.5 py-2.5 text-xs text-[color:var(--muted-ink)]">
                    {lastSyncedLabel}
                  </span>
                ) : canConnectGmail ? (
                  <Link
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-black/8 px-5 py-2.5 text-sm font-semibold text-[color:var(--ink)] hover:bg-[color:var(--panel-muted)]"
                    href="/api/auth/signin/google"
                  >
                    Connect Gmail
                  </Link>
                ) : null}
              </div>

              {notice ? (
                <div
                  aria-live="polite"
                  className="mt-4 flex items-start gap-3 rounded-2xl bg-[color:var(--accent-soft)] px-4 py-3 text-sm text-[color:var(--accent-deep)]"
                >
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{notice}</span>
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {statCards.map((card) => {
                  const Icon = card.icon;
                  const value = dashboard.stats[card.valueKey];

                  return (
                    <article
                      key={card.id}
                      className="flex flex-col gap-3 rounded-[24px] bg-[color:var(--panel-muted)] p-4"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="rounded-xl bg-white p-1.5 text-[color:var(--accent-strong)] shadow-sm">
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <p className="text-xs font-semibold text-[color:var(--muted-ink)]">{card.label}</p>
                      </div>
                      <p className="font-heading text-3xl tracking-[-0.04em]">
                        {value}
                      </p>
                      <p className="text-xs leading-5 text-[color:var(--muted-ink)]">
                        {card.description}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>

            <section
              id="unsent"
              aria-labelledby="unsent-title"
              className="rounded-[32px] border border-black/6 bg-[color:var(--panel)] p-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <SectionHeader
                  description="Opt out anything you don't want, then hit Send eligible above."
                  eyebrow="Unsent"
                  title="Company email queue"
                  titleId="unsent-title"
                />
                <span className="shrink-0 self-start rounded-full bg-[color:var(--panel-muted)] px-3 py-1.5 text-xs font-medium text-[color:var(--muted-ink)]">
                  {eligibleLeadIds.length} eligible
                </span>
              </div>

              <div className="mt-5">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-ink)]" />
                  <input
                    className="min-h-11 w-full rounded-full border border-black/8 bg-[color:var(--panel-muted)] px-11 text-sm outline-none placeholder:text-[color:var(--muted-ink)] focus:border-[color:var(--ring)]"
                    onChange={(event) => setLeadQuery(event.target.value)}
                    placeholder="Search company, email, source…"
                    value={leadQuery}
                  />
                </label>
              </div>

              <div className="mt-4 space-y-2.5">
                {unsentLeads.length ? (
                  unsentLeads.map((lead) => (
                    <LeadRow
                      key={lead.id}
                      expanded={expandedLeadId === lead.id}
                      lead={lead}
                      onPreviewToggle={toggleLeadPreview}
                      onRegenerate={regenerateDraft}
                      onToggleOptOut={toggleOptOut}
                      pending={isPending}
                      previewPending={previewPendingLeadId === lead.id}
                      thread={threadMap.get(lead.id)}
                    />
                  ))
                ) : (
                  <EmptyState
                    description="Try a broader search or run another discovery pass."
                    title="No unsent companies match this view."
                  />
                )}
              </div>
            </section>

            <section
              id="sent"
              aria-labelledby="sent-title"
              className="rounded-[32px] border border-black/6 bg-[color:var(--panel)] p-6"
            >
              <SectionHeader
                description="Every email sent from this workspace, in order."
                eyebrow="Sent"
                title="Sent history"
                titleId="sent-title"
              />

              <div className="mt-5 space-y-3">
                {sentThreads.length ? (
                  sentThreads.map((thread) => <SentItem key={thread.id} thread={thread} />)
                ) : (
                  <EmptyState
                    description="Once you send an email, the thread will show up here."
                    title="Nothing sent yet."
                  />
                )}
              </div>
            </section>

            <section
              id="replies"
              aria-labelledby="replies-title"
              className="rounded-[32px] border border-black/6 bg-[color:var(--panel)] p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <SectionHeader
                  description="Replies bucketed by outcome. Use the brainstorm panel to draft your response."
                  eyebrow="Replies"
                  title="Inbox replies"
                  titleId="replies-title"
                />
                <BackfillButton onDone={(msg) => runAction(() => refreshDashboard(msg))} />
              </div>
              <div className="mt-5">
                <RepliesTabs threads={getSentThreads(dashboard.threads)} />
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function BackfillButton({ onDone }: { onDone: (msg: string) => void }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");

  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/sync-backfill", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; checked?: number; found?: number; mode?: string };
      if (data.mode === "demo") {
        onDone("Connect Gmail to scan for past replies.");
      } else {
        onDone(`Scanned ${data.checked ?? 0} threads — found ${data.found ?? 0} ${data.found === 1 ? "reply" : "replies"}.`);
      }
    } catch {
      onDone("Backfill failed. Try again.");
    } finally {
      setState("done");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  return (
    <button
      className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-black/8 bg-[color:var(--panel-muted)] px-3 py-2 text-xs font-medium text-[color:var(--muted-ink)] transition hover:text-[color:var(--ink)] disabled:opacity-50"
      disabled={state === "running"}
      onClick={() => void run()}
      type="button"
    >
      {state === "running" ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      {state === "running" ? "Scanning…" : state === "done" ? "Done" : "Scan past replies"}
    </button>
  );
}

function SectionHeader({
  titleId,
  eyebrow,
  title,
  description,
}: {
  titleId?: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header>
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted-ink)]">
        {eyebrow}
      </p>
      <h2 id={titleId} className="mt-1.5 font-heading text-xl tracking-[-0.03em]">
        {title}
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-[color:var(--muted-ink)]">
        {description}
      </p>
    </header>
  );
}

function LeadRow({
  expanded,
  lead,
  onPreviewToggle,
  onRegenerate,
  thread,
  pending,
  previewPending,
  onToggleOptOut,
}: {
  expanded: boolean;
  lead: Lead;
  onPreviewToggle: (lead: Lead, thread: OutreachThread | undefined) => void;
  onRegenerate: (lead: Lead) => void;
  thread: OutreachThread | undefined;
  pending: boolean;
  previewPending: boolean;
  onToggleOptOut: (lead: Lead, optedOut: boolean) => void;
}) {
  const optedOut = isLeadOptedOut(lead);
  const sendable = isLeadSendable(lead, thread);
  const reason = getLeadEligibilityReason(lead, thread);
  const preview = getLeadDraftPreview(thread);

  return (
    <article
      className={`rounded-[24px] border p-4 transition ${
        optedOut
          ? "border-amber-200 bg-amber-50/80 opacity-60"
          : sendable
            ? "border-black/6 bg-white"
            : "border-black/6 bg-[color:var(--panel-muted)]"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          className="min-w-0 flex-1 cursor-pointer rounded-2xl text-left transition hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
          onClick={() => onPreviewToggle(lead, thread)}
          type="button"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{lead.companyName}</p>
            <span className="rounded-full bg-[color:var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--accent-strong)]">
              {lead.companyType}
            </span>
            <span className="rounded-full border border-black/8 px-2 py-0.5 text-[10px] text-[color:var(--muted-ink)]">
              {Math.round(lead.confidence * 100)}%
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-black/8 px-2 py-0.5 text-[10px] text-[color:var(--muted-ink)]">
              {previewPending ? (
                <>
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  Preparing preview
                </>
              ) : expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Hide preview
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Preview email
                </>
              )}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--muted-ink)]">
            <span className="font-mono">{lead.contactEmail}</span>
            <span>{lead.source}</span>
          </div>

          {lead.notes ? (
            <p className="mt-2 text-xs leading-5 text-[color:var(--muted-ink)]">{lead.notes}</p>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
              sendable
                ? "bg-emerald-100 text-emerald-800"
                : optedOut
                  ? "bg-amber-100 text-amber-900"
                  : "bg-slate-200 text-slate-600"
            }`}
          >
            {reason}
          </span>
          <a
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-full border border-black/8 px-3.5 text-xs font-semibold text-[color:var(--accent-strong)] hover:bg-[color:var(--panel-muted)] hover:text-[color:var(--ink)]"
            href={lead.website}
            rel="noreferrer"
            target="_blank"
          >
            Visit site
            <ArrowUpRight className="h-3 w-3" />
          </a>
          <button
            className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-full border border-black/8 px-3.5 text-xs font-semibold text-[color:var(--ink)] hover:bg-[color:var(--panel-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            onClick={() => onToggleOptOut(lead, !optedOut)}
            type="button"
          >
            {optedOut ? "Restore" : "Opt out"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 rounded-2xl border border-black/8 bg-[color:var(--panel-muted)] p-4">
          {preview ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                  Subject
                </p>
                <p className="text-sm font-semibold text-[color:var(--ink)]">{preview.subject}</p>
              </div>
              <div className="space-y-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                  Email preview
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--ink)]">
                  {preview.body}
                </p>
              </div>
              <div className="pt-1">
                <button
                  className="inline-flex items-center gap-1.5 rounded-full border border-black/8 px-3 py-1.5 text-xs font-medium text-[color:var(--muted-ink)] hover:bg-white hover:text-[color:var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={previewPending}
                  onClick={() => onRegenerate(lead)}
                  type="button"
                >
                  {previewPending ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Regenerate draft
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-[color:var(--muted-ink)]">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Preparing the exact draft for this company…
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function SentItem({ thread }: { thread: OutreachThread }) {
  return (
    <article className="rounded-[24px] bg-[color:var(--panel-muted)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{thread.companyName}</p>
          <p className="mt-0.5 truncate text-xs text-[color:var(--muted-ink)]">{thread.subject}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent-strong)] shadow-sm">
          {thread.outcomeLabel}
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[color:var(--muted-ink)]">{thread.latestSnippet}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[color:var(--muted-ink)]">
        <span suppressHydrationWarning>
          Sent {thread.sentAt ? formatDistanceToNow(new Date(thread.sentAt), { addSuffix: true }) : "—"}
        </span>
        <span className="text-black/20">·</span>
        <span suppressHydrationWarning>
          Updated {formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}
        </span>
        {thread.gmailThreadUrl ? (
          <>
            <span className="text-black/20">·</span>
            <a
              className="inline-flex items-center gap-1 font-medium text-[color:var(--accent-strong)] transition hover:text-[color:var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
              href={thread.gmailThreadUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open in Gmail
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </>
        ) : null}
      </div>
    </article>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/6 px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-white/65">{label}</span>
      <input
        className="min-h-11 w-full rounded-2xl border border-white/10 bg-white/8 px-3 py-2.5 text-white outline-none placeholder:text-white/35 focus:border-white/30"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  minHeightClassName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minHeightClassName: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-white/65">{label}</span>
      <textarea
        className={`${minHeightClassName} w-full rounded-2xl border border-white/10 bg-white/8 px-3 py-2.5 text-white outline-none placeholder:text-white/35 focus:border-white/30`}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/10 px-4 py-10 text-center">
      <p className="text-sm font-semibold text-[color:var(--ink)]">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-[color:var(--muted-ink)]">{description}</p>
    </div>
  );
}
