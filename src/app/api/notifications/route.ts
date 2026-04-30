import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendPushToRole } from "@/lib/push";
import { addNotification, readState, writeState } from "@/lib/store";
import { Role } from "@/lib/types";

function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

export async function POST(request: NextRequest) {
  const session = getSession(tokenFromRequest(request));
  if (!session || (session.role !== "admin" && session.role !== "airport")) {
    return NextResponse.json({ error: "Saknar behörighet." }, { status: 403 });
  }
  const body = (await request.json()) as {
    message?: string;
    targetRole?: "all" | Role;
    targetVolunteerId?: string;
    driveId?: string;
  };
  if (!body.message?.trim()) {
    return NextResponse.json({ error: "Meddelande krävs." }, { status: 400 });
  }
  const state = await readState();
  const next = addNotification(state, {
    message: body.message.trim(),
    senderRole: session.role,
    targetRole: body.targetRole ?? "all",
    targetVolunteerId: body.targetVolunteerId?.trim() || undefined,
    driveId: body.driveId?.trim() || undefined,
  });
  await writeState(next);
  await sendPushToRole(body.targetRole ?? "all", {
    title: "Nytt meddelande",
    body: body.message.trim(),
    url: "/",
  });
  return NextResponse.json({ ok: true });
}
