import type { Lead } from "@/lib/types";

const DOMAIN_PREFIXES = ["app", "get", "go", "hello", "join", "start", "try", "use", "with"];
const TAGLINE_SEPARATORS = /\s+(?:[—–]|--|\||·)\s+/;
const GENERIC_SENTENCE_STARTERS = /^(create|build|turn|your|the|win)\b/i;

function titleCaseFromDomainLabel(label: string) {
  return label
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function deriveBrandFromDomain(domain: string) {
  const hostname = domain.replace(/^www\./, "").toLowerCase();
  const [firstLabel = ""] = hostname.split(".");
  const labels = firstLabel.split("-").filter(Boolean);

  while (labels.length > 1 && DOMAIN_PREFIXES.includes(labels[0] ?? "")) {
    labels.shift();
  }

  const normalized = labels.join("-") || firstLabel;
  return normalized ? titleCaseFromDomainLabel(normalized) : "your team";
}

function looksLikeMarketingPhrase(name: string) {
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  if (!trimmed) {
    return true;
  }

  if (/[,:.!?]/.test(trimmed)) {
    return true;
  }

  if (GENERIC_SENTENCE_STARTERS.test(trimmed)) {
    return true;
  }

  if (words.length >= 4) {
    return true;
  }

  return false;
}

export function sanitizeCompanyName(rawName: string, domain: string) {
  const fallback = deriveBrandFromDomain(domain);
  const compact = rawName.replace(/\s+/g, " ").trim();

  if (!compact) {
    return fallback;
  }

  const stripped = compact.split(TAGLINE_SEPARATORS)[0]?.trim() ?? compact;
  const candidate = stripped.replace(/[,:.!?]+$/g, "").trim();

  if (!candidate) {
    return fallback;
  }

  if (looksLikeMarketingPhrase(candidate)) {
    return fallback;
  }

  return candidate;
}

export function leadCompanyName(lead: Pick<Lead, "companyName" | "domain">) {
  return sanitizeCompanyName(lead.companyName, lead.domain);
}
