import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readState, upsertDriveLiveLocation, clearDriveLiveLocation } from "@/lib/store";

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
  const body = (await request.json().catch(() => null)) as {
    lat?: unknown;
    lng?: unknown;
  } | null;
  if (!body || typeof body.lat !== "number" || typeof body.lng !== "number") {
    return NextResponse.json({ error: "Ogiltiga koordinater." }, { status: 400 });
  }
  const { lat, lng } = body;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Ogiltiga koordinater." }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "Koordinater utanför giltigt intervall." }, { status: 400 });
  }

  const state = await readState();
  const drive = state.drives.find((d) => d.id === id);
  if (!drive || drive.status !== "assigned" || drive.assignedVolunteerId !== session.userId) {
    return NextResponse.json({ error: "Ingen aktiv tilldelad körning." }, { status: 403 });
  }

  upsertDriveLiveLocation(id, session.userId, lat, lng);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = getSession(tokenFromRequest(request));
  if (!session || session.role !== "volunteer") {
    return NextResponse.json({ error: "Saknar behörighet." }, { status: 403 });
  }
  const { id } = await params;
  const state = await readState();
  const drive = state.drives.find((d) => d.id === id);
  if (!drive || drive.assignedVolunteerId !== session.userId) {
    return NextResponse.json({ error: "Saknar behörighet." }, { status: 403 });
  }
  clearDriveLiveLocation(id);
  return NextResponse.json({ ok: true });
}
