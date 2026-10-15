import { describe, expect, it } from "vitest";
import { parseFile } from "./parser";
import { aggregatePaTransactions, paTransactionTables } from "./pa-transactions";

import { paTransactionFixture } from "./fixtures";

describe("BPI PA dated transaction dashboard", () => {
  it("keeps transmittal volume separate from booked volume and preserves source line labels", () => {
    const parsed = parseFile(paTransactionFixture(), "BPI PA DASHBOARD SEPTEMBER.xlsx", "xlsx");
    const tables = paTransactionTables(parsed.rows[0]);
    expect(tables).toHaveLength(2);
    const { totals, errors } = aggregatePaTransactions(parsed.rows, tables);
    expect(errors).toEqual([]);
    const transmitted = [...totals.values()].filter(row => row.metric === "TRANSMITTAL VOLUME");
    const booked = [...totals.values()].filter(row => row.metric === "BOOKED VOLUME");
    expect(transmitted.reduce((sum, row) => sum + row.cents, 0)).toBe(30030);
    expect(booked.reduce((sum, row) => sum + row.cents, 0)).toBe(20000);
    expect(transmitted[0]).toMatchObject({ year: 2026, month: 9, count: 2, sourceRows: [2, 3], lines: ["LINE 1", "LINE 2"], weeks: [20010, 10020, 0, 0, 0] });
    expect(transmitted[1]).toMatchObject({ name: "Agent B", cents: 0, count: 1 });
  });
  it("produces the same totals in streamed chunks without counting summary cells", () => {
    const { rows } = parseFile(paTransactionFixture(), "source.xlsx", "xlsx");
    const tables = paTransactionTables(rows[0]);
    const first = aggregatePaTransactions(rows.slice(0, 2), tables);
    const second = aggregatePaTransactions(rows.slice(2), tables, first.totals);
    expect([...second.totals.values()]).toEqual([...aggregatePaTransactions(rows, tables).totals.values()]);
  });
  it("rejects a dated transaction with an invalid amount rather than reporting it as zero", () => {
    const { rows } = parseFile(paTransactionFixture(), "source.xlsx", "xlsx");
    rows[1].cells[7].value = "invalid";
    expect(aggregatePaTransactions(rows, paTransactionTables(rows[0])).errors).toHaveLength(1);
  });
  it("retains pending amounts in source data without inventing booked production", () => {
    const { rows } = parseFile(paTransactionFixture(), "source.xlsx", "xlsx");
    rows[1].cells[1].value = null;
    rows[1].cells[1].formatted = null;
    const result = aggregatePaTransactions(rows, paTransactionTables(rows[0]));
    expect(result.errors).toEqual([]);
    expect([...result.totals.values()].filter(row => row.metric === "BOOKED VOLUME").reduce((sum, row) => sum + row.cents, 0)).toBe(8000);
    expect([...result.totals.values()].filter(row => row.metric === "TRANSMITTAL VOLUME").reduce((sum, row) => sum + row.cents, 0)).toBe(30030);
  });
  it("does not interpret a normal campaign or summary sheet as transaction details", () => {
    const { rows } = parseFile(paTransactionFixture(), "source.xlsx", "xlsx");
    rows[0].cells[6].value = "MTD";
    expect(paTransactionTables(rows[0])).toEqual([]);
  });
});
