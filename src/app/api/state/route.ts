import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readBusRoutesForCaptain, readStateResolved, visibleNotifications } from "@/lib/store";
import type { Drive, Role } from "@/lib/types";

function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

function withLiveLocationPolicy(
  drives: Drive[],
  role: Role,
  userId: string,
): Drive[] {
  return drives.map((d) => {
    if (!d.liveLocation) return d;
    if (role === "admin") return d;
    if (role === "volunteer" && d.status === "assigned" && d.assignedVolunteerId === userId) {
      return d;
    }
    const { liveLocation: _omit, ...rest } = d;
    void _omit;
    return rest;
  });
}

export async function GET(request: NextRequest) {
  const token = tokenFromRequest(request);
  const session = getSession(token);
  if (!session) {
    return NextResponse.json({ error: "Ej inloggad." }, { status: 401 });
  }

  const state = await readStateResolved();
  const myProfile =
    session.role === "volunteer"
      ? state.volunteers.find((v) => v.id === session.userId) ?? null
      : null;
  const busRoutes =
    session.role === "bus_captain" ? await readBusRoutesForCaptain(session.userId) : [];

  return NextResponse.json({
    user: { id: session.userId, role: session.role },
    drives: withLiveLocationPolicy(state.drives, session.role, session.userId),
    notifications: visibleNotifications(state, session.role, session.userId),
    mySeats: myProfile?.seats ?? null,
    busRoutes,
  });
}
