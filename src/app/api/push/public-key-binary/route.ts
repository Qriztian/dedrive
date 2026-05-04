import { NextResponse } from "next/server";
import { resolveVapidPublicP256RawValidated } from "@/lib/serverVapidPublicKey";

/** Raw 65-byte uncompressed P-256 VAPID public key (no base64). Safari-friendly. */
export async function GET() {
  const raw = await resolveVapidPublicP256RawValidated();
  if (!raw) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  return new NextResponse(copy.buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Length": "65",
    },
  });
}
