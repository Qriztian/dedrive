import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { Role } from "@/lib/types";

export type Session = {
  userId: string;
  role: Role;
  expiresAt: number;
};

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

export function createSession(userId: string, role: Role): string {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + SESSION_MS;
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, role, expiresAt);
  return token;
}

export function getSession(token: string | null): Session | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare("SELECT user_id, role, expires_at FROM sessions WHERE token = ?")
    .get(token) as { user_id: string; role: Role; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return { userId: row.user_id, role: row.role, expiresAt: row.expires_at };
}
