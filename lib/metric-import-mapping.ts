export const METRIC_ALIASES = {
  transmittals: ['transmitted', 'transmittal', 'transmittals', 'transmitted count'],
  approvals: ['approval', 'approvals', 'approved', 'approval count'],
  booked: ['booked', 'booking', 'bookings', 'booked count'],
  activations: ['activation', 'activations', 'activated'],
  goal: ['goal', 'target'],
  actual: ['actual', 'performance'],
  achievement: ['achievement', 'attainment'],
  ntb: ['ntb', 'new to bank'],
  supplementary: ['supplementary', 'supplemental', 'supp'],
  volume: ['volume', 'amount'],
  count: ['count', 'transaction', 'transactions'],
} as const;

export type RecognizedMetric = keyof typeof METRIC_ALIASES;

export function normalizeMetricHeader(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchMetricAlias(value: unknown): RecognizedMetric | null {
  const normalized = normalizeMetricHeader(value);
  if (!normalized) return null;
  for (const [metric, aliases] of Object.entries(METRIC_ALIASES) as Array<[RecognizedMetric, readonly string[]]>) {
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) return metric;
  }
  return null;
}

