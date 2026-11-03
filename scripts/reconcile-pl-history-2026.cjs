// Explicit source-backed April-August reconciliation. Preview is the default.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert/strict');
require('@next/env').loadEnvConfig(process.cwd());
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const { parseFile } = require('../lib/smart-import/parser');
const { compressRawRow, unpackRawRow } = require('../lib/smart-import/raw-storage');
const { reconcile } = require('../lib/smart-import/reconciliation');
const p = new PrismaClient({ log: [] });
const campaignId = '262f60f1-9268-4722-be9c-7e84920383aa';
const actorId = 'ca703d8a-65dc-4745-860c-d7fb463dc572';
const fileHash = '2b1ce722cea10fe6fd34ee7b1de16991cc86ae58b3fbf49a2ae6296511a4a91e';
const operation = 'PL_APR_AUG_SOURCE_RECONCILIATION_20261103';
const output = path.join(process.env.TEMP, 'opsview-pl-history-reconciliation-2026');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const json = value => JSON.parse(JSON.stringify(value));
async function requireProductionRelease() {
  const release = process.argv.find(value=>value.startsWith('--release='))?.slice(10);
  assert(release && /^[0-9a-f]{40}$/.test(release), 'Pass --release=<full deployed commit SHA>; never apply against the old production reader');
  const {execFileSync}=require('child_process');
  let token;
  try { const credential=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe']}); token=credential.split('\n').find(line=>line.startsWith('password='))?.slice(9); } catch { /* Public repository reads can work without a credential. */ }
  const headers={'User-Agent':'OpsView-source-reconciliation',Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})};
  const response=await fetch(`https://api.github.com/repos/bdocrm/opspulse/commits/${release}/status`,{headers});
  assert(response.ok,'Cannot verify production release');
  const status=await response.json();
  assert(status.statuses.some(row=>row.context==='Vercel'&&row.state==='success'),'Vercel release has not succeeded. Source reconciliation is blocked to prevent double counting.');
}
const nameKey = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
async function existingState(db) {
  return {
    records: await db.dashboardImportRecord.findMany({ orderBy: { id: 'asc' } }),
    goals: await db.campaignGoal.findMany({ orderBy: { id: 'asc' } }),
    campaigns: await db.campaign.findMany({ orderBy: { id: 'asc' } }),
  };
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const source = process.argv[2], bytes = fs.readFileSync(source), fileName = path.basename(source);
  assert.equal(hash(bytes), fileHash, 'Source workbook differs from reviewed file');
  const workbook = XLSX.read(bytes, { type: 'buffer' }), sheet = workbook.Sheets.Sheet1;
  assert.equal(sheet.B3.v, 'AGENT NAME'); assert.match(sheet.C3.v,/2026/);
  const campaign = await p.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  assert.equal(campaign.campaignName, 'BPI PL'); assert(campaign.isActive);
  const actor = await p.user.findUniqueOrThrow({ where: { id: actorId }, include: { campaignAssignments: true } });
  assert.equal(actor.role, 'COLLECTOR'); assert(actor.campaignAssignments.some(a => a.campaignId === campaignId));
  const before = await existingState(p);
  const periods = [];
  for (let month = 4; month <= 8; month++) {
    const column = XLSX.utils.encode_col(month + 2);
    const total = sheet[`${column}136`].v;
    assert.equal(total, sheet[`Q${month + 5}`].v);
    const agents = [], unattributed = [];
    for (let row = 4; row < 136; row++) {
      const cell = sheet[`${column}${row}`], name = sheet[`B${row}`]?.v;
      if (!cell || cell.v == null || cell.v === '') continue;
      assert.equal(cell.t, 'n', `Invalid ${column}${row}`);
      const entry = { name: typeof name === 'string' ? name : '', sourceRow: row, actual: cell.v, sourceCell: `${column}${row}` };
      if (!name || /^#|^\(blank\)$/i.test(name)) unattributed.push(entry);
      else { assert(!/^total|grand total|summary$/i.test(name)); agents.push(entry); }
    }
    assert.equal(new Set(agents.map(r => nameKey(r.name))).size, agents.length);
    assert.equal([...agents, ...unattributed].reduce((s,r)=>s+r.actual,0), total);
    const legacy = before.records.filter(r=>r.campaignId===campaignId&&r.year===2026&&r.month===month);
    const preview = agents.map(r=>{
      const prior = legacy.filter(e=>nameKey(e.entityName)===nameKey(r.name)&&/^booked volume$/i.test(e.metric));
      const targets = [...new Set(prior.map(e=>e.target).filter(v=>v>0))];
      return { ...r, target: targets.length===1?targets[0]:null, previousRows: prior.map(e=>({id:e.id,actual:e.actual,target:e.target,worksheet:e.worksheetSource})), changed: !prior.some(e=>e.actual===r.actual) };
    });
    periods.push({ month, column, total, agentTotal: agents.reduce((s,r)=>s+r.actual,0), unattributedTotal: unattributed.reduce((s,r)=>s+r.actual,0), agents: preview, unattributed, legacyRowsRetained: legacy.length });
  }
  const marker = await p.productionImportIssue.findFirst({ where: { code: operation }, select: { importId: true } });
  if (marker) {
    const batch = await p.productionImport.findUniqueOrThrow({ where: { id: marker.importId }, select: { originalFile: true, inspection: true } });
    assert.equal(hash(batch.originalFile), fileHash);
    const raw = await p.productionImportRawRow.findMany({ where: { importId: marker.importId } });
    assert(reconcile(batch.inspection, raw.map(r=>unpackRawRow(r.rawPayload))).passed);
    for (const period of periods) {
      const records = before.records.filter(r=>r.campaignId===campaignId&&r.year===2026&&r.month===period.month&&r.monitoringType==='PL_SOURCE_BOOKED_AGENT');
      assert.equal(records.length,period.agents.length);
      for (const agent of period.agents) assert(records.some(r=>r.entityName===agent.name&&r.actual===agent.actual&&r.sourceRow===agent.sourceRow));
      const totals = before.records.filter(r=>r.campaignId===campaignId&&r.year===2026&&r.month===period.month&&r.monitoringType==='PL_SOURCE_TOTAL');
      assert.equal(totals.length,1);assert.equal(totals[0].actual,period.total);
    }
    const backup = JSON.parse(fs.readFileSync(path.join(output,'before.json')));
    assert.equal(hash(before.records.filter(r=>backup.recordIds.includes(r.id))),backup.recordsHash);
    assert.equal(hash(before.goals),backup.goalsHash);assert.equal(hash(before.campaigns),backup.campaignsHash);
    console.log(JSON.stringify({status:'VERIFIED_NO_CHANGES',importId:marker.importId,months:periods.map(r=>({month:r.month,total:r.total,agents:r.agents.length,unattributed:r.unattributedTotal})),legacyRecordsUnchanged:backup.recordIds.length}));return;
  }
  assert.equal(await p.dashboardImportRecord.count({where:{campaignId,monitoringType:{in:['PL_SOURCE_BOOKED_AGENT','PL_SOURCE_TOTAL']}}}),0);
  const preview = {operation,fileHash,periods,beforeHash:hash(before),newRows:periods.reduce((s,r)=>s+r.agents.length+1,0),legacyRowsRetained:before.records.length,goalsUnchanged:before.goals.length};
  if(process.argv.includes('--snapshot')) fs.writeFileSync(path.join(output,'reviewed-backup.json'),JSON.stringify({...before,createdAt:new Date(),beforeHash:hash(before)}));
  fs.writeFileSync(path.join(output,'preview.json'),JSON.stringify(preview,null,2));
  console.log(JSON.stringify({...preview,periods:periods.map(r=>({month:r.month,total:r.total,agents:r.agents.length,unattributed:r.unattributedTotal,legacyRowsRetained:r.legacyRowsRetained,changedAgents:r.agents.filter(a=>a.changed).length})),mode:process.argv.includes('--apply')?'APPLY':'PREVIEW',output}));
  if(!process.argv.includes('--apply'))return;
  const expected=process.argv.find(s=>s.startsWith('--expected='))?.slice(11);
  assert.equal(expected,hash(before),'Live data differs from approved preview; run preview and review again');
  await requireProductionRelease();
  const backup={...before,recordIds:before.records.map(r=>r.id),recordsHash:hash(before.records),goalsHash:hash(before.goals),campaignsHash:hash(before.campaigns)};
  fs.writeFileSync(path.join(output,'before.json'),JSON.stringify(backup));
  const parsed=parseFile(bytes,fileName,'xlsx');assert(reconcile(parsed.inspection,parsed.rows).passed);
  const result=await p.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`WORKBOOK_DASHBOARD:${campaignId}`}, 0))::text`;
    assert.equal(hash(await existingState(tx)),hash(before),'Data changed after backup');
    const currentActor=await tx.user.findUniqueOrThrow({where:{id:actorId},include:{campaignAssignments:true}});
    assert.equal(currentActor.role,'COLLECTOR');assert(currentActor.campaignAssignments.some(a=>a.campaignId===campaignId));
    const now=new Date();
    const imported=await tx.productionImport.create({data:{fileName,fileHash,fileType:'xlsx',originalFile:bytes,engine:'SOURCE_RECONCILIATION',status:'COMPLETED_WITH_WARNINGS',importedById:actorId,reportingPeriods:periods.map(r=>`2026-${String(r.month).padStart(2,'0')}`),recordsDetected:preview.newRows,recordsImported:preview.newRows,pendingCount:periods.reduce((s,r)=>s+r.unattributed.length,0),warningCount:periods.filter(r=>r.unattributed.length).length,confirmedAt:now,completedAt:now,inspection:json({...parsed.inspection,metadata:{...parsed.inspection.metadata,operation,canonicalPeriodSnapshot:true,unattributed:periods.map(r=>({month:r.month,actual:r.unattributedTotal,sourceRows:r.unattributed.map(a=>a.sourceRow)}))}})}});
    await tx.productionImportRawRow.createMany({data:parsed.rows.map(r=>({importId:imported.id,sourceSheet:r.sourceSheet,sourceRow:r.sourceRow,rawPayload:compressRawRow(r)}))});
    for(const period of periods){
      const reportDate=new Date(Date.UTC(2026,period.month-1,1));
      const batch=await tx.dashboardImportBatch.create({data:{campaignId,fileName,importMode:'VERIFIED_SOURCE_RECONCILIATION',duplicateMode:'supersede-read-preserve-history',reportPeriodType:'monthly',reportDate,workbookYear:2026,totalWorksheets:1,supportedSheets:1,selectedCampaignIds:JSON.stringify([campaignId]),detectedWorksheets:'["Sheet1"]',insertedCount:period.agents.length+1,unmappedCount:period.unattributed.length,importedById:actorId,status:period.unattributed.length?'COMPLETED_WITH_WARNINGS':'COMPLETED',completedAt:now}});
      const common={batchId:batch.id,campaignId,worksheetSource:'Sheet1',category:'Personal Loans',product:'Volume',metric:'Booked Volume',month:period.month,year:2026,reportPeriodType:'monthly',reportDate,sourceFile:fileName,importedById:actorId};
      await tx.dashboardImportRecord.createMany({data:[...period.agents.map(a=>({...common,sourceRow:a.sourceRow,recordKind:'agent_monitoring',monitoringType:'PL_SOURCE_BOOKED_AGENT',entityName:a.name,actual:a.actual,target:a.target,remark:JSON.stringify({operation,importId:imported.id,fileHash,sourceCell:a.sourceCell,previousRows:a.previousRows})})),{...common,sourceRow:136,recordKind:'ytd',monitoringType:'PL_SOURCE_TOTAL',entityName:'BPI PL source control',actual:period.total,dataStatus:period.unattributed.length?'UNATTRIBUTED_AMOUNT':'VERIFIED',remark:JSON.stringify({operation,importId:imported.id,fileHash,sourceCell:`${period.column}136`,unattributedActual:period.unattributedTotal,unattributed:period.unattributed})}]});
    }
    await tx.productionImportIssue.create({data:{importId:imported.id,level:'INFO',code:operation,message:'User-authorized April-August reconciliation to supplied YTD source; all legacy records and targets preserved. Unidentified source amounts remain campaign-only.',rawData:json({actorId,operation,fileHash,periods:periods.map(r=>({month:r.month,total:r.total,agentTotal:r.agentTotal,unattributedTotal:r.unattributedTotal})),beforeHash:hash(before)})}});
    const unchanged=await tx.dashboardImportRecord.findMany({where:{id:{in:backup.recordIds}},orderBy:{id:'asc'}});assert.equal(hash(unchanged),backup.recordsHash);
    return {importId:imported.id};
  },{timeout:30000,isolationLevel:'Serializable'});
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({...result,operation,periods:periods.map(r=>({month:r.month,total:r.total,agentTotal:r.agentTotal,unattributed:r.unattributedTotal}))},null,2));
  console.log(JSON.stringify({status:'APPLIED',...result,newRows:preview.newRows,legacyRecordsUnchanged:before.records.length}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
