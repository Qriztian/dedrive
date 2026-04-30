import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { addNotification, clearDriveLiveLocation, readState, writeState } from "@/lib/store";

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
  const drive = state.drives.find((d) => d.id === id);
  if (!drive) {
    return NextResponse.json({ error: "Körning hittades inte." }, { status: 404 });
  }
  let next = {
    ...state,
    // Arkivera direkt när den markeras klar.
    drives: state.drives.filter((d) => d.id !== id),
  };
  next = addNotification(next, {
    message: `Körning ${id} markerad klar och arkiverad.`,
    senderRole: "admin",
    targetRole: "admin",
    driveId: id,
  });
  if (drive.assignedVolunteerId) {
    next = addNotification(next, {
      message: `Körning ${id} är klar. Tack för insatsen!`,
      senderRole: "admin",
      targetRole: "volunteer",
      targetVolunteerId: drive.assignedVolunteerId,
      driveId: id,
    });
  }
  await writeState(next);
  clearDriveLiveLocation(id);
  return NextResponse.json({ ok: true });
}
