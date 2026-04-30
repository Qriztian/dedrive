import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { removePushSubscription } from "@/lib/push";

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
      }
    | null;
  const endpoint = body?.endpoint?.trim() ?? "";
  if (!endpoint) {
    return NextResponse.json({ error: "Endpoint saknas." }, { status: 400 });
  }
  removePushSubscription(endpoint, session.userId);
  return NextResponse.json({ ok: true });
}
