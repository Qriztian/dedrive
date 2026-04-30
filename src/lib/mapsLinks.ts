/**
 * Deep links for turn-by-turn navigation on phones.
 * Google Maps URLs open the app (or browser) on iOS and Android.
 * Apple Maps URLs work well as a fallback on iPhone.
 */

const DRIVE_MODE = "driving";

export function googleDirectionsToDestination(destination: string): string {
  const u = new URL("https://www.google.com/maps/dir/?api=1");
  u.searchParams.set("destination", destination);
  u.searchParams.set("travelmode", DRIVE_MODE);
  return u.toString();
}

export function googleDirectionsFromTo(origin: string, destination: string): string {
  const u = new URL("https://www.google.com/maps/dir/?api=1");
  u.searchParams.set("origin", origin);
  u.searchParams.set("destination", destination);
  u.searchParams.set("travelmode", DRIVE_MODE);
  return u.toString();
}

export function appleMapsToDestination(destination: string): string {
  const q = new URLSearchParams();
  q.set("daddr", destination);
  q.set("dirflg", "d");
  return `https://maps.apple.com/?${q.toString()}`;
}

export function appleMapsFromTo(origin: string, destination: string): string {
  const q = new URLSearchParams();
  q.set("saddr", origin);
  q.set("daddr", destination);
  q.set("dirflg", "d");
  return `https://maps.apple.com/?${q.toString()}`;
}
