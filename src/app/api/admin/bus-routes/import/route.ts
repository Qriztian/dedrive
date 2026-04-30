import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { importBusRoutesFromCsv } from "@/lib/store";

function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

export async function POST(request: NextRequest) {
  const session = getSession(tokenFromRequest(request));
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Saknar behörighet." }, { status: 403 });
  }
  const body = (await request.json()) as { csv?: string };
  if (!body.csv?.trim()) {
    return NextResponse.json({ error: "CSV-innehåll saknas." }, { status: 400 });
  }
  const importedLines = await importBusRoutesFromCsv(body.csv);
  return NextResponse.json({ ok: true, importedLines });
}
