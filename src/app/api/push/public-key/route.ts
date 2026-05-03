import { NextResponse } from "next/server";
import { decodeVapidPublicKeyBytes, stripVapidPublicKeyDecorators } from "@/lib/vapidPublicKey";

export async function GET() {
  const raw = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const trimmed = stripVapidPublicKeyDecorators(raw);
  const bytes = decodeVapidPublicKeyBytes(trimmed);
  const publicKey = bytes ? trimmed : "";
  return NextResponse.json({ publicKey });
}
