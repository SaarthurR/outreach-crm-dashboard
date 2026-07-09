import * as cheerio from "cheerio";

const ERROR_PAGE_PATTERNS = [
  /\b404\b/i,
  /page not found/i,
  /\bnot found\b/i,
  /does not exist/i,
  /access denied/i,
  /\bforbidden\b/i,
  /temporarily unavailable/i,
  /under construction/i,
  /coming soon/i,
  /just a moment/i,
  /enable cookies/i,
  /requested url was not found/i,
];

export function normalizePageText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function looksLikeErrorText(value: string) {
  const normalized = normalizePageText(value);
  if (!normalized) {
    return false;
  }

  return ERROR_PAGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function pageLooksInvalid(html: string) {
  const $ = cheerio.load(html);
  const title = normalizePageText($("title").first().text());
  const h1 = normalizePageText($("h1").first().text());
  const description = normalizePageText($("meta[name='description']").attr("content") ?? "");
  const bodySnippet = normalizePageText($("body").text()).slice(0, 500);

  return [title, h1, description, bodySnippet].some(looksLikeErrorText);
}
