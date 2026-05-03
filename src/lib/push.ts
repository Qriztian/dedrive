import webpush from "web-push";
import { getDb } from "@/lib/db";
import { decodeVapidPublicKeyBytes, stripVapidPrivateKeyDecorators, stripVapidPublicKeyDecorators } from "@/lib/vapidPublicKey";
import type { Role } from "@/lib/types";

type PushSubInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

function configurePush(): boolean {
  const pubRaw = stripVapidPublicKeyDecorators(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "");
  const priv = stripVapidPrivateKeyDecorators(process.env.VAPID_PRIVATE_KEY ?? "");
  const subject = (process.env.VAPID_SUBJECT ?? "mailto:ops@example.com").trim();
  if (!decodeVapidPublicKeyBytes(pubRaw) || !priv) return false;
  webpush.setVapidDetails(subject, pubRaw, priv);
  return true;
}

export function upsertPushSubscription(input: PushSubInput, userId: string, role: Role): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_id = excluded.user_id,
       role = excluded.role`,
  ).run(
    input.endpoint,
    input.keys.p256dh,
    input.keys.auth,
    userId,
    role,
    new Date().toISOString(),
  );
}

export function removePushSubscription(endpoint: string, userId: string): void {
  getDb()
    .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .run(endpoint, userId);
}

type PushAudience = "all" | Role;

export async function sendPushToRole(
  audience: PushAudience,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  if (!configurePush()) return;
  const db = getDb();
  const rows = db
    .prepare(
      audience === "all"
        ? "SELECT endpoint, p256dh, auth FROM push_subscriptions"
        : "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE role = ?",
    )
    .all(...(audience === "all" ? [] : [audience])) as Array<{
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;

  const body = JSON.stringify(payload);
  for (const row of rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        body,
      );
    } catch {
      // stale subscription or transient push error
      getDb()
        .prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
        .run(row.endpoint);
    }
  }
}
