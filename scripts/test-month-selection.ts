import assert from "assert";
import {
  ALL_MONTHS,
  dataCoverage,
  isSelectedPeriod,
  monthSelectionLabel,
  monthSelectionRange,
  normalizeMonthSelection,
  normalizeMonthValue,
} from "../lib/month-selection";
import { compareProductionMonths } from "../lib/production-month-import";

assert.equal(normalizeMonthValue("January"), 1);
assert.equal(normalizeMonthValue("Jan"), 1);
assert.equal(normalizeMonthValue("JAN"), 1);
assert.equal(normalizeMonthValue("01"), 1);
assert.equal(normalizeMonthValue("1"), 1);
assert.equal(normalizeMonthValue("January 2026"), 1);
assert.equal(normalizeMonthValue("2026-01-15"), 1);
assert.deepEqual(normalizeMonthSelection("6,1,4,1"), [1, 4, 6]);
assert.equal(monthSelectionLabel([9]), "September");
assert.equal(monthSelectionLabel([1, 3, 4, 6]), "4 Months Selected");
assert.equal(monthSelectionLabel(ALL_MONTHS), "All Months");
assert.deepEqual(monthSelectionRange(2026, [1, 3, 6]), { dateFrom: "2026-01-01", dateTo: "2026-06-30" });
assert(isSelectedPeriod(2026, 3, 2026, [1, 3, 6]));
assert(!isSelectedPeriod(2026, 2, 2026, [1, 3, 6]));
assert.deepEqual(dataCoverage([1, 2, 3, 6]), { available: [1, 2, 3, 6], count: 4, total: 12, percent: 33 });

const incoming = [1, 2, 3, 4, 5, 6].map((month) => ({ campaignId: "campaign-a", year: 2026, month }));
const existing = new Set([1, 2, 3].map((month) => `campaign-a:2026:${month}`));
assert.deepEqual(compareProductionMonths(incoming, existing, "fill_missing").map((period) => period.action), ["SKIP", "SKIP", "SKIP", "IMPORT", "IMPORT", "IMPORT"]);
assert.deepEqual(compareProductionMonths(incoming, existing, "update_existing").map((period) => period.action), ["UPDATE", "UPDATE", "UPDATE", "IMPORT", "IMPORT", "IMPORT"]);

console.log("Month selection and incremental import tests passed.");
