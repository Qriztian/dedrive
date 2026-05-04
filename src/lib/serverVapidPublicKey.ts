import fs from "node:fs";
import path from "node:path";
import { decodeVapidPublicKeyBytes, stripVapidPublicKeyDecorators } from "@/lib/vapidPublicKey";
import { isAcceptedP256PublicRaw } from "@/lib/validateServerVapidRaw";

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

/** Like resolveVapidPublicP256Raw but rejects points Node Web Crypto won't import (invalid curve coords). */
export async function resolveVapidPublicP256RawValidated(): Promise<Uint8Array | null> {
  const raw = resolveVapidPublicP256Raw();
  if (!raw) return null;
  if (!(await isAcceptedP256PublicRaw(raw))) return null;
  return raw;
}

/** Base64url public key string only if the decoded point passes server-side curve validation. */
export async function resolveVapidPublicKeyTrimmedValidated(): Promise<string | null> {
  const trimmed = resolveVapidPublicKeyTrimmed();
  const raw = decodeVapidPublicKeyBytes(trimmed);
  if (!raw) return null;
  if (!(await isAcceptedP256PublicRaw(raw))) return null;
  return trimmed;
}
