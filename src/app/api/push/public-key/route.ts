import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { decodeVapidPublicKeyBytes, stripVapidPublicKeyDecorators } from "@/lib/vapidPublicKey";

/** If Next did not bind env (wrong cwd / old process), read the key line from disk. */
function readNextPublicVapidFromDisk(): string {
  try {
    const envPath = path.join(process.cwd(), ".env.production");
    if (!fs.existsSync(envPath)) return "";
    const content = fs.readFileSync(envPath, "utf8");
    const line = content.split(/\n/).find((l) => /^\s*NEXT_PUBLIC_VAPID_PUBLIC_KEY=/.test(l));
    if (!line) return "";
    return line.replace(/^\s*NEXT_PUBLIC_VAPID_PUBLIC_KEY=/, "").trim();
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  let raw = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  if (!stripVapidPublicKeyDecorators(raw)) {
    raw = readNextPublicVapidFromDisk();
  }
  const trimmed = stripVapidPublicKeyDecorators(raw);
  const bytes = decodeVapidPublicKeyBytes(trimmed);
  const publicKey = bytes ? trimmed : "";

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
