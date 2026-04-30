"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveLocation } from "@/lib/types";

type Props = {
  driveId: string;
  token: string;
  /** Senaste kända position från servern (för att visa att delning fungerar). */
  serverLocation?: LiveLocation;
};

const POST_INTERVAL_MS = 22_000;

export function VolunteerLocationShare({ driveId, token, serverLocation }: Props) {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPostRef = useRef(0);

  const postLocation = useCallback(
    async (lat: number, lng: number) => {
      const res = await fetch(`/api/drives/${encodeURIComponent(driveId)}/location`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lat, lng }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Kunde inte spara position.");
      }
    },
    [driveId, token],
  );

  const stopSharing = useCallback(async () => {
    if (watchIdRef.current !== null && typeof navigator.geolocation !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharing(false);
    lastPostRef.current = 0;
    try {
      await fetch(`/api/drives/${encodeURIComponent(driveId)}/location`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // ignorera nätverksfel vid stopp
    }
  }, [driveId, token]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator.geolocation !== "undefined") {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  async function startSharing() {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Plats stöds inte i den här webbläsaren.");
      return;
    }
    setSharing(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const now = Date.now();
        if (now - lastPostRef.current < POST_INTERVAL_MS) return;
        lastPostRef.current = now;
        try {
          await postLocation(lat, lng);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Fel vid uppladdning.");
        }
      },
      (err) => {
        setError(err.message || "Kunde inte läsa position.");
        setSharing(false);
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-950/80 p-3">
      <p className="text-xs font-medium text-zinc-200">Dela plats med admin?</p>
      <p className="mt-1 text-xs text-zinc-500">
        Frivilligt. Din position skickas ungefär var 20–30:e sekund så länge körningen är bokad.
        Admin ser ungefärlig luftlinje till upphämtning och mål (via adressgeokodning).
      </p>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      {serverLocation ? (
        <p className="mt-2 text-xs text-emerald-400/90">
          Senast skickad position: {new Date(serverLocation.updatedAt).toLocaleString("sv-SE")}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {!sharing ? (
          <button
            type="button"
            onClick={() => void startSharing()}
            className="rounded-md border border-emerald-700/60 bg-emerald-950/50 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-900/40"
          >
            Ja, dela min plats
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void stopSharing()}
            className="rounded-md border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            Sluta dela
          </button>
        )}
      </div>
    </div>
  );
}
