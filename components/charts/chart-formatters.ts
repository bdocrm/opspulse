export function formatChartNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}
