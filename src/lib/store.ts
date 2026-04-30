import { getDb } from "@/lib/db";
import { chooseBestOffer, matchingDeadlineMs } from "@/lib/matching";
import {
  AppState,
  BusRoute,
  DriveStatus,
  LiveLocation,
  Notification,
  Role,
  VehicleType,
} from "@/lib/types";

const OPEN_DRIVE_EXPIRE_AFTER_NEEDED_MS = 6 * 60 * 60 * 1000;
const ASSIGNED_DRIVE_EXPIRE_AFTER_NEEDED_MS = 2 * 60 * 60 * 1000;
const DONE_DRIVE_EXPIRE_AFTER_NEEDED_MS = 12 * 60 * 60 * 1000;

type DriveRow = {
  id: string;
  pickup_address: string;
  destination_address: string;
  needed_at: string;
  seats_needed: number;
  delegate_first_name: string;
  note: string;
  type: "emergency" | "scheduled";
  vehicle_type: VehicleType;
  status: "open" | "assigned" | "done";
  created_at: string;
  assigned_volunteer_id: string | null;
  assigned_eta_minutes: number | null;
};

type OfferRow = {
  drive_id: string;
  volunteer_id: string;
  eta_minutes: number;
  offered_at: string;
};

export async function readState(): Promise<AppState> {
  const db = getDb();
  const volunteers = db
    .prepare("SELECT id, pin_hash, seats FROM volunteers ORDER BY CAST(id AS INTEGER)")
    .all() as Array<{ id: string; pin_hash: string; seats: number }>;
  const drives = db
    .prepare("SELECT * FROM drives ORDER BY created_at DESC")
    .all() as DriveRow[];
  const offers = db.prepare("SELECT * FROM offers").all() as OfferRow[];
  const notifications = db
    .prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 500")
    .all() as Array<{
      id: string;
      message: string;
      created_at: string;
      sender_role: Role;
      target_role: "all" | Role;
      target_volunteer_id: string | null;
      drive_id: string | null;
    }>;

  const liveRows = db
    .prepare(
      "SELECT drive_id, volunteer_id, lat, lng, updated_at FROM drive_live_locations",
    )
    .all() as Array<{
    drive_id: string;
    volunteer_id: string;
    lat: number;
    lng: number;
    updated_at: string;
  }>;
  const liveByDrive = new Map<string, LiveLocation>();
  for (const row of liveRows) {
    liveByDrive.set(row.drive_id, {
      lat: row.lat,
      lng: row.lng,
      updatedAt: row.updated_at,
    });
  }

  return {
    volunteers: volunteers.map((v) => ({ id: v.id, pinHash: v.pin_hash, seats: v.seats })),
    drives: drives.map((d) => ({
      id: d.id,
      pickupAddress: d.pickup_address,
      destinationAddress: d.destination_address,
      neededAt: d.needed_at,
      seatsNeeded: d.seats_needed,
      delegateFirstName: d.delegate_first_name,
      note: d.note,
      type: d.type,
      vehicleType: d.vehicle_type ?? "car",
      status: d.status,
      createdAt: d.created_at,
      assignedVolunteerId: d.assigned_volunteer_id ?? undefined,
      assignedEtaMinutes: d.assigned_eta_minutes ?? undefined,
      offers: offers
        .filter((offer) => offer.drive_id === d.id)
        .map((offer) => ({
          volunteerId: offer.volunteer_id,
          etaMinutes: offer.eta_minutes,
          offeredAt: offer.offered_at,
        })),
      ...(liveByDrive.has(d.id) ? { liveLocation: liveByDrive.get(d.id) } : {}),
    })),
    notifications: notifications.map((n) => ({
      id: n.id,
      message: n.message,
      createdAt: n.created_at,
      senderRole: n.sender_role,
      targetRole: n.target_role,
      targetVolunteerId: n.target_volunteer_id ?? undefined,
      driveId: n.drive_id ?? undefined,
    })),
  };
}

export async function writeState(next: AppState): Promise<void> {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM volunteers").run();
    db.prepare("DELETE FROM drives").run();
    db.prepare("DELETE FROM offers").run();
    db.prepare("DELETE FROM notifications").run();
    db.prepare("DELETE FROM drive_live_locations").run();

    const vStmt = db.prepare("INSERT INTO volunteers (id, pin_hash, seats) VALUES (?, ?, ?)");
    for (const v of next.volunteers) {
      vStmt.run(v.id, v.pinHash, v.seats);
    }

    const dStmt = db.prepare(
      `INSERT INTO drives (
        id, pickup_address, destination_address, needed_at, seats_needed,
        delegate_first_name, note, type, vehicle_type, status, created_at,
        assigned_volunteer_id, assigned_eta_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const oStmt = db.prepare(
      "INSERT INTO offers (drive_id, volunteer_id, eta_minutes, offered_at) VALUES (?, ?, ?, ?)",
    );
    const liveStmt = db.prepare(
      `INSERT INTO drive_live_locations (drive_id, volunteer_id, lat, lng, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const d of next.drives) {
      dStmt.run(
        d.id,
        d.pickupAddress,
        d.destinationAddress,
        d.neededAt,
        d.seatsNeeded,
        d.delegateFirstName,
        d.note,
        d.type,
        d.vehicleType,
        d.status,
        d.createdAt,
        d.assignedVolunteerId ?? null,
        d.assignedEtaMinutes ?? null,
      );
      for (const o of d.offers) {
        oStmt.run(d.id, o.volunteerId, o.etaMinutes, o.offeredAt);
      }
      if (d.liveLocation && d.assignedVolunteerId && d.status === "assigned") {
        liveStmt.run(
          d.id,
          d.assignedVolunteerId,
          d.liveLocation.lat,
          d.liveLocation.lng,
          d.liveLocation.updatedAt,
        );
      }
    }

    const nStmt = db.prepare(
      `INSERT INTO notifications (
        id, message, created_at, sender_role, target_role, target_volunteer_id, drive_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const n of next.notifications) {
      nStmt.run(
        n.id,
        n.message,
        n.createdAt,
        n.senderRole,
        n.targetRole,
        n.targetVolunteerId ?? null,
        n.driveId ?? null,
      );
    }
  });
  tx();
}

/**
 * Städa bort gamla/övergivna körningar så listor inte växer med gårdagens jobb.
 */
export function pruneExpiredDrives(state: AppState): { next: AppState; changed: boolean } {
  const now = Date.now();
  const keep = state.drives.filter((drive) => {
    const neededMs = new Date(drive.neededAt).getTime();
    if (!Number.isFinite(neededMs)) return true;
    if (drive.status === "open") {
      return now - neededMs < OPEN_DRIVE_EXPIRE_AFTER_NEEDED_MS;
    }
    if (drive.status === "assigned") {
      return now - neededMs < ASSIGNED_DRIVE_EXPIRE_AFTER_NEEDED_MS;
    }
    return now - neededMs < DONE_DRIVE_EXPIRE_AFTER_NEEDED_MS;
  });
  if (keep.length === state.drives.length) return { next: state, changed: false };
  return { next: { ...state, drives: keep }, changed: true };
}

/**
 * När 2 min passerat från publicering: tilldela den med kortast ETA bland anbud inom fönstret.
 * Körs idempotent vid varje läsning / efter nya anbud.
 */
export function finalizeMatchingIfDue(state: AppState): { next: AppState; changed: boolean } {
  const now = Date.now();
  let changed = false;
  const newDrives = state.drives.map((d) => {
    if (d.status !== "open" || d.offers.length === 0) return d;
    if (now < matchingDeadlineMs(d.createdAt)) return d;
    const winner = chooseBestOffer(d);
    if (!winner) return d;
    changed = true;
    return {
      ...d,
      status: "assigned" as const,
      assignedVolunteerId: winner.volunteerId,
      assignedEtaMinutes: winner.etaMinutes,
    };
  });
  if (!changed) return { next: state, changed: false };

  let next: AppState = { ...state, drives: newDrives };
  for (const neu of newDrives) {
    const old = state.drives.find((o) => o.id === neu.id);
    if (old?.status === "open" && neu.status === "assigned") {
      next = addNotification(next, {
        message: `Du är bekräftad som chaufför för körning ${neu.id} (ETA ${neu.assignedEtaMinutes} min).`,
        senderRole: "admin",
        targetRole: "volunteer",
        targetVolunteerId: neu.assignedVolunteerId,
        driveId: neu.id,
      });
      next = addNotification(next, {
        message: `Körning ${neu.id} tilldelad volontär ${neu.assignedVolunteerId} (ETA ${neu.assignedEtaMinutes} min).`,
        senderRole: "admin",
        targetRole: "admin",
        driveId: neu.id,
      });
    }
  }
  return { next, changed: true };
}

export async function readStateResolved(): Promise<AppState> {
  const state = await readState();
  let current = state;
  let changed = false;

  const finalized = finalizeMatchingIfDue(current);
  current = finalized.next;
  changed = changed || finalized.changed;

  const pruned = pruneExpiredDrives(current);
  current = pruned.next;
  changed = changed || pruned.changed;

  if (changed) await writeState(current);
  return current;
}

export function addNotification(
  state: AppState,
  input: Omit<Notification, "id" | "createdAt">,
): AppState {
  const createdAt = new Date().toISOString();
  return {
    ...state,
    notifications: [
      {
        id: `n-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        createdAt,
        ...input,
      },
      ...state.notifications,
    ].slice(0, 500),
  };
}

export function visibleNotifications(
  state: AppState,
  role: Role,
  id: string,
): Notification[] {
  return state.notifications
    .filter((n) => {
      if (n.targetRole === "all") return true;
      if (n.targetRole === role) return true;
      if (role === "volunteer" && n.targetVolunteerId === id) return true;
      return false;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function isDriveStatus(value: string): value is DriveStatus {
  return value === "open" || value === "assigned" || value === "done";
}

export function upsertDriveLiveLocation(
  driveId: string,
  volunteerId: string,
  lat: number,
  lng: number,
): void {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO drive_live_locations (drive_id, volunteer_id, lat, lng, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(drive_id) DO UPDATE SET
       volunteer_id = excluded.volunteer_id,
       lat = excluded.lat,
       lng = excluded.lng,
       updated_at = excluded.updated_at`,
  ).run(driveId, volunteerId, lat, lng, updatedAt);
}

export function clearDriveLiveLocation(driveId: string): void {
  getDb().prepare("DELETE FROM drive_live_locations WHERE drive_id = ?").run(driveId);
}

export async function readBusRoutesForCaptain(captainId: string): Promise<BusRoute[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, captain_id, route_code, pickup_location, destination_location,
              planned_departure, seats_planned, note
       FROM bus_routes
       WHERE captain_id = ?
       ORDER BY planned_departure ASC`,
    )
    .all(captainId) as Array<{
    id: string;
    captain_id: string;
    route_code: string;
    pickup_location: string;
    destination_location: string;
    planned_departure: string;
    seats_planned: number;
    note: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    captainId: row.captain_id,
    routeCode: row.route_code,
    pickupLocation: row.pickup_location,
    destinationLocation: row.destination_location,
    plannedDeparture: row.planned_departure,
    seatsPlanned: row.seats_planned,
    note: row.note,
  }));
}

export async function importBusRoutesFromCsv(csv: string): Promise<number> {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO bus_routes (
      id, captain_id, route_code, pickup_location, destination_location,
      planned_departure, seats_planned, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const line of lines) {
      const [id, captainId, routeCode, pickup, destination, departure, seats, note] = line
        .split(",")
        .map((cell) => cell.trim());
      if (!id || !captainId || !routeCode || !pickup || !destination || !departure || !seats) {
        continue;
      }
      const seatsPlanned = Number(seats);
      if (!Number.isFinite(seatsPlanned) || seatsPlanned < 1) continue;
      stmt.run(
        id,
        captainId,
        routeCode,
        pickup,
        destination,
        new Date(departure).toISOString(),
        seatsPlanned,
        note ?? "",
      );
    }
  });
  tx();
  return lines.length;
}
