import fs from "node:fs";
import path from "node:path";
import { decodeVapidPublicKeyBytes, stripVapidPublicKeyDecorators } from "@/lib/vapidPublicKey";

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

/** Base64url string from env / disk, stripped (empty if missing). */
export function resolveVapidPublicKeyTrimmed(): string {
  let raw = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  if (!stripVapidPublicKeyDecorators(raw)) {
    raw = readNextPublicVapidFromDisk();
  }
  return stripVapidPublicKeyDecorators(raw);
}

/** 65-byte uncompressed P-256 public key, or null. */
export function resolveVapidPublicP256Raw(): Uint8Array | null {
  return decodeVapidPublicKeyBytes(resolveVapidPublicKeyTrimmed());
}
