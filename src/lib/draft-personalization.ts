import * as cheerio from "cheerio";

import { leadCompanyName } from "@/lib/company-name";
import { looksLikeErrorText, normalizePageText, pageLooksInvalid } from "@/lib/page-quality";
import type { Lead } from "@/lib/types";

type PersonalizationKind = "lead" | "scrape" | "fallback";

export type DraftPersonalization = {
  companyName: string;
  detail: string | null;
  detailKind: PersonalizationKind;
  introLine: string | null;
  offerLine: string;
  roleDetail: string | null;
  helpAreas: string;
  reason: string;
};

const GENERIC_DETAIL_PATTERNS = [
  /^ai (startup|company)$/i,
  /^ai (design )?tool(ing)? company$/i,
  /^general startup support/i,
  /^public (contact|about|team|careers) page$/i,
  /^found on the /i,
  /^this is /i,
];
const CAREERS_PATH_HINT = /(career|job|jobs|hiring|role|roles|openings?)/i;
const ROLE_KEYWORDS =
  /\b(engineer|engineering|designer|design|researcher|research|product|growth|sales|support|operations|ops|frontend|backend|full[- ]stack|ml|machine learning|data|qa|go[- ]to[- ]market|gtm)\b/i;
const ROLE_PREFIX_PATTERN =
  /(?:we(?:'re| are)? hiring(?: for)?|looking for|open roles?(?: include)?|hiring now:?|join us as)\s+(.+)/i;

function splitSentences(value: string) {
  return normalizePageText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function looksLikeUsefulDetail(value: string) {
  const normalized = value.replace(/[.!?]+$/g, "").trim();

  if (!normalized) {
    return false;
  }

  if (normalized.split(/\s+/).length < 4) {
    return false;
  }

  if (looksLikeErrorText(normalized)) {
    return false;
  }

  return !GENERIC_DETAIL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function cleanDetailCandidate(value: string) {
  return normalizePageText(value)
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function toNaturalPhrase(value: string) {
  return value
    .split(/\s+/)
    .map((word) => {
      if (!word) {
        return word;
      }

      if (/^[A-Z0-9]{2,}$/.test(word) || /[a-z][A-Z]/.test(word) || /\d/.test(word)) {
        return word;
      }

      return word.toLowerCase();
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function detailFromLeadNotes(lead: Lead) {
  for (const sentence of splitSentences(lead.notes)) {
    if (
      /^Found in YC's public AI startup directory/i.test(sentence) ||
      /^Found on the /i.test(sentence) ||
      /^Public page:/i.test(sentence) ||
      /^This is /i.test(sentence) ||
      /^The inbox /i.test(sentence) ||
      /^Returned because /i.test(sentence)
    ) {
      continue;
    }

    const cleaned = cleanDetailCandidate(sentence);
    if (looksLikeUsefulDetail(cleaned)) {
      return cleaned;
    }
  }

  return null;
}

function looksLikeNavigationText(value: string) {
  return /^(contact|about|careers|jobs|team|home)$/i.test(value.trim());
}

function stripBrandFromText(value: string, companyName: string) {
  const normalized = normalizePageText(value);
  const escapedCompany = companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalized
    .replace(new RegExp(`^${escapedCompany}\\s*[:|-]?\\s*`, "i"), "")
    .replace(new RegExp(`\\b${escapedCompany}\\b`, "ig"), "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchCompanyDetail(lead: Lead) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(lead.website, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    if (pageLooksInvalid(html)) {
      return null;
    }

    const $ = cheerio.load(html);
    const companyName = leadCompanyName(lead);
    const candidates = [
      $("meta[name='description']").attr("content") ?? "",
      $("meta[property='og:description']").attr("content") ?? "",
      $("h1").first().text(),
      $("main p").first().text(),
      $("body p").first().text(),
    ]
      .map((candidate) => stripBrandFromText(candidate, companyName))
      .map(cleanDetailCandidate)
      .filter(Boolean);

    const useful = candidates.filter(
      (c) => !looksLikeNavigationText(c) && looksLikeUsefulDetail(c),
    );
    if (useful.length === 0) return null;
    const unique = [...new Set(useful)];
    return unique.join(". ").slice(0, 400);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function roleFromLeadNotes(lead: Lead) {
  for (const sentence of splitSentences(lead.notes)) {
    if (!ROLE_KEYWORDS.test(sentence)) {
      continue;
    }

    const cleaned = cleanRoleCandidate(sentence);
    if (cleaned) {
      return cleaned;
    }
  }

  return null;
}

function cleanRoleCandidate(value: string) {
  const normalized = cleanDetailCandidate(value);
  if (!normalized || normalized.length > 120) {
    return null;
  }

  if (looksLikeErrorText(normalized)) {
    return null;
  }

  const directRole = normalized.match(ROLE_PREFIX_PATTERN)?.[1]?.trim();
  if (directRole) {
    return directRole.replace(/[.!?]+$/g, "").trim();
  }

  if (!ROLE_KEYWORDS.test(normalized)) {
    return null;
  }

  return normalized;
}

function looksLikeCareerLink(text: string, href: string) {
  return CAREERS_PATH_HINT.test(text) || CAREERS_PATH_HINT.test(href);
}

function collectCareerPageUrls(html: string, baseUrl: string, domain: string) {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const text = normalizePageText($(element).text());
    if (!looksLikeCareerLink(text, href)) {
      return;
    }

    try {
      const next = new URL(href, baseUrl);
      if (next.hostname.replace(/^www\./, "") !== domain) {
        return;
      }

      links.add(next.toString());
    } catch {
      return;
    }
  });

  return Array.from(links);
}

function extractRoleDetailFromHtml(html: string, companyName: string) {
  if (pageLooksInvalid(html)) {
    return null;
  }

  const $ = cheerio.load(html);
  const candidates = $("h1, h2, h3, a, li, p")
    .toArray()
    .map((element) => $(element).text())
    .map((candidate) => stripBrandFromText(candidate, companyName))
    .map(cleanRoleCandidate)
    .filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (looksLikeNavigationText(candidate)) {
      continue;
    }

    if (ROLE_KEYWORDS.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function fetchCareerRoleDetail(lead: Lead) {
  const companyName = leadCompanyName(lead);
  const rootUrl = new URL(lead.website).toString();
  const domain = new URL(lead.website).hostname.replace(/^www\./, "");
  const defaultPages = ["/careers", "/jobs"].map((path) => new URL(path, rootUrl).toString());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const rootResponse = await fetch(rootUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const pages = new Set(defaultPages);

    if (rootResponse.ok) {
      const rootHtml = await rootResponse.text();
      for (const page of collectCareerPageUrls(rootHtml, rootUrl, domain)) {
        pages.add(page);
      }
    }

    for (const page of Array.from(pages).slice(0, 4)) {
      try {
        const response = await fetch(page, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          },
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          continue;
        }

        const html = await response.text();
        const roleDetail = extractRoleDetailFromHtml(html, companyName);
        if (roleDetail) {
          return roleDetail;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildIntroLine(lead: Lead, detail: string | null, detailKind: PersonalizationKind) {
  const companyName = leadCompanyName(lead);
  if (!detail) {
    return null;
  }

  const detailPhrase = toNaturalPhrase(detail);
  if (!detailPhrase) {
    return null;
  }

  if (/yc/i.test(lead.source)) {
    return `I found ${companyName} through YC — specifically the work on ${detailPhrase}.`;
  }

  if (detailKind === "scrape") {
    return `I looked up ${companyName} and the focus on ${detailPhrase} is what made me write.`;
  }

  return `${companyName} came up when I was looking at AI teams — the ${detailPhrase} work in particular.`;
}

function buildHelpAreas(detail: string | null, lead: Lead) {
  const signal = [lead.companyType, lead.source, lead.notes, detail].join(" ").toLowerCase();

  if (/(eval|qa|test|agent|automation|workflow|api|infra|developer|tool|platform|robot|model)/.test(signal)) {
    return "testing edge cases, QA, docs, research, or small automation work";
  }

  if (/(design|react|product|customer|website visitors|outbound|support|consumer|video|audio|speech|translation|game|shopping)/.test(signal)) {
    return "testing product flows, user feedback, docs, or support";
  }

  if (/(portfolio|capital|real estate|trading|hedge|research|banking|finance)/.test(signal)) {
    return "testing product flows, research, docs, or careful QA";
  }

  return "testing, research, docs, support, or simple web tasks";
}

function roleFocusPhrase(roleDetail: string | null) {
  const signal = roleDetail?.toLowerCase() ?? "";

  if (/(design|designer|frontend|product)/.test(signal)) {
    return "product quality and user experience";
  }

  if (/(research|ml|machine learning|data|model|qa)/.test(signal)) {
    return "quality, evaluation, and careful iteration";
  }

  if (/(support|operations|ops|sales|growth|gtm)/.test(signal)) {
    return "user-facing details and day-to-day execution";
  }

  if (/(engineer|engineering|backend|full[- ]stack|api|infra)/.test(signal)) {
    return "product quality and the small details around how things work";
  }

  return "the details that make the product work well";
}

function buildOfferLine(roleDetail: string | null, helpAreas: string) {
  if (roleDetail) {
    return `From what I could tell on your site, ${roleFocusPhrase(roleDetail)} seem to matter to the team — I think I could help with ${helpAreas}.`;
  }

  return `I think I could help with ${helpAreas}.`;
}

export async function buildDraftPersonalization(lead: Lead): Promise<DraftPersonalization> {
  const companyName = leadCompanyName(lead);
  const leadDetail = detailFromLeadNotes(lead);
  const noteRoleDetail = roleFromLeadNotes(lead);

  if (leadDetail) {
    const helpAreas = buildHelpAreas(leadDetail, lead);
    return {
      companyName,
      detail: leadDetail,
      detailKind: "lead",
      introLine: buildIntroLine(lead, leadDetail, "lead"),
      offerLine: buildOfferLine(noteRoleDetail, helpAreas),
      roleDetail: noteRoleDetail,
      helpAreas,
      reason: "Used the stored lead notes because they already included a concrete company detail.",
    };
  }

  const scrapedDetail = await fetchCompanyDetail(lead);
  const roleDetail = await fetchCareerRoleDetail(lead);
  if (scrapedDetail) {
    const helpAreas = buildHelpAreas(`${scrapedDetail} ${roleDetail ?? ""}`.trim(), lead);
    return {
      companyName,
      detail: scrapedDetail,
      detailKind: "scrape",
      introLine: buildIntroLine(lead, scrapedDetail, "scrape"),
      offerLine: buildOfferLine(roleDetail, helpAreas),
      roleDetail,
      helpAreas,
      reason: roleDetail
        ? "Scraped the public company site because the stored lead data was too generic, then used the public careers copy to tie the draft to a real team need."
        : "Scraped the public company site because the stored lead data was too generic for a natural personalized line.",
    };
  }

  const fallbackHelpAreas = buildHelpAreas(roleDetail, lead);
  return {
    companyName,
    detail: null,
    detailKind: "fallback",
    introLine: null,
    offerLine: buildOfferLine(roleDetail, fallbackHelpAreas),
    roleDetail,
    helpAreas: fallbackHelpAreas,
    reason: roleDetail
      ? "Used the public careers page to tie the draft to a real team need even though the broader company description stayed generic."
      : "Fell back to the base template because no strong public company detail was available.",
  };
}
