import crypto from "node:crypto";

const SALT = "delegat-transport-v1";

export function hashPin(pin: string): string {
  return crypto.scryptSync(pin, SALT, 32).toString("hex");
}

export function verifyPin(pin: string, hash: string): boolean {
  const computed = hashPin(pin);
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}
