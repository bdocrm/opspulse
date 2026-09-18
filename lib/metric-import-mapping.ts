export const METRIC_ALIASES = {
  transmittals: ['transmitted', 'transmittal', 'transmittals', 'transmitted count'],
  approvals: ['approval', 'approvals', 'approved', 'approval count'],
  booked: ['booked', 'booking', 'bookings', 'booked count'],
  activations: ['activation', 'activations', 'activated'],
  goal: ['agent goal', 'individual goal', 'agent target', 'individual target', 'personal goal', 'monthly agent goal', 'goal', 'target'],
  actual: ['mtd production', 'total mtd', 'mtd', 'actual production', 'actual', 'collected amount', 'total collection', 'amount collected', 'performance', 'production'],
  achievement: ['achievement', 'attainment'],
  ntb: ['ntb', 'new to bank'],
  supplementary: ['supplementary', 'supplemental', 'supp'],
  volume: ['booked volume', 'collected amount', 'total collection', 'amount collected', 'production', 'volume', 'amount'],
  count: ['count', 'transaction', 'transactions'],
} as const;

export type RecognizedMetric = keyof typeof METRIC_ALIASES;

export function normalizeMetricHeader(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchMetricAlias(value: unknown): RecognizedMetric | null {
  const normalized = normalizeMetricHeader(value);
  if (!normalized) return null;

  // Exact alias matches always win so a specific label such as "booked
  // volume" maps to `volume` and never falls through to the substring match
  // against the shorter "booked" alias in the `booked` group.
  for (const [metric, aliases] of Object.entries(METRIC_ALIASES) as Array<[RecognizedMetric, readonly string[]]>) {
    if (aliases.some((alias) => normalized === alias)) return metric;
  }

  // Otherwise use the longest alias contained in the header. This keeps
  // "Transmitted Volume" on the transmittals group while still letting
  // "Booked Volume" resolve to `volume`.
  let best: { metric: RecognizedMetric; length: number } | null = null;
  for (const [metric, aliases] of Object.entries(METRIC_ALIASES) as Array<[RecognizedMetric, readonly string[]]>) {
    for (const alias of aliases) {
      if (normalized.includes(alias) && alias.length > (best?.length ?? 0)) {
        best = { metric, length: alias.length };
      }
    }
  }
  return best?.metric ?? null;
}
