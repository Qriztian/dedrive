import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { verifyPin } from "@/lib/security";
import { getDb } from "@/lib/db";
import { readState } from "@/lib/store";
import { Role } from "@/lib/types";

const ADMIN_ID = "admin";
const ADMIN_PIN = "2468";
const AIRPORT_ID = "airport";
const AIRPORT_PIN = "1357";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { id?: string; pin?: string };
  const id = (body.id ?? "").trim();
  const pin = (body.pin ?? "").trim();

  let role: Role | null = null;
  let userId = id;

  if (id === ADMIN_ID && pin === ADMIN_PIN) {
    role = "admin";
  } else if (id === AIRPORT_ID && pin === AIRPORT_PIN) {
    role = "airport";
  } else {
    const state = await readState();
    const volunteer = state.volunteers.find((entry) => entry.id === id);
    if (volunteer && verifyPin(pin, volunteer.pinHash)) {
      role = "volunteer";
      userId = volunteer.id;
    } else {
      const db = getDb();
      const captain = db
        .prepare("SELECT id, pin_hash FROM bus_captains WHERE id = ?")
        .get(id) as { id: string; pin_hash: string } | undefined;
      if (captain && verifyPin(pin, captain.pin_hash)) {
        role = "bus_captain";
        userId = captain.id;
      }
    }
  }

  if (!role) {
    return NextResponse.json({ error: "Fel ID eller PIN." }, { status: 401 });
  }

  const token = createSession(userId, role);
  return NextResponse.json({ token, user: { id: userId, role } });
}
