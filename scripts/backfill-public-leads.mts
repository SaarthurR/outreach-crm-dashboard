import * as cheerio from "cheerio";

import * as gmail from "../src/lib/gmail";
import * as repository from "../src/lib/db/repository";
import * as pageQuality from "../src/lib/page-quality";
import type { ContactType, Lead } from "../src/lib/types";
import * as backfillConfig from "./backfill-public-leads-config.js";
import * as timeoutUtils from "./promise-timeout.js";

const gmailApi = (gmail as { default?: typeof gmail }).default ?? gmail;
const repositoryApi = (repository as { default?: typeof repository }).default ?? repository;
const pageQualityApi = (pageQuality as { default?: typeof pageQuality }).default ?? pageQuality;
const backfillConfigApi = (backfillConfig as { default?: typeof backfillConfig }).default ?? backfillConfig;
const timeoutUtilsApi = (timeoutUtils as { default?: typeof timeoutUtils }).default ?? timeoutUtils;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BLOCKED_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "css", "js"]);
const YC_AI_DIRECTORY_URL = "https://www.ycombinator.com/companies/industry/ai";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const CONCURRENCY = 40;
const FETCH_TIMEOUT_MS = 2500;
const COMPANY_TIMEOUT_MS = 12000;
const FALLBACK_SUFFIXES = ["/contact", "/team", "/about", "/careers"];
const PERSIST_BATCH_SIZE = 120;

type PageKind = "home" | "contact" | "about" | "careers" | "team" | "other";

type EmailCandidate = {
  email: string;
  pageUrl: string;
  pageKind: PageKind;
  domainMatch: boolean;
  viaMailto: boolean;
};

type YcCompany = {
  name: string;
  batchName: string;
  website: string;
  oneLiner: string;
  longDescription: string;
  location: string | null;
};

function normalizeUrl(raw: string) {
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

function normalizeDomain(rawUrl: string) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? rawUrl;
  }
}

function trimTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function emailLocalPart(email: string) {
  return email.split("@")[0]?.toLowerCase() ?? "";
}

function isFounderLocal(local: string) {
  return /(founder|founders|ceo|cofounder|co-founder|founding)/.test(local);
}

function isCareersLocal(local: string) {
  return /(career|jobs|recruit|talent|hr)/.test(local);
}

function isContactLocal(local: string) {
  return /^(contact|hello|hi)$/.test(local);
}

function isGenericInboxLocal(local: string) {
  return /^(info|support|admin|office|ops)$/.test(local);
}

function isPersonalMailboxLocal(local: string) {
  if (
    !local ||
    isFounderLocal(local) ||
    isCareersLocal(local) ||
    isContactLocal(local) ||
    isGenericInboxLocal(local) ||
    /^(team|help|press|media|legal|privacy|security)$/.test(local)
  ) {
    return false;
  }

  return /^[a-z]+(?:[._-][a-z]+){0,2}$/.test(local);
}

function pageKindForUrl(url: string, domain: string): PageKind {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();

    if (parsed.hostname.replace(/^www\./, "") !== domain) {
      return "other";
    }

    if (path === "/" || path === "") {
      return "home";
    }

    if (path.includes("contact")) {
      return "contact";
    }

    if (path.includes("career") || path.includes("job")) {
      return "careers";
    }

    if (path.includes("about")) {
      return "about";
    }

    if (path.includes("team") || path.includes("company")) {
      return "team";
    }
  } catch {
    return "other";
  }

  return "other";
}

function guessContactType(email: string, pageKind: PageKind): ContactType {
  const local = emailLocalPart(email);

  if (isFounderLocal(local) || ((pageKind === "team" || pageKind === "about") && isPersonalMailboxLocal(local))) {
    return "founder";
  }

  if (isCareersLocal(local)) {
    return "careers";
  }

  if (isContactLocal(local)) {
    return "contact";
  }

  return "general";
}

function looksLikeRealMailbox(email: string) {
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2) {
    return false;
  }

  const [local, domain] = parts;
  if (!local || !domain || !domain.includes(".")) {
    return false;
  }

  const tld = domain.split(".").at(-1) ?? "";
  if (BLOCKED_TLDS.has(tld)) {
    return false;
  }

  if (local.startsWith("bg-") || local.startsWith("icon-")) {
    return false;
  }

  return true;
}

function scoreCandidate(candidate: EmailCandidate) {
  const local = emailLocalPart(candidate.email);
  let score = 0.42;

  if (candidate.domainMatch) {
    score += 0.28;
  } else {
    score -= 0.28;
  }

  if (candidate.viaMailto) {
    score += 0.12;
  }

  switch (candidate.pageKind) {
    case "contact":
      score += 0.16;
      break;
    case "careers":
      score += 0.14;
      break;
    case "about":
    case "team":
      score += 0.1;
      break;
    case "home":
      score += 0.04;
      break;
    default:
      break;
  }

  if (isFounderLocal(local)) {
    score += 0.11;
  } else if (candidate.domainMatch && candidate.pageKind === "team" && isPersonalMailboxLocal(local)) {
    score += 0.2;
  } else if (candidate.domainMatch && candidate.pageKind === "about" && isPersonalMailboxLocal(local)) {
    score += 0.16;
  } else if (isCareersLocal(local)) {
    score += candidate.domainMatch ? 0.1 : -0.12;
  } else if (isContactLocal(local)) {
    score += 0.08;
  } else if (isGenericInboxLocal(local)) {
    score += 0.02;
  }

  if (candidate.pageKind === "contact" && isGenericInboxLocal(local)) {
    score -= 0.04;
  }

  if (/(noreply|no-reply|donotreply)/.test(local)) {
    score -= 0.5;
  }

  return Math.max(0.2, Math.min(0.99, Number(score.toFixed(2))));
}

function explainCandidate(candidate: EmailCandidate) {
  const pageLabel =
    candidate.pageKind === "contact"
      ? "contact"
      : candidate.pageKind === "careers"
        ? "careers"
        : candidate.pageKind === "about"
          ? "about"
          : candidate.pageKind === "team"
            ? "team"
            : candidate.pageKind === "home"
              ? "home"
              : "site";

  return `Found on the ${pageLabel} page at ${candidate.pageUrl}. This is an explicitly public same-domain inbox.`;
}

async function fetchHtml(url: string, parentSignal?: AbortSignal) {
  const timeoutController = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([timeoutController.signal, parentSignal])
    : timeoutController.signal;
  const timeout = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
      },
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseYcCompaniesFromHtml(html: string) {
  const $ = cheerio.load(html);
  const dataPage = $("div[data-page]").first().attr("data-page");
  if (!dataPage) {
    return { companies: [] as YcCompany[], totalPages: 1 };
  }

  const payload = JSON.parse(dataPage) as {
    props?: {
      companies?: Array<{
        name?: string;
        batch_name?: string;
        website?: string;
        one_liner?: string;
        long_description?: string;
        ycdc_status?: string;
        location?: string | null;
      }>;
      totalPages?: number;
    };
  };

  const companies = (payload.props?.companies ?? [])
    .filter((company) => company.ycdc_status?.toLowerCase() === "active")
    .map((company) => ({
      name: company.name ?? "",
      batchName: company.batch_name ?? "",
      website: company.website ?? "",
      oneLiner: company.one_liner ?? "",
      longDescription: company.long_description ?? "",
      location: company.location ?? null,
    }))
    .filter((company) => company.name && company.website);

  return {
    companies,
    totalPages: payload.props?.totalPages ?? 1,
  };
}

async function fetchYcCompanies(limit: number, offset: number) {
  const results: YcCompany[] = [];
  let validCompanyCount = 0;
  let totalPages = 1;

  for (let page = 1; page <= totalPages && results.length < limit; page += 1) {
    const html = await fetchHtml(`${YC_AI_DIRECTORY_URL}?page=${page}`);
    const parsed = parseYcCompaniesFromHtml(html);
    totalPages = parsed.totalPages;

    for (const company of parsed.companies) {
      const website = normalizeUrl(company.website);
      if (!website) {
        continue;
      }

      validCompanyCount += 1;
      if (validCompanyCount <= offset) {
        continue;
      }

      results.push({
        ...company,
        website,
      });

      if (results.length >= limit) {
        break;
      }
    }
  }

  return results;
}

function addCandidate(
  candidates: Map<string, EmailCandidate>,
  email: string,
  pageUrl: string,
  pageKind: PageKind,
  viaMailto: boolean,
  domain: string,
) {
  const normalized = email.toLowerCase();
  if (!looksLikeRealMailbox(normalized)) {
    return;
  }

  const next: EmailCandidate = {
    email: normalized,
    pageUrl,
    pageKind,
    viaMailto,
    domainMatch: normalized.endsWith(`@${domain}`),
  };

  const current = candidates.get(normalized);
  if (!current || scoreCandidate(next) > scoreCandidate(current)) {
    candidates.set(normalized, next);
  }
}

function collectCandidatesFromHtml(
  candidates: Map<string, EmailCandidate>,
  html: string,
  pageUrl: string,
  pageKind: PageKind,
  domain: string,
) {
  if (pageQualityApi.pageLooksInvalid(html)) {
    return;
  }

  const $ = cheerio.load(html);
  const matches = html.match(EMAIL_PATTERN) ?? [];

  for (const match of matches) {
    addCandidate(candidates, match, pageUrl, pageKind, false, domain);
  }

  $("a[href^='mailto:']").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const email = href.replace("mailto:", "").split("?")[0]?.trim().toLowerCase();
    if (!email) {
      return;
    }

    addCandidate(candidates, email, pageUrl, pageKind, true, domain);
  });
}

function collectLinkedPages(html: string, baseUrl: string, domain: string) {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    try {
      const next = new URL(href, baseUrl);
      if (next.hostname.replace(/^www\./, "") !== domain) {
        return;
      }

      if (!/(contact|career|job|team|about|company)/i.test(next.pathname)) {
        return;
      }

      links.add(next.toString());
    } catch {
      return;
    }
  });

  return Array.from(links).slice(0, 4);
}

async function extractLead(company: YcCompany, signal?: AbortSignal): Promise<Lead | null> {
  const rootUrl = normalizeUrl(company.website);
  if (!rootUrl) {
    return null;
  }

  const domain = normalizeDomain(rootUrl);
  const baseRoot = trimTrailingSlash(rootUrl);
  const candidates = new Map<string, EmailCandidate>();
  const pageTargets = new Set<string>();

  try {
    const rootHtml = await fetchHtml(rootUrl, signal);
    collectCandidatesFromHtml(candidates, rootHtml, rootUrl, "home", domain);

    for (const page of collectLinkedPages(rootHtml, rootUrl, domain)) {
      pageTargets.add(page);
    }
  } catch {
    // Continue with explicit fallback paths below.
  }

  if (pageTargets.size === 0) {
    for (const suffix of FALLBACK_SUFFIXES) {
      pageTargets.add(`${baseRoot}${suffix}`);
    }
  }

  await Promise.all(
    Array.from(pageTargets).map(async (pageUrl) => {
      try {
        const html = await fetchHtml(pageUrl, signal);
        collectCandidatesFromHtml(candidates, html, pageUrl, pageKindForUrl(pageUrl, domain), domain);
      } catch {
        return;
      }
    }),
  );

  const ranked = Array.from(candidates.values())
    .filter((candidate) => candidate.domainMatch)
    .map((candidate) => ({
      candidate,
      confidence: scoreCandidate(candidate),
      contactType: guessContactType(candidate.email, candidate.pageKind),
    }))
    .filter(({ confidence }) => confidence >= 0.45)
    .sort((left, right) => right.confidence - left.confidence);

  const best = ranked[0];
  if (!best) {
    return null;
  }

  const description = company.oneLiner || company.longDescription;
  const ycContext = `Found in YC's public AI startup directory (${company.batchName.toUpperCase()}).`;

  return {
    id: `${domain}:${best.candidate.email}`,
    companyName: company.name,
    website: rootUrl,
    domain,
    companyType: `YC AI startup (${company.batchName.toUpperCase()})`,
    location: company.location ?? "Unknown / remote-friendly",
    contactEmail: best.candidate.email,
    contactName: null,
    contactType: best.contactType,
    source: `YC AI directory • ${company.batchName.toUpperCase()}`,
    confidence: best.confidence,
    status: "new",
    followUpDate: null,
    notes: `${ycContext}${description ? ` ${description}.` : ""} ${explainCandidate(best.candidate)}`,
    lastThreadId: null,
  };
}

async function main() {
  const started = Date.now();
  const options = backfillConfigApi.resolveBackfillOptions();
  const companies = await fetchYcCompanies(options.candidatePool, options.companyOffset);
  const results = new Map<string, Lead>();
  const before = await repositoryApi.listLeads();
  const beforeSendable = before.filter((lead) => !["sent", "replied", "skipped", "invalid"].includes(lead.status)).length;
  const neededLeads = options.targetAdditionalLeads;
  const existingIds = new Set(before.map((lead) => lead.id));

  if (neededLeads === 0) {
    console.log(
      JSON.stringify(
        {
          companiesScanned: 0,
          companyOffset: options.companyOffset,
          discovered: 0,
          beforeCount: before.length,
          afterCount: before.length,
          drafted: 0,
          skippedDrafts: 0,
          elapsedMs: Date.now() - started,
          statusCounts: before.reduce(
            (counts, lead) => {
              counts[lead.status] = (counts[lead.status] ?? 0) + 1;
              return counts;
            },
            {} as Record<string, number>,
          ),
          sample: [],
        },
        null,
        2,
      ),
    );
    return;
  }

  let lastAnnouncedCount = 0;

  for (let offset = 0; offset < companies.length && results.size < neededLeads; offset += PERSIST_BATCH_SIZE) {
    const batch = companies.slice(offset, offset + PERSIST_BATCH_SIZE);
    let index = 0;

    async function worker() {
      while (index < batch.length && results.size < neededLeads) {
        const currentIndex = index;
        index += 1;

        const company = batch[currentIndex] as YcCompany;
        const companyAbortController = new AbortController();
        let lead: Lead | null = null;

        try {
          lead = await timeoutUtilsApi.withTimeout(
            extractLead(company, companyAbortController.signal),
            COMPANY_TIMEOUT_MS,
            `Lead extraction for ${company.name}`,
            () => companyAbortController.abort(),
          );
        } catch (error) {
          if (error instanceof Error && error instanceof timeoutUtilsApi.TimeoutError) {
            console.error(error.message);
            continue;
          }

          throw error;
        }

        if (lead && !existingIds.has(lead.id) && !results.has(lead.id)) {
          results.set(lead.id, lead);
          existingIds.add(lead.id);
          await repositoryApi.upsertLeads([lead]);

          if (results.size - lastAnnouncedCount >= 25 || results.size === neededLeads) {
            lastAnnouncedCount = results.size;
            console.error(`Found ${results.size}/${neededLeads} new leads...`);
          }
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));

    const leads = Array.from(results.values()).slice(0, neededLeads);
    await repositoryApi.upsertLeads(leads);
    console.error(
      `Persisted ${leads.length}/${neededLeads} new leads after scanning ${Math.min(offset + batch.length, companies.length)} companies...`,
    );
  }

  const leads = Array.from(results.values()).slice(0, neededLeads);
  const drafts = await gmailApi.generateAndStoreDraftBatch(leads.map((lead) => lead.id));
  const after = await repositoryApi.listLeads();
  const afterSendable = after.filter((lead) => !["sent", "replied", "skipped", "invalid"].includes(lead.status)).length;
  const statusCounts = after.reduce(
    (counts, lead) => {
      counts[lead.status] = (counts[lead.status] ?? 0) + 1;
      return counts;
    },
    {} as Record<string, number>,
  );

  console.log(
    JSON.stringify(
      {
        companiesScanned: companies.length,
        targetAdditionalLeads: neededLeads,
        candidatePool: options.candidatePool,
        companyOffset: options.companyOffset,
        discovered: leads.length,
        beforeCount: before.length,
        afterCount: after.length,
        beforeSendable,
        afterSendable,
        drafted: drafts.readyCount,
        skippedDrafts: drafts.skippedCount,
        elapsedMs: Date.now() - started,
        statusCounts,
        sample: leads.slice(0, 12).map((lead) => ({
          companyName: lead.companyName,
          email: lead.contactEmail,
          source: lead.source,
          confidence: lead.confidence,
        })),
      },
      null,
      2,
    ),
  );
}

await main();
