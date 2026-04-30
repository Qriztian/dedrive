"use client";

import { useEffect, useState } from "react";
import { haversineKm } from "@/lib/geo";
import type { LiveLocation } from "@/lib/types";

type Props = {
  token: string;
  pickupAddress: string;
  destinationAddress: string;
  liveLocation: LiveLocation;
};

type Coords = { lat: number; lon: number };

export function AdminDriveLiveLocation({
  token,
  pickupAddress,
  destinationAddress,
  liveLocation,
}: Props) {
  const [pickup, setPickup] = useState<Coords | null>(null);
  const [dest, setDest] = useState<Coords | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function geocode(q: string): Promise<Coords | null> {
      const res = await fetch(`/api/admin/geocode?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { lat?: number; lon?: number };
      if (typeof j.lat !== "number" || typeof j.lon !== "number") return null;
      return { lat: j.lat, lon: j.lon };
    }
    void (async () => {
      if (!cancelled) {
        setLoading(true);
        setGeoError(null);
      }
      try {
        const p = await geocode(pickupAddress);
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 1100));
        const d = await geocode(destinationAddress);
        if (cancelled) return;
        setPickup(p);
        setDest(d);
        if (!p || !d) {
          setGeoError("Kunde inte geokoda en eller båda adresserna. Avstånd visas inte.");
        }
      } catch {
        if (!cancelled) setGeoError("Geokodning misslyckades.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, pickupAddress, destinationAddress]);

  const { lat, lng } = liveLocation;
  const kmPickup =
    pickup != null ? haversineKm(lat, lng, pickup.lat, pickup.lon) : null;
  const kmDest = dest != null ? haversineKm(lat, lng, dest.lat, dest.lon) : null;

  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;

  return (
    <div className="mt-3 rounded-lg border border-violet-800/50 bg-violet-950/25 p-3 text-xs text-violet-100">
      <p className="font-medium text-violet-200">Live-position (volontär)</p>
      <p className="mt-1 text-violet-300/80">
        Uppdaterad: {new Date(liveLocation.updatedAt).toLocaleString("sv-SE")}
      </p>
      {loading ? <p className="mt-2 text-violet-400">Beräknar avstånd…</p> : null}
      {geoError ? <p className="mt-2 text-amber-300/90">{geoError}</p> : null}
      {!loading && kmPickup != null ? (
        <p className="mt-2">
          Luftlinje till <strong>upphämtning</strong>: ca{" "}
          <strong>{kmPickup.toFixed(1)} km</strong>
        </p>
      ) : null}
      {!loading && kmDest != null ? (
        <p className="mt-1">
          Luftlinje till <strong>destination</strong>: ca <strong>{kmDest.toFixed(1)} km</strong>
        </p>
      ) : null}
      <p className="mt-2 text-[11px] text-violet-400/80">
        Avstånd är fågelvägen mot geokodade adresser – inte körväg.
      </p>
      <a
        href={osmUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex rounded-md border border-violet-600/60 bg-violet-950/60 px-2 py-1.5 text-[11px] font-medium text-violet-100 hover:bg-violet-900/50"
      >
        Öppna volontärens punkt på karta (OSM)
      </a>
    </div>
  );
}
