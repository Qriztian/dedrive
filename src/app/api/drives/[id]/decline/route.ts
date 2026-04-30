import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { addNotification, readState, writeState } from "@/lib/store";

function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = getSession(tokenFromRequest(request));
  if (!session || session.role !== "volunteer") {
    return NextResponse.json({ error: "Saknar behörighet." }, { status: 403 });
  }
  const { id } = await params;
  const state = await readState();
  const next = addNotification(state, {
    message: `Volontär ${session.userId} svarade NEJ på körning ${id}.`,
    senderRole: "volunteer",
    targetRole: "admin",
    driveId: id,
  });
  await writeState(next);
  return NextResponse.json({ ok: true });
}
