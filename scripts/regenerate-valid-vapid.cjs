#!/usr/bin/env node
/**
 * Print a validated VAPID key pair for .env.production (Node Web Crypto accepts the public point).
 * Usage:
 *   cd /opt/delegat-transport && node scripts/regenerate-valid-vapid.cjs mailto:ops@example.com
 */
const webpush = require("web-push");
const { webcrypto } = require("crypto");

function strip(s) {
  let t = (s ?? "").trim().replace(/^\uFEFF/, "");
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))))
    t = t.slice(1, -1).trim();
  const line = (t.split(/\r?\n/)[0] ?? t).trim();
  return line.replace(/\s+/g, "").replace(/[\uFEFF\u200B-\u200D]/g, "");
}

function decodePublic(base64url) {
  const s = strip(base64url);
  if (!s) return null;
  try {
    const padding = "=".repeat((4 - (s.length % 4)) % 4);
    const base64 = (s + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = Buffer.from(base64, "base64");
    if (rawData.length !== 65 || rawData[0] !== 4) return null;
    return new Uint8Array(rawData);
  } catch {
    return null;
  }
}

(async () => {
  const mail = process.argv[2] ?? "mailto:ops@example.com";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const k = webpush.generateVAPIDKeys();
    const raw = decodePublic(k.publicKey);
    if (!raw) continue;
    try {
      await webcrypto.subtle.importKey(
        "raw",
        raw,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      );
      console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY=" + k.publicKey);
      console.log("VAPID_PRIVATE_KEY=" + k.privateKey);
      console.log("VAPID_SUBJECT=" + mail);
      process.exit(0);
    } catch {
      // Rare; regenerate
    }
  }
  console.error("Failed to produce a validated key after 50 attempts.");
  process.exit(1);
})();
