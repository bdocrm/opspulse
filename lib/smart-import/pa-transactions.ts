import { cellText, nonEmpty, normalizeName, normalizeNumber, parseReportDate } from "./normalization";
import type { RawRow } from "./types";

export const PA_TRANSACTION_FAMILY = "BPI_PA_TRANSACTIONS_V1";
export const PA_HISTORY_FAMILY = "BPI_PA_HISTORY_V2";
type Table = { date: number; amount: number; agent: number; line: number; metric: "TRANSMITTAL VOLUME" | "BOOKED VOLUME" };
export function paHistoryTables(header: RawRow): Table[] {
  const labels = header.cells.map(cell => normalizeName(cellText(cell)));
  if (!labels.includes("MONTH") || !labels.includes("PRODUCT2")) return [];
  const date = labels.indexOf("APPROVAL DATE"), amount = labels.indexOf("APPROVED AMOUNT"), agent = labels.indexOf("AGENT NAME");
  return date >= 0 && amount >= 0 && agent >= 0 ? [{ date, amount, agent, line: labels.indexOf("PRODUCT2"), metric: "BOOKED VOLUME" }] : [];
}
export function paTransactionTables(header: RawRow): Table[] {
  const labels = header.cells.map(cell => normalizeName(cellText(cell)));
  const approval = labels.indexOf("APPROVAL DATE");
  const sent = labels.indexOf("DATE SENT");
  if (approval < 0 || sent < 0) return [];
  const find = (label: string, start: number, end: number) => labels.findIndex((value, index) => index >= start && index < end && value === label);
  const booked = { date: approval, amount: find("APPROVED AMOUNT", approval, sent), agent: find("AGENT NAME", approval, sent), line: find("LINE", approval, sent), metric: "BOOKED VOLUME" as const };
  const transmitted = { date: sent, amount: find("AMOUNT", sent, labels.length), agent: find("AGENT ID", sent, labels.length), line: find("LINE", sent, labels.length), metric: "TRANSMITTAL VOLUME" as const };
  return [booked, transmitted].every(table => table.amount >= 0 && table.agent >= 0) ? [booked, transmitted] : [];
}

export type PaTransactionTotal = { name: string; year: number; month: number; metric: Table["metric"]; cents: number; count: number; sourceRows: number[]; lines: string[]; weeks: number[] };
export function aggregatePaTransactions(rows: RawRow[], tables: Table[], totals = new Map<string, PaTransactionTotal>()) {
  const errors: string[] = [];
  for (const row of rows) {
    if (row.sourceRow === 1) continue;
    for (const table of tables) {
      const date = parseReportDate(row.cells[table.date]).date;
      if (!date) continue;
      const name = cellText(row.cells[table.agent]);
      const amount = normalizeNumber(row.cells[table.amount]);
      // A dated row with a blank/pending approval is not a booked zero.
      if (amount.status === "PENDING") continue;
      if (!name || amount.value == null || amount.status !== "AVAILABLE") {
        if (name || nonEmpty(row.cells[table.amount])) errors.push(`${row.sourceSheet}!${row.cells[table.date].address}: missing agent or invalid ${table.metric}.`);
        continue;
      }
      const [year, month, day] = date.split("-").map(Number);
      const key = JSON.stringify([normalizeName(name), year, month, table.metric]);
      const total = totals.get(key) ?? { name, year, month, metric: table.metric, cents: 0, count: 0, sourceRows: [], lines: [], weeks: [0, 0, 0, 0, 0] };
      const cents = Math.round(amount.value * 100);
      if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(total.cents + cents)) throw new Error("Transaction amount exceeds safe currency precision.");
      total.cents += cents; total.count++; total.sourceRows.push(row.sourceRow);
      total.weeks[Math.floor((day - 1) / 7)] += cents;
      const line = table.line >= 0 ? cellText(row.cells[table.line]) : "";
      if (line && !total.lines.includes(line)) total.lines.push(line);
      totals.set(key, total);
    }
  }
  return { totals, errors };
}
