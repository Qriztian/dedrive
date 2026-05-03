import { webcrypto } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { decodeVapidPublicKeyBytes, stripVapidPublicKeyDecorators } from "@/lib/vapidPublicKey";

async function isValidP256PublicRaw(bytes: Uint8Array): Promise<boolean> {
  try {
    await webcrypto.subtle.importKey(
      "raw",
      bytes,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const raw = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const trimmed = stripVapidPublicKeyDecorators(raw);
  const bytes = decodeVapidPublicKeyBytes(trimmed);
  let publicKey = "";
  if (bytes && (await isValidP256PublicRaw(bytes))) {
    publicKey = trimmed;
  }

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/plain")) {
    return new NextResponse(publicKey, {
      status: publicKey ? 200 : 404,
      headers: {
        "Content-Type": "text/plain; charset=us-ascii",
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    { publicKey },
    { headers: { "Cache-Control": "no-store" } },
  );
}
