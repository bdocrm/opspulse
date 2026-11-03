const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const assert = require('assert/strict');
const input = path.join(process.env.TEMP, 'opsview-performance-audit-2026/audit.json');
const audit = JSON.parse(fs.readFileSync(input));
assert.equal(audit.campaigns.length, 37);
assert.equal(audit.months.length, 11);
assert.equal(audit.failures.length, 0);
const out = path.join(process.cwd(), 'outputs/performance-audit-2026-11-03');
fs.mkdirSync(out, { recursive: true });
const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov'];
const fmt = v => v == null ? 'Unavailable' : Number(v).toLocaleString('en-PH', { maximumFractionDigits: 2 });
const pct = v => v == null ? 'NG' : `${Number(v).toFixed(2)}%`;
const get = (id, month) => audit.months.find(m => m.month === month).campaigns.find(c => c.id === id);
const hasData = r => r.recordCount > 0 && !(r.campaignName === 'MB ACQ' && r.month === 10);
const entries = c => audit.months.map(m => ({ month: m.month, ...get(c.id,m.month) })).filter(hasData);
const noData = audit.campaigns.filter(c => !entries(c).length);
const sources = audit.inventory.monitoringSources;
const partial = (id, month) => sources.some(s => s.campaignId === id && s.reportMonth === month && s.daysLapse != null && s.workingDays != null && s.daysLapse < s.workingDays);
function notes(c) {
  const name = c.campaignName;
  if (name === 'BPI PA OUTBOUND') return 'Sep above dashboard target; target falls from 1.098B to fallback 670M. Source-to-campaign attribution still needs verification; 146 source entries remain pending across all months.';
  if (name === 'BPI PA INBOUND') return 'Aug has only one imported record (300K); Sep absent. Do not interpret missing/incomplete imports as a final business decline. PA campaign attribution requires source-label verification.';
  if (name === 'BPI PL') return 'Sep source verified. Aug is missing despite 130.67M in supplied YTD file; Apr-Jul differ from that file. Sep 667M target is campaign default, not a saved September-specific goal. Agent targets absent in the supplied booked-volume file.';
  if (name === 'BDO CCC') return 'Displayed value is the maximum imported ACVT achievement percentage across agents; not a transaction count or an overall team average. Do not rank directly against sales campaigns.';
  if (name === 'BDO CIE') return 'Jan-May data only; February-April above the displayed target, May at 81.09%. Compare currency volume, not default activations label.';
  if (['BDO NTH CARD','BDO SGM','BDO SUPPLE','BDO VC'].includes(name)) return 'Early target/metric configuration differs sharply from later monitoring data; very high early percentages need target validation. Aug is partial-month. No September records.';
  if (name === 'BDO Online') return 'May-Jul below displayed target; Aug partial through Aug 11. Units in source; dashboard metric label volume does not mean pesos.';
  if (name === 'MB ACQ') return 'Jan-Jun positive actuals; Jun 153.59%. Jul-Sep absent. Oct contains blank actuals and zero-score placeholders from a July import; exclude from confirmed October performance.';
  if (name === 'MB PA') return 'Currency-like amounts under a transmittals label; validate units. Apr-Jun actuals exist but dashboard goals are missing. Campaign default exists but must not be retroactively assumed as approved period target.';
  if (name === 'MB PL') return 'Jan-May only. Feb-Apr transactions contain fractional actuals/targets (0.53/0.45, 0.4101/0.45, 0.66/0.60), suggesting source-row or metric classification needs review. Treat displayed percentages as provisional.';
  if (name === 'MEDICARD PRD') return 'Jul 64.33% vs 70% target; Aug 45.75% vs 70% as of Aug 16. Both under target at source cutoff; August is not a completed month.';
  if (name.startsWith('MEDICARD ') && entries(c).length) return 'Latest monitoring is partial through Aug 16; percentages are attainment versus own target. No September-November records.';
  return 'No selected-period production surfaced by current dashboard sources. Confirm source upload, mapping and operational start date; absence is not confirmed zero output.';
}
let text = `# OpsView campaign performance audit — 2026\n\nAs of November 3, 2026 (Asia/Manila). Database snapshot: ${audit.generatedAt}.\n\n`;
text += 'This is a read-only review of all 37 active campaigns using the current checkout’s Collector Dashboard calculation, evaluated separately for January through November. Database records and the supplied PL workbook were read; no campaign data, target or import was changed during this audit. This is an offline calculation review, not a browser screenshot or proof that the deployed build is identical.\n\n';
text += `Latest import: PL YTD booked-volume workbook, November 3, 2026, 09:25 Philippine time. Latest substantive reporting month: September 2026. October MB ACQ entries are placeholders; November has no production. ${37-noData.length} campaigns have some reporting data, ${noData.length} have none in the reviewed dashboard sources. Coverage does not establish that an entire month or roster was imported.\n\n`;
text += '## Findings requiring action\n\n';
text += '1. Reconcile BPI PL April-August against the supplied YTD workbook. Keep September’s verified 98,232,998 unchanged. August’s 130,670,244 is present in the workbook but absent from normalized dashboard records. Differences may reflect revisions or incomplete historical imports; this audit does not decide which prior source should be replaced.\n';
text += '2. Verify BPI PA source-to-campaign labels. The existing history projection uses prior agent mappings; 146 entries are pending across January-September, including 20 September entries totaling 65,531,395.88. Their campaign cannot safely be inferred. Existing displayed PA figures are therefore provisional for attribution.\n';
text += '3. Obtain current source files: most campaigns stop in May-August. Do not classify absent September-November records as underperformance. Record campaign operational start dates before measuring January-onward completeness.\n';
text += '4. Validate metric units and targets: BDO early-month percentages use materially different target bases; MB PA has April-June missing dashboard goals; MB PL has fractional transaction fields; BDO CCC uses a maximum ACVT statistic rather than team production. September BPI PA OUTBOUND and PL use campaign default targets.\n';
text += '5. Preserve source cutoff dates in comparisons: BDO August monitoring stops at August 11 or 15, and Medicard at August 16. Compare like-for-like cutoffs or use verified final-month files before month-end rankings.\n\n';
text += 'No portfolio-wide production total or combined achievement percentage is reported: currency, unit counts, service rates and KPI scores have different meanings. No YTD average is used to hide missing months or target changes.\n\n';
text += '## Monthly data coverage\n\n| Reporting month | Campaigns with usable dashboard records | Of 37 | Important limitation |\n|---|---:|---:|---|\n';
for (const m of audit.months) {
  const n = m.campaigns.map(c=>({month:m.month,...c})).filter(hasData).length;
  text += `| ${monthNames[m.month-1]} | ${n} | ${(n/37*100).toFixed(1)}% | ${m.month===10?'MB ACQ placeholders excluded':m.month===11?'No production records':m.month===8?'Many source snapshots are mid-month':m.month===9?'Only BPI PA OUTBOUND and BPI PL':'Presence does not prove complete monthly data'} |\n`;
}
text += '\n## All campaigns: latest available performance\n\nAttainment below is what the current calculation produces, subject to the caveats. A later reporting month does not make other campaigns’ older data current.\n\n| Campaign | Latest report | Actual | Goal | Attainment | Coverage Jan-Sep | Review |\n|---|---|---:|---:|---:|---:|---|\n';
for (const c of audit.campaigns) {
  const rows = entries(c), last=rows.at(-1);
  const n = rows.filter(r=>r.month<=9).length;
  const rate=last?.kpiMetric==='percentage';
  const val=v=>rate?`${(v*100).toFixed(2)}%`:fmt(v);
  text += `| ${c.campaignName} | ${last?monthNames[last.month-1]+' 2026'+(partial(c.id,last.month)?' (partial)':''):'No records'} | ${last?val(last.production):'—'} | ${last&&last.goal!=null?val(last.goal):'—'} | ${last?pct(last.achievementPercent):'—'} | ${n}/9 | ${notes(c)} |\n`;
}
text += '\n## January-November attainment matrix\n\n`—` = no production records, not confirmed zero. `NG` = records but no valid dashboard goal. `*` = partial source cutoff. `P` = placeholder-only records. Displayed percentages reflect existing calculations and are not automatically validated rankings. BDO CCC is a maximum-ACVT statistic; MB PL, BDO early targets and PA attribution need the reviews described above.\n\n| Campaign | '+monthNames.join(' | ')+' |\n|---|'+monthNames.map(()=> '---:').join('|')+'|\n';
for(const c of audit.campaigns) {
  const cells = audit.months.map(m=>{const r=get(c.id,m.month); if(c.campaignName==='MB ACQ'&&m.month===10)return 'P'; if(!r.recordCount)return '—';return pct(r.achievementPercent)+(partial(c.id,m.month)?'*':'');});
  text += `| ${c.campaignName} | ${cells.join(' | ')} |\n`;
}
const supplied = 'C:/Users/Kevsz/Downloads/ALLIANZ_BPI PL_YTD BOOKED VOLUME REPORT.xlsx';
const workbook = XLSX.readFile(supplied), sheet=workbook.Sheets.Sheet1;
text += '\n## BPI PL reconciliation against supplied YTD workbook\n\nSource: ALLIANZ_BPI PL_YTD BOOKED VOLUME REPORT.xlsx, Sheet1, O6:Q14 and D136:L136. These are source monthly controls, not authorization to replace historical records. Positive difference means the supplied source exceeds the current dashboard.\n\n| Month | Dashboard booked volume | Supplied source total | Source minus dashboard | Result |\n|---|---:|---:|---:|---|\n';
const comparison=[];
for(let month=1;month<=9;month++) {
  const r=audit.months.find(m=>m.month===month).campaigns.find(c=>c.campaignName==='BPI PL');
  const source=sheet[`Q${month+5}`].v;
  const difference=source-r.production;
  comparison.push({month,dashboard:r.recordCount?r.production:null,source,difference:r.recordCount?difference:null});
  text += `| ${monthNames[month-1]} | ${r.recordCount?fmt(r.production):'No records'} | ${fmt(source)} | ${r.recordCount?fmt(difference):'Entire month missing'} | ${!r.recordCount?'Requires source import':difference===0?'Matches':'Requires reconciliation'} |\n`;
}
text += '\nSeptember’s 22 numeric agent rows (B4:B135, L4:L135) sum to 98,232,998, matching both L136 and Q14. Blank agent-month cells were not treated as zero; the September-only import preserved the original full workbook without importing other months.\n\n';
text += '## Monthly detail by campaign\n\nEach table reports the KPI/unit selected by the existing application. A label of volume does not imply pesos; source monitoring Units remain counts. Service-rate actuals/goals are shown as percentages. Target basis distinguishes a saved month-specific target from a source/default-derived target; it does not certify the business approval of either. Record counts are technical source counts, not uniform counts of agents or transactions.\n\n';
for(const c of audit.campaigns) {
  const rows=entries(c);
  text += `### ${c.campaignName}\n\n${notes(c)}\n\n`;
  if(!rows.length){text+='No usable production records January-November in the evaluated dashboard sources.\n\n';continue;}
  text += '| Month | KPI / source unit | Actual | Goal | Attainment | Target basis | Source cutoff | Records |\n|---|---|---:|---:|---:|---|---|---:|\n';
  for(const r of rows) {
    const s=sources.find(s=>s.campaignId===c.id&&s.reportMonth===r.month);
    const saved=audit.inventory.monthlyGoals.find(g=>g.campaignId===c.id&&g.month===r.month);
    const val=v=>v==null?'Unavailable':r.kpiMetric==='percentage'?`${(v*100).toFixed(2)}%`:fmt(v);
    const target=r.goal==null?'Missing':saved?'Saved monthly goal':s&&s.target>0?'Monitoring source':'Imported/default fallback';
    text += `| ${monthNames[r.month-1]} | ${r.kpiMetric}${s?.metricUnit?' / '+s.metricUnit:''} | ${val(r.production)} | ${val(r.goal)} | ${pct(r.achievementPercent)} | ${target} | ${s?.dateUpdated?s.dateUpdated.slice(0,10)+(partial(c.id,r.month)?' (partial)':''):'Not established by source metadata'} | ${r.recordCount} |\n`;
  }
  const missing=monthNames.slice(0,9).filter((_,index)=>!rows.some(r=>r.month===index+1));
  text+=`\nMissing January-September reporting months: ${missing.join(', ')||'None (presence only; monthly completeness not certified)'}.\n\n`;
}
text += '## Verification and scope\n\n- All 37 active campaigns evaluated for each of 11 months; 407 campaign-month calculations.\n- Read current ProductionDetail/ProductionEntry, ProductionMetricRecord, DashboardImportRecord, ProductionMonitoring, CollectorKpiRecord, campaign configuration, monthly goals and import metadata. DailySales contains no records.\n- No swallowed model-query failures occurred in the evaluation; all 11 monthly calculations returned all 37 campaigns. No latest-period fallback was substituted into a different selected month.\n- Original source workbooks for all campaigns were not re-opened in this audit. Other than the supplied PL workbook, values are verified against stored data and calculation code, not independently certified against every Excel source.\n- Most periods have no source completeness indicator. Source dateUpdated, database updatedAt, import completion date and reporting month represent different dates. A recent import timestamp is not evidence of current production for every campaign.\n- The audit changed no operational records. Historical replacements, new source imports, campaign attribution corrections and target changes require a specific source-backed repair preview.\n';
fs.writeFileSync(path.join(out,'performance-review.md'),text);
fs.writeFileSync(path.join(out,'audit-summary.json'),JSON.stringify({generatedAt:audit.generatedAt,campaignCount:37,withRecords:37-noData.length,withoutRecords:noData.map(c=>c.campaignName),latestSubstantivePeriod:'2026-09',plReconciliation:comparison},null,2));
assert.equal((text.match(/^### /gm)||[]).length,37);
console.log(JSON.stringify({report:path.join(out,'performance-review.md'),withData:37-noData.length,withoutData:noData.length,plReconciliation:comparison}));
