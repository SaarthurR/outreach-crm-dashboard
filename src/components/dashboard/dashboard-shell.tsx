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
  Upload,
  FlaskConical,
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
  needsResponse,
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
    label: "In queue",
    icon: Building2,
    valueKey: "unsentLeads",
  },
  {
    id: "ready",
    label: "Ready",
    icon: MailCheck,
    valueKey: "sendableLeads",
  },
  {
    id: "opted-out",
    label: "Opted out",
    icon: ShieldMinus,
    valueKey: "optedOut",
  },
  {
    id: "sent",
    label: "Sent",
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
  const [activeView, setActiveView] = useState<NavView>("unsent");
  const [leadQuery, setLeadQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [testAddress, setTestAddress] = useState("saanvi.g126@gmail.com");
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
  const dailyCap = dashboard.stats.dailyCap;
  const sentToday = dashboard.stats.sentToday;
  const remainingToday = dashboard.stats.remainingToday;

  const eligibleLeadIds = getUnsentLeads(dashboard.leads, dashboard.threads)
    .filter((lead) => isLeadSendable(lead, threadMap.get(lead.id)))
    .map((lead) => lead.id);
  // Matches the Inbox tab's "Replies" section: things Saarth still needs to answer.
  // A starred thread is being tracked by hand in its own section, so it's excluded
  // here the same way it's excluded from Replies there.
  const replyCount = getSentThreads(dashboard.threads).filter(
    (thread) => needsResponse(thread) && !thread.starred,
  ).length;
  const lastSyncedLabel =
    dashboard.integration.connected && dashboard.integration.lastSyncedAt
      ? `Last checked ${formatDistanceToNow(new Date(dashboard.integration.lastSyncedAt), {
          addSuffix: true,
        })}`
      : "Demo mode only. Connect Gmail before live sending.";

  function switchView(view: NavView) {
    setActiveView(view);
    setLeadQuery("");
    setExpandedLeadId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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

  function importCsv(file: File) {
    runAction(async () => {
      const form = new FormData();
      form.set("file", file);

      const response = await fetch("/api/import", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as {
        ok: boolean;
        importedCount?: number;
        draftedCount?: number;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "CSV import did not finish cleanly.");
      }

      await refreshDashboard(
        `Imported ${payload.importedCount ?? 0} contacts and prepared ${payload.draftedCount ?? 0} drafts. Nothing was sent.`,
      );
    });
  }

  function toggleStar(threadId: string, starred: boolean) {
    runAction(async () => {
      const response = await fetch(`/api/threads/${threadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ starred }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not update the star.");
      }

      await refreshDashboard();
    });
  }

  function syncReplies() {
    runAction(async () => {
      const response = await fetch("/api/sync", { method: "POST" });
      const payload = (await response.json()) as {
        ok: boolean;
        synced?: number;
        mode?: string;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Inbox sync failed.");
      }

      const message =
        payload.mode === "demo"
          ? "Demo mode — connect Gmail to sync real replies."
          : `Synced ${payload.synced ?? 0} new ${payload.synced === 1 ? "message" : "messages"}.`;

      await refreshDashboard(message);
    });
  }

  function sendTestEmail() {
    const to = window.prompt(
      "Send one test email to which address?\n\nThis does not use up a daily send and does not mark any company as contacted.",
      testAddress,
    );

    if (!to) {
      return;
    }

    setTestAddress(to);

    runAction(async () => {
      const response = await fetch("/api/test-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        mode?: string;
        sampleCompany?: string;
        sampleRecipient?: string;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Test send failed.");
      }

      await refreshDashboard(
        payload.mode === "demo"
          ? `Demo mode, so nothing was sent. The draft used ${payload.sampleCompany} as the sample company.`
          : `Test email sent to ${to}, using the ${payload.sampleCompany} draft. No company was marked as contacted.`,
      );
    });
  }

  function sendAllEligibleLeads() {
    if (!eligibleLeadIds.length) {
      setNotice("No eligible companies are left in the unsent queue right now.");
      return;
    }

    const willSend = Math.min(remainingToday, eligibleLeadIds.length);

    if (willSend <= 0) {
      setNotice(
        `Daily cap reached: ${sentToday} of ${dailyCap} sent today. The rest stay queued until tomorrow.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `Send ${willSend} real ${willSend === 1 ? "email" : "emails"} now?\n\n` +
        `${eligibleLeadIds.length} companies are queued, but the daily cap is ${dailyCap} and ` +
        `${sentToday} already went out today.\n` +
        `Each send waits 8 to 20 seconds, so this takes about ${Math.ceil((willSend * 14) / 60)} minutes.\n\n` +
        `This cannot be undone.`,
    );

    if (!confirmed) {
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
    <div className="min-h-[100dvh] bg-[color:var(--canvas)] text-[color:var(--ink)]">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-5 sm:px-6 lg:flex-row lg:gap-6 lg:px-8">
        <aside className="lg:sticky lg:top-5 lg:h-[calc(100dvh-2.5rem)] lg:w-[320px] lg:shrink-0 lg:self-start">
          <div className="surface flex h-full flex-col overflow-y-auto p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] pb-4">
              <div>
                <h1 className="font-heading text-lg text-[color:var(--ink)]">
                  Internship CRM
                </h1>
                <p className="mt-1 text-xs text-[color:var(--muted-ink)]">
                  One Gmail. Upload, send, track replies.
                </p>
              </div>
              <div className="rounded-[var(--radius-sm)] bg-[color:var(--accent-soft)] p-2 text-[color:var(--accent-strong)]">
                <PanelsTopLeft className="h-4 w-4" strokeWidth={1.75} />
              </div>
            </div>

            <nav aria-label="Dashboard sections" className="mt-3 space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const Icon = navIcons[item.id];
                const value =
                  item.id === "unsent"
                    ? dashboard.stats.unsentLeads
                    : item.id === "sent"
                      ? dashboard.stats.emailsSent
                      : replyCount;
                const selected = activeView === item.id;

                return (
                  <button
                    key={item.id}
                    aria-current={selected ? "page" : undefined}
                    className={`flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)] ${
                      selected
                        ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-deep)]"
                        : "hover:bg-[color:var(--panel-muted)]"
                    }`}
                    onClick={() => switchView(item.id)}
                    type="button"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon
                        className={`h-4 w-4 ${selected ? "text-[color:var(--accent-strong)]" : "text-[color:var(--muted-ink)]"}`}
                        strokeWidth={1.75}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="truncate text-[11px] text-[color:var(--muted-ink)]">{item.helper}</p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                        selected
                          ? "bg-white/80 text-[color:var(--accent-deep)]"
                          : "bg-[color:var(--panel-muted)] text-[color:var(--muted-ink)]"
                      }`}
                    >
                      {value}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="surface-quiet mt-3 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  {dashboard.integration.mode === "live"
                    ? "Gmail connected"
                    : "Demo mode"}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    dashboard.integration.mode === "live"
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-amber-50 text-amber-900"
                  }`}
                >
                  {dashboard.integration.mode}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-[color:var(--muted-ink)]">
                {dashboard.integration.connected
                  ? dashboard.integration.emailAddress ?? "Connected account"
                  : "Connect Gmail before live sending."}
              </p>
              <p className="mt-1.5 text-xs text-[color:var(--muted-ink)]">{lastSyncedLabel}</p>
            </div>

            <section
              aria-labelledby="settings-card-title"
              className="mt-3 rounded-[var(--radius)] bg-[color:var(--ink)] p-4 text-[color:var(--panel)] lg:mt-auto"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="settings-card-title" className="font-heading text-base leading-tight">
                    {settingsDraft.fullName || "Your name"}
                  </h2>
                  <p className="mt-1 text-xs text-white/60">Sender profile</p>
                </div>
                <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-white/50" strokeWidth={1.75} />
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
          <div className="space-y-5">
            <section className="surface p-5 sm:p-6">
              <h2 className="font-heading text-2xl leading-tight text-[color:var(--ink)] sm:text-3xl">
                Upload a list. Send and track replies.
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[color:var(--muted-ink)] sm:text-base sm:leading-7">
                Import a CSV, send from your Gmail account, and see replies in one place. Nothing goes out until you click send.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <label className="btn-primary">
                  {isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  Import CSV
                  <input
                    accept=".csv,text/csv"
                    className="sr-only"
                    disabled={isPending}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) importCsv(file);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>

                <button
                  className="btn-secondary"
                  disabled={isPending || eligibleLeadIds.length === 0 || remainingToday === 0}
                  onClick={sendAllEligibleLeads}
                  type="button"
                >
                  {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={1.75} />}
                  Send {Math.min(remainingToday, eligibleLeadIds.length)} today
                </button>

                <button
                  className="btn-secondary"
                  disabled={isPending}
                  onClick={syncReplies}
                  type="button"
                >
                  {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" strokeWidth={1.75} />}
                  Sync replies
                </button>

                <button
                  className="btn-secondary"
                  disabled={isPending}
                  onClick={sendTestEmail}
                  type="button"
                >
                  {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" strokeWidth={1.75} />}
                  Send a test
                </button>

                <span className="rounded-full border border-[color:var(--border)] px-3 py-2 text-xs tabular-nums text-[color:var(--muted-ink)]">
                  {sentToday}/{dailyCap} today · {eligibleLeadIds.length} queued
                </span>

                {dashboard.integration.connected ? null : canConnectGmail ? (
                  <Link
                    className="btn-secondary"
                    href="/api/auth/signin/google"
                  >
                    Connect Gmail
                  </Link>
                ) : null}
              </div>

              {notice ? (
                <div
                  aria-live="polite"
                  className="mt-4 flex items-start gap-2.5 rounded-[var(--radius-sm)] bg-[color:var(--accent-soft)] px-3.5 py-3 text-sm text-[color:var(--accent-deep)]"
                >
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>{notice}</span>
                </div>
              ) : null}

              <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {statCards.map((card) => {
                  const Icon = card.icon;
                  const value = dashboard.stats[card.valueKey];

                  return (
                    <article
                      key={card.id}
                      className="surface-quiet flex flex-col gap-2 p-3.5"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-[color:var(--accent-strong)]" strokeWidth={1.75} />
                        <p className="text-xs font-medium text-[color:var(--muted-ink)]">{card.label}</p>
                      </div>
                      <p className="font-heading text-2xl tabular-nums tracking-[-0.04em]">
                        {value}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>

            {activeView === "unsent" ? (
            <section
              aria-labelledby="unsent-title"
              className="surface p-5 sm:p-6"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <SectionHeader
                  description="Opt out anything you don't want, then hit Send today."
                  title="Company queue"
                  titleId="unsent-title"
                />
                <span className="shrink-0 self-start rounded-full bg-[color:var(--panel-muted)] px-2.5 py-1 text-xs tabular-nums text-[color:var(--muted-ink)] sm:self-auto">
                  {eligibleLeadIds.length} eligible
                </span>
              </div>

              <div className="mt-4">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-ink)]" strokeWidth={1.75} />
                  <input
                    className="input-field pl-10"
                    onChange={(event) => setLeadQuery(event.target.value)}
                    placeholder="Search company, email, source…"
                    value={leadQuery}
                  />
                </label>
              </div>

              <div className="mt-3 space-y-2">
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
                    description="Try a broader search or import another CSV."
                    title="No unsent companies match this view."
                  />
                )}
              </div>
            </section>
            ) : null}

            {activeView === "sent" ? (
            <section
              aria-labelledby="sent-title"
              className="surface p-5 sm:p-6"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <SectionHeader
                  description="Every email sent from this workspace."
                  title="Sent"
                  titleId="sent-title"
                />
                <span className="shrink-0 self-start rounded-full bg-[color:var(--panel-muted)] px-2.5 py-1 text-xs tabular-nums text-[color:var(--muted-ink)] sm:self-auto">
                  {sentThreads.length}
                </span>
              </div>

              <div className="mt-4">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-ink)]" strokeWidth={1.75} />
                  <input
                    className="input-field pl-10"
                    onChange={(event) => setLeadQuery(event.target.value)}
                    placeholder="Search sent company or subject…"
                    value={leadQuery}
                  />
                </label>
              </div>

              <div className="mt-3 space-y-2">
                {sentThreads.length ? (
                  sentThreads.map((thread) => <SentItem key={thread.id} thread={thread} />)
                ) : (
                  <EmptyState
                    description="Once you send an email, it shows up here."
                    title="Nothing sent yet."
                  />
                )}
              </div>
            </section>
            ) : null}

            {activeView === "replies" ? (
            <section
              aria-labelledby="replies-title"
              className="surface p-5 sm:p-6"
            >
              <div className="flex items-end justify-between gap-4">
                <SectionHeader
                  description="Replies you need to answer first. Star the promising ones."
                  title="Inbox"
                  titleId="replies-title"
                />
                <BackfillButton onDone={(msg) => runAction(() => refreshDashboard(msg))} />
              </div>
              <div className="mt-4">
                <RepliesTabs onToggleStar={toggleStar} threads={getSentThreads(dashboard.threads)} />
              </div>
            </section>
            ) : null}
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
      className="btn-secondary !min-h-9 !px-3 !py-1.5 !text-xs"
      disabled={state === "running"}
      onClick={() => void run()}
      type="button"
    >
      {state === "running" ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
      {state === "running" ? "Scanning…" : state === "done" ? "Done" : "Scan past replies"}
    </button>
  );
}

function SectionHeader({
  titleId,
  title,
  description,
}: {
  titleId?: string;
  title: string;
  description: string;
}) {
  return (
    <header>
      <h2 id={titleId} className="font-heading text-lg text-[color:var(--ink)]">
        {title}
      </h2>
      <p className="mt-1 text-sm leading-6 text-[color:var(--muted-ink)]">
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
      className={`rounded-[var(--radius-sm)] border p-3.5 transition ${
        optedOut
          ? "border-amber-200/80 bg-amber-50/70 opacity-70"
          : sendable
            ? "border-[color:var(--border)] bg-white"
            : "border-transparent bg-[color:var(--panel-muted)]"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          className="min-w-0 flex-1 cursor-pointer rounded-[var(--radius-sm)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
          onClick={() => onPreviewToggle(lead, thread)}
          type="button"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{lead.companyName}</p>
            <span className="rounded-full bg-[color:var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent-strong)]">
              {lead.companyType}
            </span>
            <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] tabular-nums text-[color:var(--muted-ink)]">
              {Math.round(lead.confidence * 100)}%
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--muted-ink)]">
              {previewPending ? (
                <>
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  Preparing
                </>
              ) : expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" strokeWidth={1.75} />
                  Hide
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
                  Preview
                </>
              )}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--muted-ink)]">
            <span className="font-mono">{lead.contactEmail}</span>
            <span>{lead.source}</span>
          </div>

          {lead.notes ? (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[color:var(--muted-ink)]">{lead.notes}</p>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              sendable
                ? "bg-emerald-50 text-emerald-800"
                : optedOut
                  ? "bg-amber-50 text-amber-900"
                  : "bg-[color:var(--panel-muted)] text-[color:var(--muted-ink)]"
            }`}
          >
            {reason}
          </span>
          <a
            className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-[color:var(--border)] px-3 text-xs font-medium text-[color:var(--accent-strong)] hover:bg-[color:var(--panel-muted)] hover:text-[color:var(--ink)]"
            href={lead.website}
            rel="noreferrer"
            target="_blank"
          >
            Site
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
          <button
            className="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-full border border-[color:var(--border)] px-3 text-xs font-medium text-[color:var(--ink)] hover:bg-[color:var(--panel-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            onClick={() => onToggleOptOut(lead, !optedOut)}
            type="button"
          >
            {optedOut ? "Restore" : "Opt out"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--panel-muted)] p-3.5">
          {preview ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-[color:var(--muted-ink)]">Subject</p>
                <p className="text-sm font-semibold text-[color:var(--ink)]">{preview.subject}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-[color:var(--muted-ink)]">Email</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--ink)]">
                  {preview.body}
                </p>
              </div>
              <div className="pt-1">
                <button
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-[color:var(--muted-ink)] hover:text-[color:var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={previewPending}
                  onClick={() => onRegenerate(lead)}
                  type="button"
                >
                  {previewPending ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
                  )}
                  Regenerate draft
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-[color:var(--muted-ink)]">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Preparing draft…
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function SentItem({ thread }: { thread: OutreachThread }) {
  return (
    <article className="surface-quiet p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{thread.companyName}</p>
          <p className="mt-0.5 truncate text-xs text-[color:var(--muted-ink)]">{thread.subject}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent-strong)] ring-1 ring-[color:var(--border)]">
          {thread.outcomeLabel}
        </span>
      </div>
      <p className="mt-2.5 line-clamp-2 text-xs leading-5 text-[color:var(--muted-ink)]">{thread.latestSnippet}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--muted-ink)]">
        <span suppressHydrationWarning>
          Sent {thread.sentAt ? formatDistanceToNow(new Date(thread.sentAt), { addSuffix: true }) : "-"}
        </span>
        {thread.gmailThreadUrl ? (
          <a
            className="inline-flex items-center gap-1 font-medium text-[color:var(--accent-strong)] hover:text-[color:var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
            href={thread.gmailThreadUrl}
            rel="noreferrer"
            target="_blank"
          >
            Gmail
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-white/10 bg-white/6 px-3 py-2">
      <p className="text-[11px] text-white/50">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
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
    <div className="rounded-[var(--radius-sm)] border border-dashed border-[color:var(--border-strong)] px-4 py-10 text-center">
      <p className="text-sm font-medium text-[color:var(--ink)]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[color:var(--muted-ink)]">{description}</p>
    </div>
  );
}
