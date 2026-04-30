import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendPushToRole } from "@/lib/push";
import { addNotification, readState, writeState } from "@/lib/store";
import { Drive, DriveType, VehicleType } from "@/lib/types";

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

  const body = (await request.json()) as {
    pickupAddress?: string;
    destinationAddress?: string;
    neededAt?: string;
    seatsNeeded?: number;
    delegateFirstName?: string;
    note?: string;
    type?: DriveType;
    vehicleType?: VehicleType;
  };

  if (!body.pickupAddress || !body.destinationAddress || !body.seatsNeeded) {
    return NextResponse.json({ error: "Saknar obligatoriska fält." }, { status: 400 });
  }

  const state = await readState();
  const drive: Drive = {
    id: `d-${Date.now()}`,
    pickupAddress: body.pickupAddress.trim(),
    destinationAddress: body.destinationAddress.trim(),
    neededAt: body.neededAt ? new Date(body.neededAt).toISOString() : new Date().toISOString(),
    seatsNeeded: Number(body.seatsNeeded),
    delegateFirstName: (body.delegateFirstName ?? "").trim(),
    note: (body.note ?? "").trim(),
    type: (body.type === "scheduled" ? "scheduled" : "emergency") as DriveType,
    vehicleType: (body.vehicleType === "bus" || body.vehicleType === "minibus"
      ? body.vehicleType
      : "car") as VehicleType,
    status: "open" as const,
    createdAt: new Date().toISOString(),
    offers: [],
  };

  const withDrive = { ...state, drives: [drive, ...state.drives] };
  const next = addNotification(withDrive, {
    message: `Ny ${drive.type === "emergency" ? "akut" : "planerad"} körning: ${drive.pickupAddress} -> ${drive.destinationAddress}.`,
    senderRole: "admin",
    targetRole: "volunteer",
    driveId: drive.id,
  });
  await writeState(next);
  await sendPushToRole("volunteer", {
    title: drive.type === "emergency" ? "Nytt akut behov" : "Nytt planerat behov",
    body: `${drive.pickupAddress} -> ${drive.destinationAddress}`,
    url: "/",
  });
  return NextResponse.json({ ok: true, driveId: drive.id });
}
