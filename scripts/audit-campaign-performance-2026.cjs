// Read-only offline evaluation of the existing dashboard calculation.
// No HTTP login/session is created and no production route is changed.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert/strict');
require('@next/env').loadEnvConfig(process.cwd());
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(process.cwd(), request.slice(2)) : request, parent, ...args);
};
const { prisma } = require('../lib/prisma');
const simulation = process.argv.includes('--simulate-pl');
const output = path.join(process.env.TEMP, simulation ? 'opsview-performance-simulation-2026' : 'opsview-performance-audit-2026');
fs.mkdirSync(output, { recursive: true });
const clean = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));
const readOperations = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
const failures = [];
const simulatedRows = [];
if (simulation) {
  const preview = JSON.parse(fs.readFileSync(path.join(process.env.TEMP, 'opsview-pl-history-reconciliation-2026/preview.json')));
  for (const period of preview.periods) {
    const common = { campaignId:'262f60f1-9268-4722-be9c-7e84920383aa', worksheetSource:'Sheet1', category:'Personal Loans', product:'Volume', metric:'Booked Volume', year:2026,month:period.month,reportDate:new Date(Date.UTC(2026,period.month-1,1)),updatedAt:new Date(),target:null,achievement:null,level:null };
    simulatedRows.push(...period.agents.map(a=>({...common,recordKind:'agent_monitoring',monitoringType:'PL_SOURCE_BOOKED_AGENT',entityName:a.name,actual:a.actual,target:a.target,remark:null})),{...common,recordKind:'ytd',monitoringType:'PL_SOURCE_TOTAL',entityName:'BPI PL source control',actual:period.total,remark:JSON.stringify({unattributedActual:period.unattributedTotal})});
  }
}
const readonly = new Proxy(prisma, { get(target, key) {
  if (['$executeRaw', '$executeRawUnsafe', '$transaction'].includes(key)) return () => { throw new Error(`Audit forbids ${key}`); };
  if (typeof target[key] === 'function') return target[key].bind(target);
  if (target[key] && typeof target[key] === 'object' && !String(key).startsWith('_')) return new Proxy(target[key], { get(model, op) {
    if (typeof model[op] !== 'function') return model[op];
    return async (...args) => {
      assert(readOperations.has(op), `Audit forbids ${String(key)}.${String(op)}`);
      try { const result = await model[op](...args); return simulation && key === 'dashboardImportRecord' && op === 'findMany' ? [...result,...simulatedRows] : result; } catch (error) { failures.push({ model: key, operation: op, message: error.message }); throw error; }
    };
  } });
  return target[key];
} });
async function main() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { campaignName: 'asc' } });
  const allIds = campaigns.map(c => c.id);
  const actor = await prisma.user.findFirstOrThrow({ where: { name: 'Timothy Germedia', role: 'COLLECTOR' }, select: { id: true } });
  let source = fs.readFileSync(path.join(process.cwd(), 'app/api/collectors/dashboard/route.ts'), 'utf8');
  source = source.replace(/^import .*getServerSession.*;\r?\n/m, '')
    .replace(/^import .*authOptions.*;\r?\n/m, '')
    .replace(/^import .*getAssignedCampaignIds.*;\r?\n/m, '')
    .replace(/^import .*ensureCampaignGoalTable.*;\r?\n/m, '')
    .replace(/    const session = await getServerSession\(authOptions\);[\s\S]*?    const \{ searchParams \}/, `    const user = { id: ${JSON.stringify(actor.id)}, role: 'COLLECTOR' };\n    const { searchParams }`)
    .replace('await getAssignedCampaignIds(user.id)', JSON.stringify(allIds))
    .replace('await ensureCampaignGoalTable();', '// Read-only audit: schema already exists.');
  assert(!source.includes('getServerSession'));
  const code = require('typescript').transpileModule(source, { compilerOptions: { module: 1, target: 9, esModuleInterop: true } }).outputText;
  const auditModule = new Module(path.join(process.cwd(), 'app/api/collectors/dashboard/offline-audit.cjs'), module);
  auditModule.filename = auditModule.id;
  auditModule.paths = module.paths;
  const originalRequire = auditModule.require.bind(auditModule);
  auditModule.require = request => request === '@/lib/prisma' ? { prisma: readonly } : originalRequire(request);
  auditModule._compile(code, auditModule.filename);
  const inventory = {};
  for (const [model, fields] of Object.entries({ dashboardImportRecord: ['campaignId','year','month'], productionMonitoring: ['campaignId','reportYear','reportMonth'], productionMetricRecord: ['campaignId','reportYear','reportMonth'], collectorKpiRecord: ['campaignId','year','month'] })) {
    try { inventory[model] = clean(await prisma[model].groupBy({ by: fields, _count: true })); }
    catch(error) { inventory[model] = { error: error.message }; }
  }
  inventory.productionEntry = clean(await prisma.productionEntry.findMany({ select: { campaignId: true, date: true, importFileName: true, reportPeriodType: true } }));
  inventory.monthlyGoals = clean(await prisma.campaignGoal.findMany({ where: { year: 2026 }, orderBy: [{ campaignId: 'asc' }, { month: 'asc' }] }));
  inventory.monitoringSources = clean(await prisma.productionMonitoring.findMany({ where: { reportYear: 2026 }, select: { campaignId: true, reportMonth: true, metricType: true, metricUnit: true, target: true, mtd: true, workingDays: true, daysLapse: true, dateUpdated: true, sourceFile: true, sourceSheet: true, sourceRow: true, updatedAt: true } }));
  inventory.octoberAcqMetrics = clean(await prisma.productionMetricRecord.findMany({ where: { campaign: { campaignName: 'MB ACQ' }, reportYear: 2026, reportMonth: 10 }, select: { metricType: true, count: true, actual: true, goal: true, achievement: true, sourceFile: true, createdAt: true } }));
  inventory.dailySalesByCampaign = clean(await prisma.dailySales.groupBy({ by: ['campaignId'], _count: true, _min: { date: true }, _max: { date: true } }));
  inventory.latestImports = clean(await prisma.productionImport.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, fileName: true, status: true, createdAt: true, completedAt: true, pendingCount: true, recordsImported: true, inspection: true } }));
  inventory.latestDashboardBatches = clean(await prisma.dashboardImportBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, fileName: true, status: true, createdAt: true, completedAt: true, campaignId: true } }));
  const snapshot = { generatedAt: new Date().toISOString(), mode:simulation?'SIMULATION':'LIVE_READ_ONLY', year: 2026, campaigns: clean(campaigns), inventory, months: [], failures };
  for (let month = 1; month <= 11; month++) {
    const response = await auditModule.exports.GET({ url: `http://offline-audit/api/collectors/dashboard?year=2026&months=${month}&attendanceDate=2026-11-03` });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.campaigns.length, campaigns.length);
    const rows = data.campaigns.map(c => ({ id: c.id, campaignName: c.campaignName, kpiMetric: c.kpiMetric, goal: c.goal, actual: c.actual, production: c.campaignProduction, achievementPercent: c.achievementPercent, goalStatus: c.goalStatus, dataStatus: c.dataStatus, agentCount: c.agentCount, recordCount: c.recordCount, lastUpdated: c.lastUpdated, dataPeriod: c.dataPeriod, agentDataPeriod: c.agentDataPeriod, mbPlTotals: c.mbPlTotals, sourceQuality:c.sourceQuality }));
    if (simulation && month>=4 && month<=8) assert.equal(rows.find(c=>c.campaignName==='BPI PL').production,JSON.parse(fs.readFileSync(path.join(process.env.TEMP,'opsview-pl-history-reconciliation-2026/preview.json'))).periods.find(r=>r.month===month).total);
    snapshot.months.push({ month, availability: data.availability, campaigns: rows });
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify({ month, withRecords: rows.filter(c => c.recordCount > 0).length, withPositiveProduction: rows.filter(c => c.recordCount > 0 && c.production > 0).length, missingGoal: rows.filter(c => c.recordCount > 0 && c.goalStatus === 'missing').length, fallbacks: rows.filter(c => c.dataPeriod?.source === 'latest_import').map(c => c.campaignName), queryFailures: failures.length }));
  }
  if (simulation) {
    const response = await auditModule.exports.GET({url:'http://offline-audit/api/collectors/dashboard?year=2026&months=1,2,3,4,5,6,7,8,9&attendanceDate=2026-11-03'});
    const data = await response.json();assert.equal(response.status,200);
    const pl=data.campaigns.find(c=>c.campaignName==='BPI PL');assert.equal(pl.campaignProduction,2126885227);
    console.log(JSON.stringify({simulation:true,janSepPl:pl.campaignProduction,sourceTotal:2126885227}));
  }
  console.log(JSON.stringify({ output, campaigns: campaigns.length, queryFailures: failures.length }));
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(() => prisma.$disconnect());
