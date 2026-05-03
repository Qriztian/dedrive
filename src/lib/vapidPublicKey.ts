/**
 * VAPID public key helpers. Keys from `web-push generate-vapid-keys` are
 * URL-safe base64 (no PEM). Uncompressed P-256 point = 65 bytes, first 0x04.
 */

export function stripVapidPublicKeyDecorators(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, "");
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  const firstLine = (s.split(/\r?\n/)[0] ?? s).trim();
  // Spaces, BOM, zero-width chars (common when copying from PDF / Word)
  return firstLine.replace(/\s+/g, "").replace(/[\uFEFF\u200B-\u200D]/g, "");
}

export function stripVapidPrivateKeyDecorators(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, "");
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\s+/g, "").replace(/[\uFEFF\u200B-\u200D]/g, "");
}

/** Decode URL-safe base64 VAPID public key; null if not a valid 65-byte uncompressed P-256 point. */
export function decodeVapidPublicKeyBytes(base64url: string): Uint8Array | null {
  const s = stripVapidPublicKeyDecorators(base64url);
  if (!s) return null;
  try {
    const padding = "=".repeat((4 - (s.length % 4)) % 4);
    const base64 = (s + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    if (rawData.length !== 65 || rawData.charCodeAt(0) !== 0x04) return null;
    const out = new Uint8Array(65);
    for (let i = 0; i < 65; i += 1) {
      out[i] = rawData.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * WebKit (Safari, iOS) is strict: PushManager.subscribe often rejects a Uint8Array
 * that shares or aliases an odd buffer. Use a standalone ArrayBuffer of exactly
 * 65 bytes for applicationServerKey (Chromium is more forgiving).
 */
export function applicationServerKeyBuffer(bytes: Uint8Array): ArrayBuffer {
  const len = bytes.byteLength;
  const buf = new ArrayBuffer(len);
  new Uint8Array(buf).set(bytes);
  return buf;
}
