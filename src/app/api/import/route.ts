import { NextResponse } from "next/server";

import { appendActivity, upsertLeads } from "@/lib/db/repository";
import { generateAndStoreDraftBatch } from "@/lib/gmail";
import { parseLeadCsv } from "@/lib/import-leads";
import { ensureAuthorizedUser } from "@/lib/route-auth";

export async function POST(request: Request) {
  const unauthorized = await ensureAuthorizedUser();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";
    let csvText = "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ ok: false, error: "Upload a CSV file." }, { status: 400 });
      }
      csvText = await file.text();
    } else {
      const body = (await request.json().catch(() => ({}))) as { csv?: string };
      csvText = body.csv ?? "";
    }

    if (!csvText.trim()) {
      return NextResponse.json({ ok: false, error: "CSV content is empty." }, { status: 400 });
    }

    const { parsedRows, validRows, leads } = parseLeadCsv(csvText);
    if (leads.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No valid rows found. CSV needs an email column (email, contactEmail, or address).",
          parsedRows,
          validRows,
        },
        { status: 400 },
      );
    }

    await upsertLeads(leads);
    const drafts = await generateAndStoreDraftBatch(leads.map((lead) => lead.id));

    await appendActivity({
      type: "lead_discovered",
      title: `Imported ${leads.length} contacts from CSV`,
      detail: `${parsedRows} rows parsed, ${validRows} with valid emails.`,
      occurredAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      importedCount: leads.length,
      parsedRows,
      validRows,
      draftedCount: drafts.readyCount,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 },
    );
  }
}
