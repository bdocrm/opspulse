import * as XLSX from "xlsx";
import type { Availability, RawCell } from "./types";
import { normalizeProductionName } from "../production-normalization";

export const normalizeName = normalizeProductionName;
const ERROR_CODES: Record<number, string> = { 0: "#NULL!", 7: "#DIV/0!", 15: "#VALUE!", 23: "#REF!", 29: "#NAME?", 36: "#NUM!", 42: "#N/A", 43: "#GETTING_DATA" };
export function cellText(cell?: RawCell) {
  if (!cell) return "";
  if (cell.type === "e") return cell.formatted || ERROR_CODES[Number(cell.value)] || "#ERROR!";
  return String(cell.value ?? cell.formatted ?? "").trim();
}
export function nonEmpty(cell: RawCell) { return cell.formula != null || (cell.value != null && cell.value !== "") || (cell.formatted != null && cell.formatted !== ""); }
export function normalizeNumber(cell?: RawCell, percentage = false): { value: number | null; status: Availability; reason?: string } {
  const text = cellText(cell);
  if (cell?.type === "e" || /^#(?:REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|NULL!|ERROR!|GETTING_DATA)$/i.test(text)) return { value: null, status: "FORMULA_ERROR", reason: text };
  if (/^(?:|null|n\/?a|not (?:yet )?available|pending|unavailable|tbd|[-–—])$/i.test(text)) return { value: null, status: "PENDING" };
  if (cell?.type === "b" || cell?.type === "d") return { value: null, status: "INVALID", reason: "Expected a numeric value." };
  const hasPercent = /%/.test(text) || /%/.test(cell?.numberFormat ?? "");
  if (typeof cell?.value === "number") {
    if (!Number.isFinite(cell.value) || (Number.isInteger(cell.value) && !Number.isSafeInteger(cell.value))) return { value: null, status: "INVALID", reason: "Number is not finite or exceeds supported precision." };
    return { value: cell.value, status: "AVAILABLE" }; // Excel percentage values already use fractions.
  }
  const cleaned = text.replace(/^[₱$€£]\s*/, "").replace(/^PHP\s*/i, "").replace(/%$/, "").trim();
  const accounting = /^\([\d.,]+\)$/.test(cleaned);
  const signed = accounting ? `-${cleaned.slice(1, -1)}` : cleaned;
  if (signed.includes(",") && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(signed)) return { value: null, status: "INVALID", reason: "Ambiguous thousands separators. Use standard groups of three digits." };
  const numeric = signed.replace(/,/g, "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(numeric)) return { value: null, status: "INVALID", reason: `Invalid number: ${text.slice(0, 80)}` };
  let value = Number(numeric);
  if (hasPercent) value /= 100;
  // A plain rate value is deliberately not scaled based on magnitude alone.
  if (!Number.isFinite(value) || (!Number.isSafeInteger(value) && Number.isInteger(value))) return { value: null, status: "INVALID", reason: "Number exceeds supported precision." };
  return { value, status: "AVAILABLE" };
}

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2100 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}
export function parseReportDate(cell?: RawCell) {
  const text = cellText(cell);
  const reportStatus = /unofficial/i.test(text) ? "UNOFFICIAL" : /prelim/i.test(text) ? "PRELIMINARY" : /\bfinal\b/i.test(text) ? "FINAL" : /pending/i.test(text) ? "PENDING" : "UNKNOWN";
  let date: string | null = null;
  if (cell?.type === "e" || /^#/.test(text)) return { date, reportStatus, text, invalid: true };
  if (cell?.type === "d") date = validDate(Number(text.slice(0, 4)), Number(text.slice(5, 7)), Number(text.slice(8, 10)));
  else if (typeof cell?.value === "number") {
    const parsed = XLSX.SSF.parse_date_code(cell.value);
    if (parsed) date = validDate(parsed.y, parsed.m, parsed.d);
  } else {
    const named = text.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2}|2100)\b/i);
    const iso = text.match(/\b(20\d{2}|2100)-(\d{1,2})-(\d{1,2})\b/);
    const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|2100)\b/);
    if (named) date = validDate(Number(named[3]), months.findIndex(month => month.startsWith(named[1].toLowerCase())) + 1, Number(named[2]));
    else if (iso) date = validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    else if (us) date = validDate(Number(us[3]), Number(us[1]), Number(us[2]));
  }
  return { date, reportStatus, text, invalid: Boolean(text) && !date && !/^(?:pending|n\/?a|not (?:yet )?available)$/i.test(text) };
}
export function detectPeriod(text: string): { month: number | null; year: number | null } {
  const monthIndex = months.findIndex(month => new RegExp(`\\b(?:${month}|${month.slice(0, 3)})\\b`, "i").test(text));
  const year = text.match(/\b(20\d{2}|2100)\b/);
  return { month: monthIndex < 0 ? null : monthIndex + 1, year: year ? Number(year[1]) : null };
}
