import type { Drive, Offer } from "@/lib/types";

export const MATCHING_WINDOW_MS = 2 * 60 * 1000;

export function matchingDeadlineMs(createdAt: string): number {
  return new Date(createdAt).getTime() + MATCHING_WINDOW_MS;
}

/** Anbud inom matchningsfönstret (2 min från publicering). */
export function chooseBestOffer(drive: Drive): Offer | undefined {
  const valid = drive.offers.filter((offer) => {
    const created = new Date(drive.createdAt).getTime();
    const offered = new Date(offer.offeredAt).getTime();
    return offered - created <= MATCHING_WINDOW_MS;
  });
  if (valid.length === 0) return undefined;
  return valid.sort((a, b) => a.etaMinutes - b.etaMinutes)[0];
}

/** Under matchningsperioden: vem leder preliminärt (kortast ETA bland giltiga anbud). */
export function provisionalLeader(drive: Drive): Offer | undefined {
  if (drive.status !== "open") return undefined;
  return chooseBestOffer(drive);
}
