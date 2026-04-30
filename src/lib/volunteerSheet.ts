/** Normalisera rubrikcell för matchning (små bokstäver, utan diakritika). */
export function normalizeHeaderLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export type VolunteerImportInput = { id: string; pin: string; seats: number };

/** Excel/CSV-rad till text (behåller PIN så väl det går; ledande nollor kräver textkolumn i Excel). */
export function cellToTrimmedString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  return String(value).trim();
}

function mapHeaderRow(headers: string[]): { id: number; pin: number; seats: number } | null {
  const n = headers.map(normalizeHeaderLabel);
  const idAliases = [
    "id",
    "volontar",
    "volontarid",
    "volontarnummer",
    "volontarnr",
    "volontar nr",
    "nummer",
    "nr",
  ].map(normalizeHeaderLabel);
  const pinAliases = ["pin", "kod", "losenord", "inloggningskod", "pinkod", "password"].map(
    normalizeHeaderLabel,
  );
  const seatAliases = [
    "saten",
    "seats",
    "passagerarplatser",
    "platser",
    "bilplatser",
    "antal saten",
  ].map(normalizeHeaderLabel);

  function colFor(aliases: string[]): number {
    for (let i = 0; i < n.length; i += 1) {
      const h = n[i];
      if (!h) continue;
      for (const a of aliases) {
        if (h === a || h.includes(a)) return i;
      }
    }
    return -1;
  }

  const id = colFor(idAliases);
  const pin = colFor(pinAliases);
  const seats = colFor(seatAliases);
  if (id >= 0 && pin >= 0 && seats >= 0) return { id, pin, seats };
  return null;
}

/**
 * Första bladet som matris (rad 0 kan vara rubriker).
 * Om rubrikrad hittas används den; annars förutsätts kolumnordning: A=id, B=PIN, C=säten.
 */
export function parseVolunteerMatrix(matrix: unknown[][]): VolunteerImportInput[] {
  if (matrix.length === 0) return [];

  const headerCells = matrix[0].map((c) => cellToTrimmedString(c));
  const colMap = mapHeaderRow(headerCells);
  const startRow = colMap !== null ? 1 : 0;
  const cols = colMap ?? { id: 0, pin: 1, seats: 2 };

  const out: VolunteerImportInput[] = [];
  for (let r = startRow; r < matrix.length; r += 1) {
    const row = matrix[r] ?? [];
    const id = cellToTrimmedString(row[cols.id]);
    const pin = cellToTrimmedString(row[cols.pin]);
    const seatsRaw = row[cols.seats];
    const seatsNum =
      typeof seatsRaw === "number" && Number.isFinite(seatsRaw)
        ? seatsRaw
        : Number(cellToTrimmedString(seatsRaw));
    if (!id || !pin) continue;
    if (!Number.isFinite(seatsNum) || seatsNum < 1 || seatsNum > 9) continue;
    out.push({ id, pin, seats: Math.trunc(seatsNum) });
  }
  return out;
}

export function parseVolunteerCsvLines(lines: string[]): VolunteerImportInput[] {
  const matrix = lines.map((line) => line.split(",").map((p) => p.trim()) as unknown[]);
  return parseVolunteerMatrix(matrix);
}
