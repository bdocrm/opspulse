type Period = { year: number; month: number };
type DashboardRow = Period & { campaignId: string; recordKind: string; entityName: string; metric: string; monitoringType: string | null; actual: number | null; target: number | null; achievement: number | null };
type MonitoringRow = { campaignId: string; reportYear: number; reportMonth: number; mtd: number | null; target: number | null };
type MetricRow = { campaignId: string; reportYear: number; reportMonth: number | null; metricType: string; count: bigint | null; actual: number | null };
type KpiRow = Period & { campaignId: string; achievementQa: number | null; achievementAht: number | null; achievementAdherence: number | null; achievementCm: number | null; achievementCd: number | null };
export type BdoPeriodResult = Period & { actual: number; goal: number | null; source: 'monitoring' | 'workbook-summary' | 'agent-detail' | 'ranking' | 'acvt'; sourceGoal: number | null; configuredGoal: number | null; fallbackGoal: boolean };
const positive = (v: number | null | undefined) => v != null && Number.isFinite(v) && v > 0 ? v : null;
const normalized = (v: string) => v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const actual = (r: DashboardRow) => r.actual ?? (r.target != null && r.achievement != null ? Math.round(r.target * r.achievement) : null);

/** Resolve authority inside each month before adding months. Monitoring must
 * never replace earlier months that only have a workbook/ranking source. */
export function resolveBdoPeriodPerformance(input: {
  campaignId: string; campaignName: string; defaultGoal: number; periods: Period[];
  goals: (Period & { campaignId: string; monthlyGoal: number })[];
  dashboard: DashboardRow[]; monitoring: MonitoringRow[]; metrics: MetricRow[]; kpis: KpiRow[];
}) {
  const results: BdoPeriodResult[] = [];
  const ccc = /^BDO\s+CCC$/i.test(input.campaignName);
  for (const period of input.periods) {
    const same = (r: Period & { campaignId: string }) => r.campaignId === input.campaignId && r.year === period.year && r.month === period.month;
    const config = positive(input.goals.find(same)?.monthlyGoal);
    const monitoring = input.monitoring.filter(r => same({ campaignId:r.campaignId, year:r.reportYear, month:r.reportMonth }));
    const dashboard = input.dashboard.filter(same);
    let value: number | null = null, sourceGoal: number | null = null;
    let source: BdoPeriodResult['source'] = 'agent-detail';
    if (ccc) {
      const scores = input.kpis.filter(same).flatMap(r => [r.achievementQa,r.achievementAht,r.achievementAdherence,r.achievementCm,r.achievementCd].filter((v):v is number=>v!=null));
      if (scores.length) { value = Math.max(...scores) * 100; source = 'acvt'; }
    } else if (monitoring.some(r => r.mtd != null)) {
      value = monitoring.reduce((s,r)=>s+Number(r.mtd??0),0);
      sourceGoal = monitoring.every(r=>positive(r.target)!=null) ? monitoring.reduce((s,r)=>s+Number(r.target),0) : null;
      source = 'monitoring';
    } else {
      const controls = dashboard.filter(r=>r.recordKind==='ytd' && actual(r)!=null);
      if (controls.length) {
        value = controls.reduce((s,r)=>s+Number(actual(r)),0);
        sourceGoal = controls.every(r=>positive(r.target)!=null) ? controls.reduce((s,r)=>s+Number(r.target),0) : null;
        source = 'workbook-summary';
      } else {
        const preferred = new Map<string, DashboardRow>();
        for (const r of dashboard.filter(r=>r.recordKind==='agent_monitoring' && actual(r)!=null)) {
          const key = `${normalized(r.entityName)}|${normalized(r.metric)}`;
          const previous = preferred.get(key);
          if (!previous || (r.monitoringType?.endsWith('_AGENT') && !previous.monitoringType?.endsWith('_AGENT'))) preferred.set(key,r);
        }
        if (preferred.size) {
          value = [...preferred.values()].reduce((s,r)=>s+Number(actual(r)),0);
          const targets = [...preferred.values()].map(r=>positive(r.target));
          sourceGoal = targets.some(v=>v!=null) ? targets.reduce<number>((s,v)=>s+(v??0),0) : null;
        } else {
          const metrics = input.metrics.filter(r=>r.campaignId===input.campaignId&&r.reportYear===period.year&&r.reportMonth===period.month&&r.metricType==='transmittals'&&(r.count!=null||r.actual!=null));
          if (metrics.length) { value = metrics.reduce((s,r)=>s+Number(r.actual??r.count??0),0); source = 'ranking'; }
        }
      }
    }
    if (value == null) continue; // Missing months are not zero production.
    const fallbackGoal = !ccc && config == null && sourceGoal == null;
    results.push({ ...period, actual:value, goal:ccc?null:config??sourceGoal??positive(input.defaultGoal), source, sourceGoal, configuredGoal:config, fallbackGoal });
  }
  const value = results.length ? ccc ? Math.max(...results.map(r=>r.actual)) : results.reduce((s,r)=>s+r.actual,0) : null;
  const goal = results.length && results.every(r=>r.goal!=null) ? results.reduce((s,r)=>s+Number(r.goal),0) : null;
  return { periods:results, actual:value, goal, achievement:value!=null&&goal!=null&&goal>0?value/goal*100:null,
    unitType:ccc?'PERCENT_POINTS' as const:/^BDO\s+CIE$/i.test(input.campaignName)?'CURRENCY' as const:'COUNT' as const,
    breakdownComplete:results.every(r=>r.source==='agent-detail'||r.source==='ranking') };
}
