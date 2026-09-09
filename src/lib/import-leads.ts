import { randomUUID } from "node:crypto";

import type { Lead } from "@/lib/types";

export interface ImportRow {
  email: string;
  companyName: string;
  contactName: string | null;
  website: string;
  notes: string;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function domainFromEmail(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function websiteFromDomain(domain: string) {
  return domain ? `https://${domain}` : "";
}

function pickField(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias]?.trim();
    if (value) return value;
  }
  return "";
}

/** Minimal RFC-style CSV parse: handles quoted fields and commas inside quotes. */
export function parseCsvText(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!lines) return [];

  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < lines.length; i += 1) {
    const char = lines[i];
    const next = lines[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(current);
      current = "";
      continue;
    }

    if (!inQuotes && char === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0]!.map(normalizeHeader);
  return rows.slice(1).flatMap((cells) => {
    if (cells.every((cell) => !cell.trim())) return [];
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return [record];
  });
}

export function mapImportRow(raw: Record<string, string>): ImportRow | null {
  const email = pickField(raw, ["email", "contactemail", "contact", "address"]).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  const companyName =
    pickField(raw, ["company", "companyname", "organization", "org", "name"]) ||
    domainFromEmail(email).split(".")[0] ||
    "Unknown company";

  const contactName =
    pickField(raw, ["contactname", "firstname", "first", "name", "contact"]) || null;

  const website =
    pickField(raw, ["website", "url", "domain"]) || websiteFromDomain(domainFromEmail(email));

  const notes = pickField(raw, ["notes", "note", "description", "title", "role"]);

  return { email, companyName, contactName, website, notes };
}

export function importRowsToLeads(rows: ImportRow[]): Lead[] {
  const seen = new Set<string>();

  return rows.flatMap((row) => {
    if (seen.has(row.email)) return [];
    seen.add(row.email);

    const domain = domainFromEmail(row.email);
    return [
      {
        id: `lead-${randomUUID()}`,
        companyName: row.companyName,
        website: row.website.startsWith("http") ? row.website : websiteFromDomain(domain),
        domain,
        companyType: "Imported",
        location: "",
        contactEmail: row.email,
        contactName: row.contactName,
        contactType: "general",
        source: "CSV import",
        confidence: 0.85,
        status: "new",
        followUpDate: null,
        notes: row.notes,
        lastThreadId: null,
      } satisfies Lead,
    ];
  });
}

export function parseLeadCsv(text: string) {
  const parsed = parseCsvText(text);
  const rows = parsed.flatMap((row) => {
    const mapped = mapImportRow(row);
    return mapped ? [mapped] : [];
  });
  return {
    parsedRows: parsed.length,
    validRows: rows.length,
    leads: importRowsToLeads(rows),
  };
}
