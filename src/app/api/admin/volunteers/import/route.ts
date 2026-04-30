import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hashPin } from "@/lib/security";
import {
  parseVolunteerCsvLines,
  parseVolunteerMatrix,
  type VolunteerImportInput,
} from "@/lib/volunteerSheet";

function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

const MAX_XLSX_BYTES = 5 * 1024 * 1024;

function upsertVolunteers(rows: VolunteerImportInput[]): number {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO volunteers (id, pin_hash, seats) VALUES (?, ?, ?)",
  );
  let count = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      upsert.run(row.id, hashPin(row.pin), row.seats);
      count += 1;
    }
  });
  tx();
  return count;
}

export async function POST(request: NextRequest) {
  const session = getSession(tokenFromRequest(request));
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Saknar behörighet." }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Fil saknas." }, { status: 400 });
    }
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
      return NextResponse.json({ error: "Använd en fil som slutar på .xlsx eller .xls." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "Tom fil." }, { status: 400 });
    }
    if (buf.length > MAX_XLSX_BYTES) {
      return NextResponse.json({ error: "Filen är för stor (max 5 MB)." }, { status: 400 });
    }

    let workbook: ReturnType<typeof XLSX.read>;
    try {
      workbook = XLSX.read(buf, { type: "buffer", cellDates: false });
    } catch {
      return NextResponse.json({ error: "Kunde inte läsa Excel-filen." }, { status: 400 });
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ error: "Arket saknas i filen." }, { status: 400 });
    }
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];

    const rows = parseVolunteerMatrix(matrix);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Inga giltiga rader hittades. Kontrollera rubriker eller kolumnordning id, PIN, säten." },
        { status: 400 },
      );
    }

    const importedVolunteers = upsertVolunteers(rows);
    return NextResponse.json({
      ok: true,
      source: "excel",
      importedVolunteers,
      importedLines: importedVolunteers,
      sheetRows: matrix.length,
    });
  }

  const body = (await request.json()) as { csv?: string };
  const csv = body.csv?.trim() ?? "";
  if (!csv) {
    return NextResponse.json({ error: "CSV-innehåll saknas." }, { status: 400 });
  }

  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return NextResponse.json({ error: "CSV-innehåll saknas." }, { status: 400 });
  }

  const rows = parseVolunteerCsvLines(lines);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Inga giltiga rader i CSV." }, { status: 400 });
  }

  const importedVolunteers = upsertVolunteers(rows);
  return NextResponse.json({
    ok: true,
    source: "csv",
    importedVolunteers,
    importedLines: lines.length,
  });
}
