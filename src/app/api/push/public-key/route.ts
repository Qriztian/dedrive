import { NextRequest, NextResponse } from "next/server";
import { resolveVapidPublicKeyTrimmedValidated } from "@/lib/serverVapidPublicKey";

export async function GET(request: NextRequest) {
  const publicKey = (await resolveVapidPublicKeyTrimmedValidated()) ?? "";

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/plain")) {
    return new NextResponse(publicKey, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=us-ascii",
        "Cache-Control": "no-store",
        "X-Vapid-Configured": publicKey ? "yes" : "no",
      },
    });
  }

  return NextResponse.json(
    { publicKey },
    { headers: { "Cache-Control": "no-store" } },
  );
}
