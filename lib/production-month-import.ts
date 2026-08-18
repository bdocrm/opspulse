export type ProductionMonthImportStrategy = "fill_missing" | "update_existing";
export type ProductionMonthImportAction = "IMPORT" | "SKIP" | "UPDATE";

export function productionMonthKey(campaignId: string, year: number, month: number) {
  return `${campaignId}:${year}:${month}`;
}

export function productionMonthImportAction(monthExists: boolean, strategy: ProductionMonthImportStrategy): ProductionMonthImportAction {
  if (!monthExists) return "IMPORT";
  return strategy === "update_existing" ? "UPDATE" : "SKIP";
}

export function compareProductionMonths(
  incoming: Array<{ campaignId: string; year: number; month: number }>,
  existingKeys: Set<string>,
  strategy: ProductionMonthImportStrategy
) {
  return incoming.map((period) => {
    const key = productionMonthKey(period.campaignId, period.year, period.month);
    const exists = existingKeys.has(key);
    return { ...period, key, status: exists ? "EXISTING" as const : "NEW" as const, action: productionMonthImportAction(exists, strategy) };
  });
}
