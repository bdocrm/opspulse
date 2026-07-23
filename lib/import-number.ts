const EMPTY_VALUES = /^(?:|[-–—]|n\/?a|no data|none|null|undefined)$/i;

export interface ParsedImportNumber {
  value: number | null;
  valid: boolean;
  percentage: boolean;
}

/** Parse Excel numeric cells and commonly formatted numeric strings without formatting them for storage. */
export function parseImportNumber(raw: unknown): ParsedImportNumber {
  if (raw == null) return { value: null, valid: true, percentage: false };
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { value: raw, valid: true, percentage: false }
      : { value: null, valid: false, percentage: false };
  }

  const source = String(raw).trim();
  if (EMPTY_VALUES.test(source)) return { value: null, valid: true, percentage: false };
  const percentage = source.endsWith("%");
  const parenthesized = /^\(.*\)$/.test(source);
  const cleaned = source
    .replace(/^\((.*)\)$/, "$1")
    .replace(/[,%\s]/g, "")
    .replace(/[^0-9+\-.]/g, "");
  if (!cleaned || !/[0-9]/.test(cleaned)) return { value: null, valid: false, percentage };
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { value: null, valid: false, percentage };
  return { value: parenthesized ? -Math.abs(parsed) : parsed, valid: true, percentage };
}
