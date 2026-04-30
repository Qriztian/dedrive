import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

const cache = new Map<string, { lat: number; lon: number; cachedAt: number }>();
const TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const session = getSession(tokenFromRequest(request));
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Saknar behörighet." }, { status: 403 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) {
    return NextResponse.json({ error: "Adressen är för kort." }, { status: 400 });
  }

  const hit = cache.get(q);
  if (hit && Date.now() - hit.cachedAt < TTL_MS) {
    return NextResponse.json({ lat: hit.lat, lon: hit.lon });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "DelegatTransport/1.0 (intern volontärhantering)",
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Geokodning misslyckades." }, { status: 502 });
  }
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  const first = data[0];
  if (!first) {
    return NextResponse.json({ error: "Hittade ingen plats." }, { status: 404 });
  }
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Ogiltigt svar." }, { status: 502 });
  }
  cache.set(q, { lat, lon, cachedAt: Date.now() });
  return NextResponse.json({ lat, lon });
}
