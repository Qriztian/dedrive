import { webcrypto } from "node:crypto";

/** True if this is an uncompressed EC P-256 public point Nodes Web Crypto accepts. */
export async function isAcceptedP256PublicRaw(bytes: Uint8Array): Promise<boolean> {
  if (bytes.byteLength !== 65 || bytes[0] !== 0x04) return false;
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
    try {
      await webcrypto.subtle.importKey(
        "raw",
        bytes,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        [],
      );
      return true;
    } catch {
      return false;
    }
  }
}
