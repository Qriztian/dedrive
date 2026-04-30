import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/auth";

function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

export async function GET(request: NextRequest) {
  const session = getSession(tokenFromRequest(request));
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Saknar behörighet." }, { status: 403 });
  }

  const rows = [
    ["Volontärnr", "PIN", "Säten"],
    ["301", "1301", 4],
    ["302", "1302", 6],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Volontärer");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  const body = new Uint8Array(buf);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="volontar-import-mall.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
