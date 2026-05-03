"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminDriveLiveLocation } from "@/components/AdminDriveLiveLocation";
import { Stockholm2026Logo } from "@/components/Stockholm2026Logo";
import { VolunteerLocationShare } from "@/components/VolunteerLocationShare";
import { matchingDeadlineMs, provisionalLeader } from "@/lib/matching";
import {
  appleMapsFromTo,
  appleMapsToDestination,
  googleDirectionsFromTo,
  googleDirectionsToDestination,
} from "@/lib/mapsLinks";
import {
  applicationServerKeyBuffer,
  decodeVapidPublicKeyBytes,
  stripVapidPublicKeyDecorators,
} from "@/lib/vapidPublicKey";
import type { BusRoute, Drive, DriveType, Notification, Role, VehicleType } from "@/lib/types";

type User = { id: string; role: Role };
type HealthInfo = { appVersion: string; startedAt: string; checkedAt: string };
const ETA_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50, 60];
const VEHICLE_LABELS: Record<VehicleType, string> = {
  car: "Bil",
  minibus: "Minibuss",
  bus: "Buss",
};

const MAP_LINK_CLASS =
  "inline-flex items-center justify-center rounded-md border border-cyan-700/50 bg-cyan-950/60 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-900/50";
const MAP_LINK_SECONDARY_CLASS =
  "inline-flex items-center justify-center rounded-md border border-zinc-600 bg-zinc-900/80 px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800";

function formatWhen(isoString: string): string {
  return new Date(isoString).toLocaleString("sv-SE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Safari often needs an active controller before pushManager.subscribe succeeds. */
function waitForServiceWorkerController(timeoutMs: number): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve();
  }
  if (navigator.serviceWorker.controller) return Promise.resolve();
  return Promise.race([
    new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => resolve(),
        { once: true },
      );
    }),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

/** Chromium: rejects truly bad keys. Safari often fails importKey(ECDSA) on valid VAPID raw points — do not block subscribe there. */
function isLikelyAppleSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isChromium = /Chrome|Chromium|CriOS|Edg|OPR|FxiOS/.test(ua);
  return /Safari/i.test(ua) && !isChromium;
}

async function validateP256PublicRawInBrowser(buf: ArrayBuffer): Promise<boolean> {
  const u8 = new Uint8Array(buf);
  const algos: Array<{ name: "ECDSA" | "ECDH"; usages: KeyUsage[] }> = [
    { name: "ECDSA", usages: ["verify"] },
    { name: "ECDH", usages: [] },
  ];
  for (const { name, usages } of algos) {
    try {
      await crypto.subtle.importKey(
        "raw",
        u8,
        { name, namedCurve: "P-256" },
        true,
        usages,
      );
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

export default function Home() {
  const [token, setToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("delegatTransportToken") ?? "";
  });
  const [user, setUser] = useState<User | null>(null);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [mySeats, setMySeats] = useState<number | null>(null);
  const [busRoutes, setBusRoutes] = useState<BusRoute[]>([]);
  const [loginId, setLoginId] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [loginError, setLoginError] = useState("");

  const [newDrive, setNewDrive] = useState({
    pickupAddress: "",
    destinationAddress: "",
    neededAt: "",
    seatsNeeded: 4,
    delegateFirstName: "",
    note: "",
    type: "emergency" as DriveType,
    vehicleType: "car" as VehicleType,
  });

  const [newMessage, setNewMessage] = useState({
    message: "",
    targetRole: "all" as "all" | Role,
    targetVolunteerId: "",
    driveId: "",
  });
  const [importCsv, setImportCsv] = useState("");
  const [importBusCsv, setImportBusCsv] = useState("");
  const [volunteerImportNote, setVolunteerImportNote] = useState<{
    text: string;
    tone: "ok" | "err";
  } | null>(null);
  const volunteerExcelRef = useRef<HTMLInputElement>(null);
  const [matchClockMs, setMatchClockMs] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushStatusText, setPushStatusText] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  /** Prefetched so the push button does not await network before permission (iOS/Safari). */
  const vapidPublicKeyRef = useRef<string | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullTriggeredRef = useRef(false);
  const isRefreshingRef = useRef(false);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Ett fel uppstod.");
    }
    return (await response.json()) as T;
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    const data = await api<{
      user: User;
      drives: Drive[];
      notifications: Notification[];
      mySeats: number | null;
      busRoutes: BusRoute[];
    }>("/api/state");
    setUser(data.user);
    setDrives(data.drives);
    setNotifications(data.notifications);
    setMySeats(data.mySeats);
    setBusRoutes(data.busRoutes);
  }, [token, api]);

  const refreshSafe = useCallback(async (showSpinner = false) => {
    if (!token || isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    if (showSpinner) setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      isRefreshingRef.current = false;
      if (showSpinner) setIsRefreshing(false);
    }
  }, [token, refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!token) {
      window.localStorage.removeItem("delegatTransportToken");
      return;
    }
    window.localStorage.setItem("delegatTransportToken", token);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const first = setTimeout(() => {
      refreshSafe(false).catch(() => undefined);
    }, 0);
    const interval = setInterval(() => {
      refreshSafe(false).catch(() => undefined);
    }, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [token, refreshSafe]);

  useEffect(() => {
    if (!token) {
      const t0 = setTimeout(() => setHealth(null), 0);
      return () => clearTimeout(t0);
    }
    const fetchHealth = () => {
      fetch("/api/health")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.appVersion && data.startedAt && data.checkedAt) {
            setHealth(data as HealthInfo);
          }
        })
        .catch(() => undefined);
    };
    fetchHealth();
    const t = setInterval(fetchHealth, 30000);
    return () => clearInterval(t);
  }, [token]);

  useEffect(() => {
    vapidPublicKeyRef.current = null;
    if (!token) return;
    fetch("/api/push/public-key", {
      cache: "no-store",
      headers: { Accept: "text/plain" },
    })
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        const k = stripVapidPublicKeyDecorators(text);
        vapidPublicKeyRef.current = decodeVapidPublicKeyBytes(k) ? k : null;
      })
      .catch(() => {
        vapidPublicKeyRef.current = null;
      });
  }, [token]);

  useEffect(() => {
    if (!token) {
      const t0 = setTimeout(() => setPushEnabled(false), 0);
      return () => clearTimeout(t0);
    }
    if (typeof navigator === "undefined") {
      return;
    }
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => undefined)
      .finally(() => {
        navigator.serviceWorker.ready
          .then((reg) => reg.pushManager.getSubscription())
          .then((sub) => setPushEnabled(Boolean(sub)))
          .catch(() => undefined);
      });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const onTouchStart = (event: TouchEvent) => {
      if (window.scrollY > 0) return;
      pullStartYRef.current = event.touches[0]?.clientY ?? null;
      pullTriggeredRef.current = false;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (pullStartYRef.current === null || pullTriggeredRef.current) return;
      if (window.scrollY > 0) return;
      const y = event.touches[0]?.clientY ?? pullStartYRef.current;
      if (y - pullStartYRef.current > 85) {
        pullTriggeredRef.current = true;
        refreshSafe(true).catch(() => undefined);
      }
    };
    const onTouchEnd = () => {
      pullStartYRef.current = null;
      pullTriggeredRef.current = false;
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [token, refreshSafe]);

  useEffect(() => {
    if (!token) return;
    const bump = () => setMatchClockMs(Date.now());
    const t0 = setTimeout(bump, 0);
    const clock = setInterval(bump, 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(clock);
    };
  }, [token]);

  const openDrives = useMemo(() => drives.filter((drive) => drive.status === "open"), [drives]);
  const assignedDrives = useMemo(
    () => drives.filter((drive) => drive.status !== "open"),
    [drives],
  );

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    try {
      const data = await api<{ token: string; user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ id: loginId.trim(), pin: loginPin.trim() }),
      });
      setToken(data.token);
      setUser(data.user);
      await refreshSafe(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Fel ID eller PIN.");
    }
  }

  async function createDrive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await api("/api/drives", {
      method: "POST",
      body: JSON.stringify(newDrive),
    });
    setNewDrive({
      pickupAddress: "",
      destinationAddress: "",
      neededAt: "",
      seatsNeeded: 4,
      delegateFirstName: "",
      note: "",
      type: "emergency",
      vehicleType: "car",
    });
    await refreshSafe(true);
  }

  async function volunteerOfferDrive(driveId: string, etaMinutes?: number) {
    await api(`/api/drives/${driveId}/offer`, {
      method: "POST",
      body: JSON.stringify(etaMinutes ? { etaMinutes } : {}),
    });
    await refreshSafe(true);
  }

  async function volunteerDeclineDrive(driveId: string) {
    await api(`/api/drives/${driveId}/decline`, { method: "POST" });
    await refreshSafe(true);
  }

  async function markDriveDone(driveId: string) {
    await api(`/api/drives/${driveId}/done`, { method: "POST" });
    await refreshSafe(true);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newMessage.message.trim()) return;
    await api("/api/notifications", {
      method: "POST",
      body: JSON.stringify(newMessage),
    });
    setNewMessage({
      message: "",
      targetRole: "all",
      targetVolunteerId: "",
      driveId: "",
    });
    await refreshSafe(true);
  }

  async function importVolunteers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVolunteerImportNote(null);
    if (!importCsv.trim()) return;
    try {
      const data = await api<{
        importedVolunteers?: number;
        source?: string;
      }>("/api/admin/volunteers/import", {
        method: "POST",
        body: JSON.stringify({ csv: importCsv }),
      });
      setImportCsv("");
      setVolunteerImportNote({
        tone: "ok",
        text: `CSV: ${data.importedVolunteers ?? 0} volontärer importerade (befintliga uppdateras).`,
      });
      await refreshSafe(true);
    } catch (e) {
      setVolunteerImportNote({
        tone: "err",
        text: e instanceof Error ? e.message : "Import misslyckades.",
      });
    }
  }

  async function importVolunteersExcel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVolunteerImportNote(null);
    const input = volunteerExcelRef.current;
    const file = input?.files?.[0];
    if (!file || !token) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/admin/volunteers/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        importedVolunteers?: number;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Uppladdning misslyckades.");
      }
      if (input) input.value = "";
      setVolunteerImportNote({
        tone: "ok",
        text: `Excel: ${data.importedVolunteers ?? 0} volontärer importerade (befintliga uppdateras vid samma id).`,
      });
      await refreshSafe(true);
    } catch (e) {
      setVolunteerImportNote({
        tone: "err",
        text: e instanceof Error ? e.message : "Uppladdning misslyckades.",
      });
    }
  }

  async function downloadVolunteerTemplate() {
    if (!token) return;
    setVolunteerImportNote(null);
    try {
      const res = await fetch("/api/admin/volunteers/template", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Kunde inte ladda ner mallen.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "volontar-import-mall.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setVolunteerImportNote({
        tone: "err",
        text: e instanceof Error ? e.message : "Kunde inte ladda ner mallen.",
      });
    }
  }

  async function importBusRoutes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importBusCsv.trim()) return;
    await api("/api/admin/bus-routes/import", {
      method: "POST",
      body: JSON.stringify({ csv: importBusCsv }),
    });
    setImportBusCsv("");
    await refreshSafe(true);
  }

  async function enablePushNotifications() {
    if (!token) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushStatusText("Push stöds inte i den här webbläsaren.");
      return;
    }
    if (Notification.permission === "denied") {
      setPushStatusText(
        "Notiser är blockerade. På iPhone: Inställningar → Notiser → (den här appen) och slå på.",
      );
      return;
    }
    // Safari/iOS: requestPermission must not follow unrelated awaits (e.g. fetch), or activation breaks.
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatusText("Notiser är inte tillåtna i webbläsaren.");
        return;
      }
    }

    // Prefer raw 65-byte key (no base64 in browser) — avoids Safari/atob edge cases vs same bytes as server.
    let keyBuf: ArrayBuffer | null = null;
    const binRes = await fetch(`/api/push/public-key-binary?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (binRes.ok) {
      const ab = await binRes.arrayBuffer().catch(() => null);
      if (ab && ab.byteLength === 65) {
        const u = new Uint8Array(ab);
        if (u[0] === 0x04) {
          keyBuf = applicationServerKeyBuffer(u);
        }
      }
    }
    if (!keyBuf) {
      let vapidKey = "";
      const vapidRes = await fetch("/api/push/public-key", {
        cache: "no-store",
        headers: { Accept: "text/plain" },
      });
      const text = vapidRes.ok ? await vapidRes.text().catch(() => "") : "";
      vapidKey = stripVapidPublicKeyDecorators(text);
      if (!decodeVapidPublicKeyBytes(vapidKey)) {
        vapidKey = stripVapidPublicKeyDecorators(vapidPublicKeyRef.current ?? "");
      }
      if (!decodeVapidPublicKeyBytes(vapidKey)) {
        const buildKey = stripVapidPublicKeyDecorators(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "");
        if (decodeVapidPublicKeyBytes(buildKey)) vapidKey = buildKey;
      }
      if (decodeVapidPublicKeyBytes(vapidKey)) vapidPublicKeyRef.current = vapidKey;
      if (!vapidKey) {
        setPushStatusText("Push är inte konfigurerat på servern ännu (saknar VAPID-nyckel).");
        return;
      }
      const decodedVapid = decodeVapidPublicKeyBytes(vapidKey);
      if (!decodedVapid) {
        setPushStatusText(
          "VAPID-publiknyckeln är ogiltig. På servern i .env.production: sätt NEXT_PUBLIC_VAPID_PUBLIC_KEY till exakt publicKey från `npx web-push generate-vapid-keys` (en rad, inga citattecken). Den privata nyckeln ska stå i VAPID_PRIVATE_KEY — inte tvärtom.",
        );
        return;
      }
      keyBuf = applicationServerKeyBuffer(decodedVapid);
    }
    if (!keyBuf) {
      setPushStatusText("Kunde inte ladda VAPID-nyckel från servern.");
      return;
    }
    if (!isLikelyAppleSafari()) {
      const curveOk = await validateP256PublicRawInBrowser(keyBuf);
      if (!curveOk) {
        const peek = new Uint8Array(keyBuf);
        setPushStatusText(
          `Nyckeln som nådde webbläsaren är inte en giltig P-256-nyckel (längd ${peek.byteLength}, första byte ${peek[0]}). Generera nytt par med npx web-push generate-vapid-keys och uppdatera .env.production.`,
        );
        return;
      }
    }

    const txtKeyRes = await fetch("/api/push/public-key", {
      cache: "no-store",
      headers: { Accept: "text/plain" },
    });
    const vapidKeyPlain = stripVapidPublicKeyDecorators(
      txtKeyRes.ok ? await txtKeyRes.text().catch(() => "") : "",
    );
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      await waitForServiceWorkerController(8000);
      const reg = await navigator.serviceWorker.ready;
      try {
        const oldSub = await reg.pushManager.getSubscription();
        if (oldSub) await oldSub.unsubscribe();
      } catch {
        // ignore — fresh subscribe below
      }
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        // Push spec: applicationServerKey may be BufferSource OR base64url string. WebKit often
        // accepts the string form; typed arrays from binary fetch can still be rejected.
        const attempts: Array<BufferSource | string> = [];
        if (isLikelyAppleSafari() && decodeVapidPublicKeyBytes(vapidKeyPlain)) {
          attempts.push(vapidKeyPlain);
        }
        attempts.push(new Uint8Array(keyBuf), keyBuf);
        let lastErr: unknown;
        for (const applicationServerKey of attempts) {
          try {
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: applicationServerKey as BufferSource,
            });
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (!sub) {
          throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
        }
      }
      const raw = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const endpoint = raw.endpoint?.trim() ?? "";
      const p256dh = raw.keys?.p256dh?.trim() ?? "";
      const auth = raw.keys?.auth?.trim() ?? "";
      if (!endpoint || !p256dh || !auth) {
        setPushStatusText("Kunde inte läsa push-prenumerationen. Stäng appen och försök igen.");
        return;
      }
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ endpoint, keys: { p256dh, auth } }),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Serverfel (${response.status}).`);
      }
      setPushEnabled(true);
      setPushStatusText("Push-notiser är aktiverade.");
    } catch (e) {
      setPushStatusText(
        e instanceof Error ? `Kunde inte aktivera: ${e.message}` : "Kunde inte aktivera push-notiser.",
      );
    }
  }

  async function disablePushNotifications() {
    if (!token || !("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const response = await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        if (!response.ok) throw new Error("unsubscribe failed");
        await sub.unsubscribe();
      }
      setPushEnabled(false);
      setPushStatusText("Push-notiser är avstängda.");
    } catch {
      setPushStatusText("Kunde inte stänga av push-notiser.");
    }
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-10">
        <div className="mb-4 flex justify-center">
          <Stockholm2026Logo className="max-w-full drop-shadow-lg" width={300} />
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur">
          <p className="text-xs font-semibold tracking-[0.2em] text-cyan-300">STOCKHOLM 2026</p>
          <h1 className="mt-2 text-2xl font-bold text-zinc-100">Delegat Transport</h1>
          <p className="mt-2 text-sm text-zinc-400">
            GDPR-minimerad inloggning med ID och PIN. Mobilanpassad driftvy för snabba beslut.
          </p>
        </div>
        <form
          onSubmit={handleLogin}
          className="mt-4 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
        >
          <label className="block text-sm font-medium text-zinc-200">
            ID (volontärnummer eller admin/airport)
            <input
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-cyan-400/50 transition focus:ring-2"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-200">
            PIN
            <input
              type="password"
              value={loginPin}
              onChange={(event) => setLoginPin(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-cyan-400/50 transition focus:ring-2"
            />
          </label>
          <button
            className="w-full rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black transition hover:bg-cyan-400"
            type="submit"
          >
            Logga in
          </button>
          {loginError ? <p className="text-sm text-red-400">{loginError}</p> : null}
          <p className="text-xs text-zinc-500">
            Demo: admin/2468, airport/1357, volontär 1 med PIN 1001, busskapten 9001 med PIN
            99001.
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
      <header className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Stockholm2026Logo width={180} className="mb-2" />
            <p className="text-xs font-semibold tracking-[0.2em] text-cyan-300">STOCKHOLM 2026</p>
            <h1 className="text-2xl font-bold text-zinc-100">Delegat Transport</h1>
          </div>
          <button
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            onClick={() => {
              setUser(null);
              setToken("");
              setDrives([]);
              setNotifications([]);
              setMySeats(null);
              setBusRoutes([]);
              setIsRefreshing(false);
              isRefreshingRef.current = false;
            }}
          >
            Logga ut
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
            <p className="text-xs text-zinc-500">Roll</p>
            <p className="text-sm font-semibold capitalize text-zinc-100">{user.role}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
            <p className="text-xs text-zinc-500">ID</p>
            <p className="text-sm font-semibold text-zinc-100">{user.id}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
            <p className="text-xs text-zinc-500">Behov just nu</p>
            <p className="text-sm font-semibold text-zinc-100">{openDrives.length}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
            <p className="text-xs text-zinc-500">Bokade/klar</p>
            <p className="text-sm font-semibold text-zinc-100">{assignedDrives.length}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-zinc-500">Inloggad som {user.role} ({user.id})</p>
          <button
            type="button"
            onClick={() => refreshSafe(true).catch(() => undefined)}
            disabled={isRefreshing}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          >
            Uppdatera nu
          </button>
          <p className="text-[11px] text-zinc-600">Dra nedåt för snabb uppdatering på mobil.</p>
          <button
            type="button"
            onClick={() =>
              (pushEnabled
                ? disablePushNotifications()
                : enablePushNotifications()
              ).catch(() => undefined)
            }
            className="rounded-md border border-cyan-800/60 bg-cyan-950/40 px-2 py-1 text-xs text-cyan-100"
          >
            {pushEnabled ? "Stäng av pushnotiser" : "Aktivera pushnotiser"}
          </button>
        </div>
        {pushStatusText ? <p className="mt-1 text-xs text-zinc-500">{pushStatusText}</p> : null}
        {health ? (
          <p className="mt-1 text-[11px] text-zinc-600">
            Version {health.appVersion} | Server start: {formatWhen(health.startedAt)} | Health:
            {formatWhen(health.checkedAt)}
          </p>
        ) : null}
      </header>

      <section className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <h2 className="text-base font-semibold text-zinc-100">Meddelanden / notiser</h2>
        <div className="mt-3 space-y-2">
          {notifications.length === 0 ? (
            <p className="text-sm text-zinc-500">Inga notiser ännu.</p>
          ) : (
            notifications.slice(0, 15).map((notification) => (
              <div
                key={notification.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2 text-sm text-zinc-200"
              >
                <strong className="uppercase text-cyan-300">{notification.senderRole}</strong>:{" "}
                {notification.message}
                <span className="ml-2 text-xs text-zinc-500">
                  ({formatWhen(notification.createdAt)})
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {(user.role === "admin" || user.role === "airport") && (
        <section className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <h2 className="text-base font-semibold text-zinc-100">
            {user.role === "admin" ? "Skapa transportbehov" : "Skicka driftmeddelande"}
          </h2>

          {user.role === "admin" ? (
            <form onSubmit={createDrive} className="mt-3 grid gap-3 md:grid-cols-2">
              <input
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                placeholder="Från (adress/flygplats)"
                value={newDrive.pickupAddress}
                onChange={(event) =>
                  setNewDrive((previous) => ({
                    ...previous,
                    pickupAddress: event.target.value,
                  }))
                }
                required
              />
              <input
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                placeholder="Till (adress)"
                value={newDrive.destinationAddress}
                onChange={(event) =>
                  setNewDrive((previous) => ({
                    ...previous,
                    destinationAddress: event.target.value,
                  }))
                }
                required
              />
              <input
                type="datetime-local"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                value={newDrive.neededAt}
                onChange={(event) =>
                  setNewDrive((previous) => ({ ...previous, neededAt: event.target.value }))
                }
              />
              <select
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                value={newDrive.type}
                onChange={(event) =>
                  setNewDrive((previous) => ({
                    ...previous,
                    type: event.target.value as DriveType,
                  }))
                }
              >
                <option value="emergency">Akut</option>
                <option value="scheduled">Planerad</option>
              </select>
              <select
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                value={newDrive.vehicleType}
                onChange={(event) =>
                  setNewDrive((previous) => ({
                    ...previous,
                    vehicleType: event.target.value as VehicleType,
                  }))
                }
              >
                <option value="car">Bil</option>
                <option value="minibus">Minibuss</option>
                <option value="bus">Buss (framtida busstrafik)</option>
              </select>
              <select
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                value={newDrive.seatsNeeded}
                onChange={(event) =>
                  setNewDrive((previous) => ({
                    ...previous,
                    seatsNeeded: Number(event.target.value),
                  }))
                }
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((seat) => (
                  <option key={seat} value={seat}>
                    {seat} säten behövs
                  </option>
                ))}
              </select>
              <input
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                placeholder="Förnamn (valfritt)"
                value={newDrive.delegateFirstName}
                onChange={(event) =>
                  setNewDrive((previous) => ({
                    ...previous,
                    delegateFirstName: event.target.value,
                  }))
                }
              />
              <textarea
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 md:col-span-2"
                placeholder="Notering (valfritt)"
                value={newDrive.note}
                onChange={(event) =>
                  setNewDrive((previous) => ({ ...previous, note: event.target.value }))
                }
              />
              <button
                type="submit"
                className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black transition hover:bg-cyan-400 md:col-span-2"
              >
                Publicera behov
              </button>
            </form>
          ) : null}

          <form onSubmit={sendMessage} className="mt-3 grid gap-3 md:grid-cols-2">
            <textarea
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 md:col-span-2"
              placeholder="Meddelande, t.ex. Flight SK123 är 40 min sen på Arlanda."
              value={newMessage.message}
              onChange={(event) =>
                setNewMessage((previous) => ({ ...previous, message: event.target.value }))
              }
              required
            />
            <select
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              value={newMessage.targetRole}
              onChange={(event) =>
                setNewMessage((previous) => ({
                  ...previous,
                  targetRole: event.target.value as "all" | Role,
                }))
              }
            >
              <option value="all">Alla</option>
              <option value="volunteer">Alla chaufförer</option>
              <option value="admin">Admin</option>
              <option value="airport">Flygplatsteam</option>
              <option value="bus_captain">Busskaptener</option>
            </select>
            <input
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              placeholder="Specifikt volontärnummer (valfritt)"
              value={newMessage.targetVolunteerId}
              onChange={(event) =>
                setNewMessage((previous) => ({
                  ...previous,
                  targetVolunteerId: event.target.value,
                }))
              }
            />
            <input
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 md:col-span-2"
              placeholder="Koppla till körning-ID (valfritt)"
              value={newMessage.driveId}
              onChange={(event) =>
                setNewMessage((previous) => ({ ...previous, driveId: event.target.value }))
              }
            />
            <button
              type="submit"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-zinc-100 md:col-span-2"
            >
              Skicka meddelande
            </button>
          </form>

          {user.role === "admin" ? (
            <div className="mt-5 grid gap-4">
              <h3 className="text-sm font-medium text-zinc-200">Importera volontärer</h3>
              <p className="text-xs text-zinc-500">
                Ladda upp en Excel-fil (.xlsx eller .xls) eller klistra in CSV. Du kan ladda upp samma
                fil igen efter ändringar — volontärer med samma id uppdateras (PIN och antal säten).
              </p>
              {volunteerImportNote ? (
                <p
                  className={
                    volunteerImportNote.tone === "err" ? "text-xs text-red-400" : "text-xs text-emerald-400/90"
                  }
                >
                  {volunteerImportNote.text}
                </p>
              ) : null}
              <form onSubmit={importVolunteersExcel} className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs font-medium text-zinc-300">Excel</p>
                <p className="text-xs text-zinc-500">
                  Första bladet används. Rad 1 kan vara rubriker (t.ex. Volontärnr, PIN, Säten) — annars
                  kolumn A = id, B = PIN, C = antal passagerarplatser (1–9). Formatera PIN-kolumnen som
                  text i Excel om koden börjar med 0.
                </p>
                <button
                  type="button"
                  onClick={() => void downloadVolunteerTemplate()}
                  className="w-fit rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  Ladda ner Excel-mall
                </button>
                <input
                  ref={volunteerExcelRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="text-xs text-zinc-300 file:mr-2 file:rounded-md file:border file:border-zinc-600 file:bg-zinc-800 file:px-2 file:py-1 file:text-zinc-200"
                />
                <button
                  type="submit"
                  className="w-fit rounded-lg border border-cyan-800/60 bg-cyan-950/50 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-900/40"
                >
                  Ladda upp Excel
                </button>
              </form>
              <form onSubmit={importVolunteers} className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs font-medium text-zinc-300">CSV (alternativ)</p>
                <p className="text-xs text-zinc-500">En rad per volontär: volontärnummer,PIN,säten</p>
                <textarea
                  className="min-h-28 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                  placeholder={"301,1301,4\n302,1302,6"}
                  value={importCsv}
                  onChange={(event) => setImportCsv(event.target.value)}
                />
                <button
                  type="submit"
                  className="w-fit rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100"
                >
                  Importera CSV
                </button>
              </form>
            </div>
          ) : null}
          {user.role === "admin" ? (
            <form onSubmit={importBusRoutes} className="mt-5 grid gap-3">
              <h3 className="text-sm font-medium text-zinc-200">Importera bussrutter (CSV)</h3>
              <p className="text-xs text-zinc-500">
                Format: ruttId,busCaptainId,routeCode,pickup,destination,departureISO,seats,note
              </p>
              <textarea
                className="min-h-28 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                placeholder={"br2,9002,BUS-K44,Skavsta,Stockholm C,2026-07-01T12:30:00Z,52,Terminal byte"}
                value={importBusCsv}
                onChange={(event) => setImportBusCsv(event.target.value)}
              />
              <button
                type="submit"
                className="w-fit rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100"
              >
                Importera bussrutter
              </button>
            </form>
          ) : null}
        </section>
      )}

      {user.role === "bus_captain" ? (
        <section className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <h2 className="text-base font-semibold text-zinc-100">Mina bussrutter</h2>
          <p className="text-xs text-zinc-500">
            Rutter importeras via Excel-export (CSV) av admin.
          </p>
          <div className="mt-3 space-y-3">
            {busRoutes.length === 0 ? (
              <p className="text-sm text-zinc-500">Inga rutter tilldelade ännu.</p>
            ) : (
              busRoutes.map((route) => (
                <article
                  key={route.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3"
                >
                  <p className="text-xs text-cyan-300">{route.routeCode}</p>
                  <p className="text-sm text-zinc-100">
                    {route.pickupLocation} {"->"} {route.destinationLocation}
                  </p>
                  <p className="text-sm text-zinc-300">
                    Avgång: {formatWhen(route.plannedDeparture)} | Säten: {route.seatsPlanned}
                  </p>
                  {route.note ? <p className="text-xs text-zinc-400">{route.note}</p> : null}
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <h2 className="text-base font-semibold text-zinc-100">Behov just nu</h2>
          <div className="mt-3 space-y-3">
            {openDrives.length === 0 ? (
              <p className="text-sm text-zinc-500">Inga öppna körningar.</p>
            ) : (
              openDrives.map((drive) => {
                const isVolunteer = user.role === "volunteer";
                const seatsOk = mySeats ? mySeats >= drive.seatsNeeded : true;
                const matchDeadline = matchingDeadlineMs(drive.createdAt);
                const nowMs = matchClockMs;
                const inMatchWindow = nowMs < matchDeadline;
                const leader = provisionalLeader(drive);
                const secLeft = Math.max(0, Math.ceil((matchDeadline - nowMs) / 1000));
                return (
                  <article key={drive.id} className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      {drive.type === "emergency" ? "AKUT" : "PLANERAD"} | {drive.id}
                      <span className="rounded-full border border-cyan-700/50 bg-cyan-500/15 px-2 py-0.5 text-cyan-300">
                        {VEHICLE_LABELS[drive.vehicleType]}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-zinc-200">
                      <strong>Från:</strong> {drive.pickupAddress}
                    </p>
                    <p className="text-sm text-zinc-200">
                      <strong>Till:</strong> {drive.destinationAddress}
                    </p>
                    <p className="text-sm text-zinc-200">
                      <strong>Behövs:</strong> {formatWhen(drive.neededAt)}
                    </p>
                    <p className="text-sm text-zinc-200">
                      <strong>Säten:</strong> {drive.seatsNeeded}
                    </p>
                    {drive.delegateFirstName ? (
                      <p className="text-sm text-zinc-200">
                        <strong>Förnamn:</strong> {drive.delegateFirstName}
                      </p>
                    ) : null}
                    {drive.note ? (
                      <p className="text-sm text-zinc-200">
                        <strong>Notering:</strong> {drive.note}
                      </p>
                    ) : null}

                    {drive.offers.length > 0 && inMatchWindow ? (
                      <div className="mt-2 rounded-lg border border-amber-800/50 bg-amber-950/30 p-2 text-xs text-amber-100">
                        <p>
                          Matchning pågår: <strong>{secLeft}s</strong> kvar (2 min från publicering).
                        </p>
                        {leader ? (
                          <p className="mt-1">
                            Preliminär ledare: volontär <strong>{leader.volunteerId}</strong> (ETA{" "}
                            <strong>{leader.etaMinutes}</strong> min).
                          </p>
                        ) : null}
                        {user.role === "volunteer" && leader?.volunteerId === user.id ? (
                          <p className="mt-1 font-semibold text-amber-200">
                            Du leder preliminärt – andra kan fortfarande svara med kortare tid.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {drive.offers.length > 0 && !inMatchWindow ? (
                      <p className="mt-2 text-xs text-zinc-500">
                        Matchningsperioden är slut – tilldelning uppdateras vid nästa hämtning.
                      </p>
                    ) : null}

                    {isVolunteer ? (
                      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/80 p-2">
                        <p className="text-xs text-zinc-600">
                          Din bil: {mySeats ?? 0} säten.
                        </p>
                        {drive.type === "emergency" ? (
                          <p className="mt-1 text-xs text-zinc-500">
                            Ditt &quot;Ja&quot; är preliminärt tills 2 minuter gått från publicering –
                            då bekräftas den som kan vara på plats snabbast.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-zinc-500">
                            Planerad körning: svara bara Ja/Nej (ingen ETA krävs).
                          </p>
                        )}
                        {!seatsOk ? (
                          <p className="text-xs text-red-600">
                            Du kan inte ta denna (för få säten).
                          </p>
                        ) : (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {drive.type === "emergency" ? (
                              ETA_OPTIONS.map((eta) => (
                                <button
                                  key={eta}
                                  onClick={() => volunteerOfferDrive(drive.id, eta)}
                                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                                  type="button"
                                >
                                  Ja, {eta} min
                                </button>
                              ))
                            ) : (
                              <button
                                onClick={() => volunteerOfferDrive(drive.id)}
                                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                                type="button"
                              >
                                Ja, jag tar den tiden
                              </button>
                            )}
                            <button
                              onClick={() => volunteerDeclineDrive(drive.id)}
                              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
                              type="button"
                            >
                              Nej, kan inte
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-500">
                        {drive.offers.length} frivilliga svar har kommit in.
                      </p>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <h2 className="text-base font-semibold text-zinc-100">Schema / bokade körningar</h2>
          <div className="mt-3 space-y-3">
            {assignedDrives.length === 0 ? (
              <p className="text-sm text-zinc-500">Inget bokat ännu.</p>
            ) : (
              assignedDrives.map((drive) => {
                const neededMs = new Date(drive.neededAt).getTime();
                const drivePhaseLabel =
                  drive.status === "done"
                    ? "Klar"
                    : Number.isFinite(neededMs) && matchClockMs >= neededMs
                      ? "Kör nu"
                      : "Bokad";
                const drivePhaseClass =
                  drivePhaseLabel === "Kör nu"
                    ? "border-amber-700/60 bg-amber-500/20 text-amber-100"
                    : drivePhaseLabel === "Klar"
                      ? "border-emerald-700/60 bg-emerald-500/20 text-emerald-100"
                      : "border-cyan-700/60 bg-cyan-500/20 text-cyan-100";
                const isMyConfirmedDrive =
                  user.role === "volunteer" &&
                  drive.status === "assigned" &&
                  drive.assignedVolunteerId === user.id;
                const showAdminDriveLeg =
                  user.role === "admin" && drive.status === "assigned";
                const navToPickupGoogle = googleDirectionsToDestination(drive.pickupAddress);
                const navToPickupApple = appleMapsToDestination(drive.pickupAddress);
                const navLegGoogle = googleDirectionsFromTo(
                  drive.pickupAddress,
                  drive.destinationAddress,
                );
                const navLegApple = appleMapsFromTo(drive.pickupAddress, drive.destinationAddress);
                return (
                <article
                  key={drive.id}
                  className={`rounded-xl border p-3 ${
                    drive.status === "done"
                      ? "border-emerald-800/60 bg-emerald-900/30"
                      : "border-cyan-800/60 bg-cyan-900/30"
                  }`}
                >
                  <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    {drive.id}
                    <span className="rounded-full border border-cyan-700/50 bg-cyan-500/15 px-2 py-0.5 text-cyan-300">
                      {VEHICLE_LABELS[drive.vehicleType]}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 ${drivePhaseClass}`}>
                      {drivePhaseLabel}
                    </span>
                  </p>
                  <p className="text-sm text-zinc-100">
                    {drive.pickupAddress} {"->"} {drive.destinationAddress}
                  </p>
                  <p className="text-sm text-zinc-200">
                    Volontär: <strong>{drive.assignedVolunteerId ?? "ej satt"}</strong>
                    {drive.assignedEtaMinutes ? ` (ETA ${drive.assignedEtaMinutes} min)` : ""}
                  </p>
                  <p className="text-sm text-zinc-200">
                    Status:{" "}
                    <strong>{drive.status === "done" ? "klar" : "bokad"}</strong>
                  </p>
                  {showAdminDriveLeg ? (
                    <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-950/50 p-2">
                      <p className="mb-1.5 text-xs font-medium text-zinc-400">
                        Vägbeskrivning: själva körningen (hämtning → mål)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={navLegGoogle}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={MAP_LINK_CLASS}
                        >
                          Visa väg (Google)
                        </a>
                        <a
                          href={navLegApple}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={MAP_LINK_SECONDARY_CLASS}
                        >
                          Apple Kartor
                        </a>
                      </div>
                    </div>
                  ) : null}
                  {user.role === "admin" &&
                  drive.status === "assigned" &&
                  drive.liveLocation &&
                  token ? (
                    <AdminDriveLiveLocation
                      token={token}
                      pickupAddress={drive.pickupAddress}
                      destinationAddress={drive.destinationAddress}
                      liveLocation={drive.liveLocation}
                    />
                  ) : null}
                  {user.role === "admin" &&
                  drive.status === "assigned" &&
                  !drive.liveLocation ? (
                    <p className="mt-2 text-xs text-zinc-500">
                      Volontären har inte delat live-position ännu.
                    </p>
                  ) : null}
                  {isMyConfirmedDrive ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-cyan-800/40 bg-zinc-950/60 p-3">
                      <p className="text-xs text-zinc-400">
                        Vägbeskrivning öppnar din kartapp (Google eller Apple). Första steget är till
                        upphämtningen; andra när du kör vidare till målet.
                      </p>
                      <div>
                        <p className="mb-1.5 text-xs font-medium text-zinc-300">1. Till upphämtning</p>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={navToPickupGoogle}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={MAP_LINK_CLASS}
                          >
                            Visa väg (Google)
                          </a>
                          <a
                            href={navToPickupApple}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={MAP_LINK_SECONDARY_CLASS}
                          >
                            Apple Kartor
                          </a>
                        </div>
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-medium text-zinc-300">
                          2. Körning till mål (hämtning → destination)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={navLegGoogle}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={MAP_LINK_CLASS}
                          >
                            Visa väg (Google)
                          </a>
                          <a
                            href={navLegApple}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={MAP_LINK_SECONDARY_CLASS}
                          >
                            Apple Kartor
                          </a>
                        </div>
                      </div>
                      <VolunteerLocationShare
                        driveId={drive.id}
                        token={token}
                        serverLocation={drive.liveLocation}
                      />
                    </div>
                  ) : null}
                  {user.role === "admin" && drive.status !== "done" ? (
                    <button
                      type="button"
                      onClick={() => markDriveDone(drive.id)}
                      className="mt-2 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                    >
                      Markera klar
                    </button>
                  ) : null}
                </article>
                );
              })
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
