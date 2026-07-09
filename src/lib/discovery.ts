import { randomUUID } from "node:crypto";

import * as cheerio from "cheerio";

import { sanitizeCompanyName } from "@/lib/company-name";
import { DISCOVERY_QUERIES } from "@/lib/constants";
import { pageLooksInvalid } from "@/lib/page-quality";
import type { ContactType, Lead } from "@/lib/types";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BLOCKED_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "css", "js"]);
const PAGE_SUFFIXES = ["/contact", "/about", "/careers", "/team"];
const PAGE_HINTS = /(contact|career|job|team|about|company)/i;
const YC_AI_DIRECTORY_URL = "https://www.ycombinator.com/companies/industry/ai";

type PageKind = "home" | "contact" | "about" | "careers" | "team" | "other";

type EmailCandidate = {
  email: string;
  domainMatch: boolean;
  viaMailto: boolean;
  pageKind: PageKind;
  pageUrl: string;
};

type YcCompany = {
  slug: string;
  name: string;
  batchName: string;
  website: string;
  oneLiner: string;
  longDescription: string;
  tags: string[];
  status: string;
  teamSize: number | null;
  location: string | null;
  ycdcCompanyUrl: string | null;
};

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

function normalizeUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.toString();
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

function looksLikeDuckDuckGoRedirect(href: string) {
  return href.includes("duckduckgo.com/l/");
}

function decodeSearchHref(href: string) {
  if (!looksLikeDuckDuckGoRedirect(href)) {
    return href;
  }

  try {
    const url = new URL(href, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : href;
  } catch {
    return href;
  }
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

function pageLabel(pageKind: PageKind) {
  switch (pageKind) {
    case "contact":
      return "contact";
    case "careers":
      return "careers";
    case "about":
      return "about";
    case "team":
      return "team";
    case "home":
      return "home";
    default:
      return "site";
  }
}

function cleanCompanyTitle(raw: string, fallback: string, domain: string) {
  const firstPass = raw.split("|")[0]?.split(" - ")[0]?.trim() ?? fallback;
  const lowered = firstPass.toLowerCase();

  if (!firstPass || /^(contact|about|careers|jobs|team)$/.test(lowered)) {
    return sanitizeCompanyName(fallback, domain);
  }

  return sanitizeCompanyName(firstPass, domain);
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
  const location = `${pageLabel(candidate.pageKind)} page`;
  const channel = candidate.viaMailto ? "a public mailto link" : "visible page text";
  const domainReason = candidate.domainMatch
    ? "This is a same-domain inbox, which makes it safer for outreach."
    : "The inbox appears to be external, so it is treated as a weaker fallback.";

  return `Found on the ${location} through ${channel}. Public page: ${candidate.pageUrl}. ${domainReason}`;
}

function trimTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function scoreYcCompany(company: YcCompany) {
  const batch = company.batchName.toLowerCase();
  let score = 0;

  if (/2026/.test(batch)) {
    score += 5;
  } else if (/2025/.test(batch)) {
    score += 4;
  } else if (/2024/.test(batch)) {
    score += 2;
  }

  if (company.teamSize === null || company.teamSize <= 10) {
    score += 4;
  } else if (company.teamSize <= 30) {
    score += 3;
  } else if (company.teamSize <= 80) {
    score += 2;
  } else if (company.teamSize >= 300) {
    score -= 2;
  }

  if (company.tags.some((tag) => /ai|artificial-intelligence|machine-learning|developer-tools|agents?/.test(tag))) {
    score += 2;
  }

  if (company.oneLiner || company.longDescription) {
    score += 1;
  }

  return score;
}

function buildYcNotesPrefix(company: YcCompany) {
  const ycContext = `Found in YC's public AI startup directory (${company.batchName.toUpperCase()}).`;
  const description = company.oneLiner || company.longDescription;
  return description ? `${ycContext} ${description}.` : ycContext;
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
    cache: "no-store",
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

async function searchDuckDuckGo(query: string) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const links = new Set<string>();

  $("a").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const decoded = decodeSearchHref(href);
    if (!decoded.startsWith("http")) {
      return;
    }

    if (/duckduckgo\.com|google\.com|linkedin\.com/.test(decoded)) {
      return;
    }

    links.add(decoded);
  });

  return Array.from(links);
}

function collectSameDomainLinks(html: string, baseUrl: string, domain: string) {
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

      if (!PAGE_HINTS.test(next.pathname)) {
        return;
      }

      links.add(next.toString());
    } catch {
      return;
    }
  });

  return Array.from(links).slice(0, 6);
}

function addCandidate(
  bucket: Map<string, EmailCandidate>,
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

  const current = bucket.get(normalized);
  if (!current || scoreCandidate(next) > scoreCandidate(current)) {
    bucket.set(normalized, next);
  }
}

function collectCandidatesFromHtml(
  candidates: Map<string, EmailCandidate>,
  html: string,
  page: string,
  pageKind: PageKind,
  domain: string,
) {
  if (pageLooksInvalid(html)) {
    return;
  }

  const $ = cheerio.load(html);
  const matches = html.match(EMAIL_PATTERN) ?? [];

  for (const match of matches) {
    addCandidate(candidates, match, page, pageKind, false, domain);
  }

  $("a[href^='mailto:']").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const email = href.replace("mailto:", "").split("?")[0]?.trim().toLowerCase();
    if (!email) {
      return;
    }

    addCandidate(candidates, email, page, pageKind, true, domain);
  });
}

function parseYcCompaniesFromHtml(html: string) {
  const $ = cheerio.load(html);
  const dataPage = $("div[data-page]").first().attr("data-page");
  if (!dataPage) {
    return { companies: [] as YcCompany[], currentPage: 1, totalPages: 1 };
  }

  const payload = JSON.parse(dataPage) as {
    props?: {
      companies?: Array<{
        slug?: string;
        name?: string;
        batch_name?: string;
        website?: string;
        one_liner?: string;
        long_description?: string;
        tags?: string[];
        ycdc_status?: string;
        team_size?: number | null;
        location?: string | null;
        ycdc_company_url?: string | null;
      }>;
      currentPage?: number;
      totalPages?: number;
    };
  };

  return {
    currentPage: payload.props?.currentPage ?? 1,
    totalPages: payload.props?.totalPages ?? 1,
    companies: (payload.props?.companies ?? [])
      .map((company) => ({
        slug: company.slug ?? "",
        name: company.name ?? "",
        batchName: company.batch_name ?? "",
        website: company.website ?? "",
        oneLiner: company.one_liner ?? "",
        longDescription: company.long_description ?? "",
        tags: company.tags ?? [],
        status: company.ycdc_status ?? "",
        teamSize: typeof company.team_size === "number" ? company.team_size : null,
        location: company.location ?? null,
        ycdcCompanyUrl: company.ycdc_company_url ?? null,
      }))
      .filter((company) => company.slug && company.name && company.website),
  };
}

async function fetchYcCompanyCandidates(limit: number) {
  const candidates = new Map<string, YcCompany>();
  const maxCandidates = Math.min(Math.max(limit * 2, 120), 500);
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page += 1) {
    const html = await fetchHtml(`${YC_AI_DIRECTORY_URL}?page=${page}`);
    const parsed = parseYcCompaniesFromHtml(html);
    totalPages = parsed.totalPages;

    for (const company of parsed.companies) {
      if (company.status.toLowerCase() !== "active") {
        continue;
      }

      const website = normalizeUrl(company.website);
      if (!website) {
        continue;
      }

      const nextCompany = {
        ...company,
        website,
      };

      if (!candidates.has(nextCompany.slug)) {
        candidates.set(nextCompany.slug, nextCompany);
      }
    }

    if (candidates.size >= maxCandidates) {
      break;
    }
  }

  return Array.from(candidates.values())
    .sort((left, right) => scoreYcCompany(right) - scoreYcCompany(left))
    .slice(0, maxCandidates);
}

async function extractCompanyLead(
  url: string,
  seed?: {
    companyName?: string;
    companyType?: string;
    location?: string | null;
    source?: string;
    notesPrefix?: string;
  },
): Promise<Lead | null> {
  const rootUrl = normalizeUrl(url);
  if (!rootUrl) {
    return null;
  }

  const domain = normalizeDomain(rootUrl);
  const baseRoot = trimTrailingSlash(rootUrl);
  const pages = new Set<string>([rootUrl, ...PAGE_SUFFIXES.map((suffix) => `${baseRoot}${suffix}`)]);
  const candidates = new Map<string, EmailCandidate>();
  let companyName = sanitizeCompanyName(seed?.companyName ?? domain, domain);

  try {
    const rootHtml = await fetchHtml(rootUrl);
    const $ = cheerio.load(rootHtml);
    companyName = cleanCompanyTitle($("title").first().text().trim(), companyName, domain);
    collectCandidatesFromHtml(candidates, rootHtml, rootUrl, "home", domain);

    for (const linkedPage of collectSameDomainLinks(rootHtml, rootUrl, domain)) {
      pages.add(linkedPage);
    }
  } catch {
    // Keep going with explicit fallback pages even if the homepage fails.
  }

  await Promise.all(
    Array.from(pages)
      .filter((page) => page !== rootUrl)
      .map(async (page) => {
        try {
          const html = await fetchHtml(page);
          collectCandidatesFromHtml(candidates, html, page, pageKindForUrl(page, domain), domain);
        } catch {
          return;
        }
      }),
  );

  const ranked = Array.from(candidates.values())
    .map((candidate) => ({
      candidate,
      confidence: scoreCandidate(candidate),
      contactType: guessContactType(candidate.email, candidate.pageKind),
    }))
    .filter(({ confidence }) => confidence >= 0.45)
    .sort((left, right) => right.confidence - left.confidence);

  if (!ranked.length) {
    return null;
  }

  const sameDomainCandidates = ranked.filter(({ candidate }) => candidate.domainMatch);
  const best = (sameDomainCandidates[0] ?? ranked[0])?.candidate;
  const confidence = sameDomainCandidates[0]?.confidence ?? ranked[0]?.confidence ?? 0.45;
  const contactType = sameDomainCandidates[0]?.contactType ?? ranked[0]?.contactType ?? "general";

  if (!best) {
    return null;
  }

  return {
    id: `${domain}:${best.email}`,
    companyName: sanitizeCompanyName(companyName, domain),
    website: rootUrl,
    domain,
    companyType: seed?.companyType ?? "AI company",
    location: seed?.location ?? "Unknown / remote-friendly",
    contactEmail: best.email,
    contactName: null,
    contactType,
    source: seed?.source ?? `Public ${pageLabel(best.pageKind)} page`,
    confidence,
    status: "new",
    followUpDate: null,
    notes: seed?.notesPrefix ? `${seed.notesPrefix} ${explainCandidate(best)}` : explainCandidate(best),
    lastThreadId: null,
  };
}

async function collectLeadsWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<Lead | null>,
  concurrency = 8,
) {
  const results = new Map<string, Lead>();
  let index = 0;

  async function runWorker() {
    while (index < items.length && results.size < limit) {
      const currentIndex = index;
      index += 1;

      const lead = await worker(items[currentIndex] as T);
      if (lead && !results.has(lead.id)) {
        results.set(lead.id, lead);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runWorker));
  return Array.from(results.values()).slice(0, limit);
}

async function discoverYcAiLeads(limit: number) {
  const companies = await fetchYcCompanyCandidates(limit);

  return collectLeadsWithConcurrency(
    companies,
    limit,
    async (company) =>
      extractCompanyLead(company.website, {
        companyName: company.name,
        companyType: `YC AI startup (${company.batchName.toUpperCase()})`,
        location: company.location ?? "Unknown / remote-friendly",
        source: `YC AI directory • ${company.batchName.toUpperCase()}`,
        notesPrefix: buildYcNotesPrefix(company),
      }),
    20,
  );
}

async function discoverSearchLeads(query: string, limit: number) {
  const links = await searchDuckDuckGo(query);
  const leads = await collectLeadsWithConcurrency(
    links.slice(0, Math.max(limit * 3, 30)),
    limit,
    async (link) => extractCompanyLead(link),
    12,
  );

  return leads;
}

export async function discoverPublicLeads(query?: string, limit = 250) {
  if (query) {
    const queryLeads = await discoverSearchLeads(query, limit);
    if (queryLeads.length > 0) {
      return queryLeads;
    }
  } else {
    const ycLeads = await discoverYcAiLeads(limit);
    if (ycLeads.length >= limit) {
      return ycLeads.slice(0, limit);
    }

    const results = new Map(ycLeads.map((lead) => [lead.id, lead]));

    for (const term of DISCOVERY_QUERIES) {
      try {
        const fallbackLeads = await discoverSearchLeads(term, Math.max(limit - results.size, 20));
        for (const lead of fallbackLeads) {
          if (!results.has(lead.id)) {
            results.set(lead.id, lead);
          }
        }
      } catch {
        continue;
      }

      if (results.size >= limit) {
        break;
      }
    }

    if (results.size > 0) {
      return Array.from(results.values()).slice(0, limit);
    }
  }

  return [
    {
      id: randomUUID(),
      companyName: "Fallback AI Startup",
      website: "https://example.com",
      domain: "example.com",
      companyType: "AI startup",
      location: "Remote",
      contactEmail: "hello@example.com",
      contactName: null,
      contactType: "contact" as ContactType,
      source: "Fallback demo discovery",
      confidence: 0.76,
      status: "new" as Lead["status"],
      followUpDate: null,
      notes: "Returned because live discovery yielded no same-domain public inboxes right now.",
      lastThreadId: null,
    },
  ];
}
