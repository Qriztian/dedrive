import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { upsertPushSubscription } from "@/lib/push";

function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

export async function POST(request: NextRequest) {
  const session = getSession(tokenFromRequest(request));
  if (!session) {
    return NextResponse.json({ error: "Ej inloggad." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      }
    | null;
  const endpoint = body?.endpoint?.trim() ?? "";
  const p256dh = body?.keys?.p256dh?.trim() ?? "";
  const auth = body?.keys?.auth?.trim() ?? "";
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Ogiltig subscription." }, { status: 400 });
  }
  upsertPushSubscription(
    { endpoint, keys: { p256dh, auth } },
    session.userId,
    session.role,
  );
  return NextResponse.json({ ok: true });
}
