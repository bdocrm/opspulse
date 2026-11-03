import { describe, expect, it } from "vitest";
import { parseFile } from "./parser";
import { aggregatePaTransactions, paTransactionTables, paHistoryTables, PA_HISTORY_FAMILY } from "./pa-transactions";
import { projectPaHistory } from './workbook-dashboard';

import { paTransactionFixture, paHistoryFixture } from "./fixtures";

describe("BPI PA dated transaction dashboard", () => {
  it('leaves unlabeled history pending even if old agent assignments would match', async () => {
    const parsed = parseFile(paHistoryFixture(), 'history.xlsx', 'xlsx');
    const db = {
      campaign: { findMany: async () => [{ id:'out', campaignName:'BPI PA OUTBOUND' },{ id:'in', campaignName:'BPI PA INBOUND' }] },
      user: { findMany: () => { throw new Error('Old assignments must not be consulted'); } },
      dashboardImportRecord: { findMany: () => { throw new Error('Prior imports must not be consulted'); } },
      productionImportRawRow: {
        findUniqueOrThrow: async () => ({ rawPayload: parsed.rows[0] }),
        findMany: async ({ where }: { where: { sourceRow: { gt: number } } }) => parsed.rows.filter(row=>row.sourceRow>where.sourceRow.gt).map(row=>({ sourceRow:row.sourceRow,rawPayload:row })),
      },
    };
    const result = await projectPaHistory('source',parsed.inspection,'history.xlsx',{id:'actor',role:'CEO'},{family:PA_HISTORY_FAMILY,sourceSheet:'(M)mom',campaignId:null},db as never,true);
    expect(result.records).toBe(0);
    expect(result.pending).toHaveLength(36);
    expect(result.pending.every(row=>row.reason==='No explicit source campaign label')).toBe(true);
  });
  it('preserves explicit campaign evidence separately from product codes', () => {
    const parsed=parseFile(paHistoryFixture(true),'history.xlsx','xlsx');
    const result=aggregatePaTransactions(parsed.rows,paHistoryTables(parsed.rows[0]));
    expect([...result.totals.values()].find(row=>row.name==='History Out')).toMatchObject({campaignLabel:'OUTBOUND',lines:['BC']});
    expect([...result.totals.values()].find(row=>row.name==='History Ambiguous')).toMatchObject({campaignLabel:'LINE 1'});
  });
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
