import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clearDriveLiveLocation, readState, writeState } from "@/lib/store";

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
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Saknar behörighet." }, { status: 403 });
  }
  const { id } = await params;
  const state = await readState();
  const next = {
    ...state,
    drives: state.drives.map((drive) =>
      drive.id === id ? { ...drive, status: "done" as const } : drive,
    ),
  };
  await writeState(next);
  clearDriveLiveLocation(id);
  return NextResponse.json({ ok: true });
}
