import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { hashPin } from "@/lib/security";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "transport.db");

let instance: Database.Database | null = null;

function ensureDatabase(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS volunteers (
      id TEXT PRIMARY KEY,
      pin_hash TEXT NOT NULL,
      seats INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drives (
      id TEXT PRIMARY KEY,
      pickup_address TEXT NOT NULL,
      destination_address TEXT NOT NULL,
      needed_at TEXT NOT NULL,
      seats_needed INTEGER NOT NULL,
      delegate_first_name TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      vehicle_type TEXT NOT NULL DEFAULT 'car',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      assigned_volunteer_id TEXT,
      assigned_eta_minutes INTEGER
    );

    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drive_id TEXT NOT NULL,
      volunteer_id TEXT NOT NULL,
      eta_minutes INTEGER NOT NULL,
      offered_at TEXT NOT NULL,
      UNIQUE(drive_id, volunteer_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      target_role TEXT NOT NULL,
      target_volunteer_id TEXT,
      drive_id TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bus_captains (
      id TEXT PRIMARY KEY,
      pin_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bus_routes (
      id TEXT PRIMARY KEY,
      captain_id TEXT NOT NULL,
      route_code TEXT NOT NULL,
      pickup_location TEXT NOT NULL,
      destination_location TEXT NOT NULL,
      planned_departure TEXT NOT NULL,
      seats_planned INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS drive_live_locations (
      drive_id TEXT PRIMARY KEY,
      volunteer_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  try {
    db.exec("ALTER TABLE drives ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT 'car'");
  } catch {
    // Column already exists in upgraded environments.
  }

  const volunteerCount = db.prepare("SELECT COUNT(*) as count FROM volunteers").get() as {
    count: number;
  };
  if (volunteerCount.count === 0) {
    const insertVolunteer = db.prepare(
      "INSERT INTO volunteers (id, pin_hash, seats) VALUES (?, ?, ?)",
    );
    const transaction = db.transaction(() => {
      for (let i = 1; i <= 300; i += 1) {
        const id = String(i);
        const pin = `1${String(i).padStart(3, "0")}`;
        const seats = i % 4 === 0 ? 6 : 4;
        insertVolunteer.run(id, hashPin(pin), seats);
      }
    });
    transaction();
  }

  const driveCount = db.prepare("SELECT COUNT(*) as count FROM drives").get() as {
    count: number;
  };
  if (driveCount.count === 0) {
    db.prepare(
      `INSERT INTO drives (
        id, pickup_address, destination_address, needed_at, seats_needed,
        delegate_first_name, note, type, vehicle_type, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "d1",
      "Arlanda Terminal 5",
      "Stockholm City Conference",
      new Date(Date.now() + 45 * 60 * 1000).toISOString(),
      4,
      "Ali",
      "Har mycket bagage",
      "scheduled",
      "minibus",
      "open",
      new Date().toISOString(),
    );
  }

  const captainCount = db.prepare("SELECT COUNT(*) as count FROM bus_captains").get() as {
    count: number;
  };
  if (captainCount.count === 0) {
    db.prepare("INSERT INTO bus_captains (id, pin_hash) VALUES (?, ?)").run("9001", hashPin("99001"));
    db.prepare("INSERT INTO bus_captains (id, pin_hash) VALUES (?, ?)").run("9002", hashPin("99002"));
  }

  const routeCount = db.prepare("SELECT COUNT(*) as count FROM bus_routes").get() as {
    count: number;
  };
  if (routeCount.count === 0) {
    db.prepare(
      `INSERT INTO bus_routes (
        id, captain_id, route_code, pickup_location, destination_location,
        planned_departure, seats_planned, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "br1",
      "9001",
      "BUS-A12",
      "Arlanda Bus Bay C",
      "Stockholm City Conference",
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      48,
      "Importerad demo-rutt (Excel-format).",
    );
  }
}

export function getDb(): Database.Database {
  if (instance) return instance;
  mkdirSync(DATA_DIR, { recursive: true });
  instance = new Database(DB_FILE);
  ensureDatabase(instance);
  return instance;
}
