import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { AppState } from "@/lib/types";
import { addNotification, finalizeMatchingIfDue, readState, writeState } from "@/lib/store";

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
  const body = (await request.json().catch(() => ({}))) as { etaMinutes?: number };

  const state = await readState();
  const volunteer = state.volunteers.find((v) => v.id === session.userId);
  const drive = state.drives.find((d) => d.id === id);
  if (!volunteer || !drive || drive.status !== "open") {
    return NextResponse.json({ error: "Körning hittades inte." }, { status: 404 });
  }
  const etaMinutes =
    drive.type === "emergency" ? Number(body.etaMinutes ?? 0) : 0;
  if (drive.type === "emergency" && (!etaMinutes || etaMinutes < 1)) {
    return NextResponse.json({ error: "Ogiltig ETA." }, { status: 400 });
  }
  if (volunteer.seats < drive.seatsNeeded) {
    return NextResponse.json({ error: "För få säten i bilen." }, { status: 400 });
  }

  const offeredAt = new Date().toISOString();
  const offers = drive.offers.some((o) => o.volunteerId === session.userId)
    ? drive.offers.map((o) =>
        o.volunteerId === session.userId ? { ...o, etaMinutes, offeredAt } : o,
      )
    : [...drive.offers, { volunteerId: session.userId, etaMinutes, offeredAt }];

  const updatedDrive = { ...drive, offers };
  let next: AppState = {
    ...state,
    drives: state.drives.map((d) => (d.id === id ? updatedDrive : d)),
  };
  next = addNotification(next, {
    message:
      drive.type === "emergency"
        ? `Volontär ${session.userId} svarade JA på körning ${id} (ETA ${etaMinutes} min).`
        : `Volontär ${session.userId} svarade JA på planerad körning ${id}.`,
    senderRole: "volunteer",
    targetRole: "admin",
    driveId: id,
  });

  const finalized = finalizeMatchingIfDue(next);
  await writeState(finalized.next);
  return NextResponse.json({ ok: true });
}
