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
  connectionLine: string;
  askLine: string;
  /** Fills the one blank in the template: "I'm particularly drawn to ___". */
  drawnTo: string;
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
  // Scraped marketing copy arrives as several taglines glued together. Only the
  // first clause is safe to quote back at a founder; the rest reads as machine output.
  const firstClause = value.split(/(?<=[.!?])\s+/)[0] ?? value;
  const clipped = firstClause.length > 120 ? `${firstClause.slice(0, 120).replace(/[\s,;:]+\S*$/, "")}` : firstClause;

  return clipped
    .replace(/[.!?]+$/, "")
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

  // One offer, not a list. A list reads as "I will do anything", which is what
  // every other cold email says, and it gives the reader nothing to say yes to.
  if (/(robot|hardware|motor|arm|actuator|drone|firmware)/.test(signal)) {
    return "bring-up and testing on the hardware side";
  }

  if (/(outbound|email|sales|crm|lead|growth|marketing)/.test(signal)) {
    return "your outbound email setup, which is the thing I did at Frizzle";
  }

  if (/(eval|qa|test|agent|automation|workflow|api|infra|developer|tool|platform|model)/.test(signal)) {
    return "grinding through evals and edge cases nobody has time for";
  }

  if (/(design|react|product|customer|consumer|video|audio|speech|translation|game|shopping)/.test(signal)) {
    return "testing product flows and writing up what breaks";
  }

  if (/(portfolio|capital|real estate|trading|hedge|banking|finance)/.test(signal)) {
    return "backtesting and data cleanup, which is close to what I do for my own trading";
  }

  return "the small unglamorous work that gets pushed to next sprint";
}

// The half of the email that does the work: a real thread from what this company
// does back to something Saarth has actually done. Generic flattery gets deleted;
// a connection the reader recognises makes them answer.
export function buildConnectionLine(detail: string | null, lead: Lead) {
  return connectionFor(detail, lead).line;
}

/**
 * How real the thread back to Saarth's own work is. "strong" means he has actually
 * done the thing. "general" means he has not, and the line says so rather than
 * inventing a connection, because a fake one is worse than an honest one.
 * The send queue is ordered by this: strong matches go out first.
 */
export type ConnectionStrength = "strong" | "general";

export function connectionFor(
  detail: string | null,
  lead: Lead,
): { line: string; strength: ConnectionStrength } {
  const signal = [lead.companyType, lead.source, lead.notes, detail].join(" ").toLowerCase();
  const strong = (line: string) => ({ line, strength: "strong" as const });

  if (/(outbound|cold email|deliverability|sales|crm|lead gen|growth|marketing|sdr|prospect)/.test(signal)) {
    return strong(
      "is the problem I spent the summer on at Frizzle, and I still do not know how you keep deliverability up past a few hundred sends a day",
    );
  }

  if (/(robot|hardware|motor|arm|actuator|drone|firmware|teleop|manipulat|fleet|truck|warehouse|manufactur)/.test(signal)) {
    return strong(
      "is close to my arm bring-up work at DeepAware, and I want to know how you decided what to build versus buy",
    );
  }

  if (/(on.device|phone|mobile|edge|local model|quantiz|embedded)/.test(signal)) {
    return strong(
      "caught my attention because I run models locally, and I want to know what breaks first pushing one onto a phone",
    );
  }

  if (/(agent|eval|benchmark|llm|model|inference|fine.tun|prompt|rag)/.test(signal)) {
    return strong(
      "caught my attention because I build on models all year, and I cannot work out how you tell a real eval from one that looks good",
    );
  }

  if (/(trading|hedge|portfolio|quant|market|broker|capital|banking|fintech|payment|invoice|accounting|ledger)/.test(signal)) {
    return strong(
      "caught my attention because I trade futures on my own strategies, and I want to know how you close the gap from backtest to live money",
    );
  }

  if (/(school|student|education|edtech|learning|course|teacher|tutor|university)/.test(signal)) {
    return strong(
      "caught my attention because I built a grades dashboard my classmates use, and the hard part was getting anyone to open it twice",
    );
  }

  if (/(developer|api|infra|tool|workflow|automation|devops|platform|sdk|cli|data ?(science|scientist)|notebook|jupyter)/.test(signal)) {
    return strong(
      "caught my attention because I built three CLIs this year for things my school would not give me access to, and I want to know how you picked what to build first",
    );
  }

  // No honest thread exists. Say that plainly and ask a real question instead of
  // inventing a connection, which is the thing that makes these emails read as fake.
  return {
    line: "caught my attention because I have shipped four products this year and none in a space this specific, so I want to know how you found the problem in the first place",
    strength: "general",
  };
}

// Deterministic fill for "I'm particularly drawn to ___" when no model is available
// or when the model's clause reads as machine-written.
export function buildDrawnTo(detail: string | null, lead: Lead) {
  const clean = (detail ?? "").split(/(?<=[.!?])\s+/).find((part) => {
    const p = part.toLowerCase();
    return part.trim().length > 12 && !/^found (in|on)\b/.test(p) && !/^public page:/.test(p);
  });

  if (clean) {
    const phrase = clean.replace(/[.!?]+$/, "").trim();
    const clipped = phrase.length > 90 ? phrase.slice(0, 90).replace(/[\s,;:]+\S*$/, "") : phrase;
    // Lowercasing the first letter makes it read on from "drawn to", but not when the
    // first word is an acronym or a brand: "AI for..." must not become "aI for...".
    const firstWord = clipped.split(/\s+/)[0] ?? "";
    const keepCase = /^[A-Z]{2,}/.test(firstWord) || /[a-z][A-Z]/.test(firstWord);
    const lead = keepCase ? clipped : `${clipped.charAt(0).toLowerCase()}${clipped.slice(1)}`;
    return `what you're building with ${lead}`;
  }

  return `the problem ${leadCompanyName(lead)} picked to work on`;
}

// One small, specific ask. Never a list, never "pick your brain".
export function buildAskLine(detail: string | null, lead: Lead) {
  const signal = [lead.companyType, lead.source, lead.notes, detail].join(" ").toLowerCase();

  if (/(robot|hardware|motor|arm|actuator|drone|firmware)/.test(signal)) {
    return "Would love 15 minutes to hear what the hardware side of an early team actually looks like day to day.";
  }

  if (/(outbound|cold email|sales|crm|growth|marketing)/.test(signal)) {
    return "Would love 15 minutes to hear how you think about that, and what the work actually looks like on your side.";
  }

  return "Would love 15 minutes to hear how you got to that, and what the work actually looks like day to day.";
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
    return `Your site suggests ${roleFocusPhrase(roleDetail)} matters to the team right now. I could help with ${helpAreas}.`;
  }

  return `I could help with ${helpAreas}.`;
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
      connectionLine: buildConnectionLine(leadDetail, lead),
      askLine: buildAskLine(leadDetail, lead),
      drawnTo: buildDrawnTo(leadDetail, lead),
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
      connectionLine: buildConnectionLine(scrapedDetail, lead),
      askLine: buildAskLine(scrapedDetail, lead),
      drawnTo: buildDrawnTo(scrapedDetail, lead),
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
    connectionLine: buildConnectionLine(null, lead),
    askLine: buildAskLine(null, lead),
    drawnTo: buildDrawnTo(null, lead),
    roleDetail,
    helpAreas: fallbackHelpAreas,
    reason: roleDetail
      ? "Used the public careers page to tie the draft to a real team need even though the broader company description stayed generic."
      : "Fell back to the base template because no strong public company detail was available.",
  };
}
