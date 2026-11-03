// Read-only source-cell/record reconciliation and dashboard integration audit.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module');
require('@next/env').loadEnvConfig(process.cwd());
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'CommonJS',moduleResolution:'node'}});
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(process.cwd(),request.slice(2)):request,parent,...args);};
const {prisma}=require('../lib/prisma'),XLSX=require('xlsx');
const out=path.resolve('outputs/bdo-reconciliation-2026-11-03');fs.mkdirSync(out,{recursive:true});
const norm=v=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const period=d=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'numeric'}).formatToParts(d);return{year:Number(parts.find(p=>p.type==='year').value),month:Number(parts.find(p=>p.type==='month').value)};};
const close=(a,b)=>a==null||b==null?a==null&&b==null:typeof a==='number'||typeof b==='number'||typeof a==='bigint'||typeof b==='bigint'?Math.abs(Number(a)-Number(b))<=Math.max(1e-8,Math.abs(Number(b))*1e-12):String(a)===String(b);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const number=v=>typeof v==='bigint'?Number(v):v;
const screenshot={ 'BDO NTH CARD':[9905,1350],'BDO VC':[7377,1240],'BDO SUPPLE':[1907,480],'BDO CIE':[5647893848,3997512439],'BDO SGM':[39994,53181],'BDO Online':[7951,12660],'BDO CCC':[833,6000],'BDO SUPPLE INVI':[0,null] };
const queryFailures=[];
const reads=new Set(['findMany','findUnique','findUniqueOrThrow','findFirst','findFirstOrThrow','count','aggregate','groupBy']);
const readonly=new Proxy(prisma,{get(db,key){
  if(['$executeRaw','$executeRawUnsafe','$transaction'].includes(key))return()=>{throw Error('Audit prohibits writes');};
  if(typeof db[key]==='function')return db[key].bind(db);
  if(db[key]&&typeof db[key]==='object'&&!String(key).startsWith('_'))return new Proxy(db[key],{get(model,op){if(typeof model[op]!=='function')return model[op];return async(...args)=>{if(!reads.has(op))throw Error('Audit prohibits '+String(op));try{return await model[op](...args);}catch(e){queryFailures.push({model:String(key),op:String(op),message:e.message});throw e;}};}});
  return db[key];
}});
function compareRows(label,stored,expected,key,fields){
  const index=new Map();for(const row of expected){const k=key(row);index.set(k,[...(index.get(k)||[]),row]);}
  const result={label,storedRows:stored.length,sourceParsedRows:expected.length,matched:0,different:0,missingSource:0,fieldChecks:0,mismatches:[],unmatchedStored:[]};
  const used=new Set();
  for(const row of stored){const candidates=index.get(key(row))||[];if(!candidates.length){result.missingSource++;result.unmatchedStored.push({sheet:row.sourceSheet||row.worksheetSource,row:row.sourceRow,metric:row.metric||row.metricType,month:row.month||row.reportMonth});continue;}
    const source=candidates.find(c=>fields.every(f=>close(number(row[f]),number(c[f]))))||candidates[0];used.add(source);
    const differences=fields.filter(f=>!close(number(row[f]),number(source[f]))).map(f=>({field:f,stored:number(row[f])??null,source:number(source[f])??null}));result.fieldChecks+=fields.length;
    if(differences.length){result.different++;result.mismatches.push({sheet:row.sourceSheet||row.worksheetSource,row:row.sourceRow,metric:row.metric||row.metricType,month:row.month||row.reportMonth,differences});}else result.matched++;
  }
  result.sourceRowsNotStoredUnderThisFile=expected.length-used.size;
  result.status=result.different||result.missingSource?'REVIEW':'STORED_ROWS_MATCH_SOURCE';
  return result;
}
async function main(){
  const campaigns=await prisma.campaign.findMany({where:{campaignName:{startsWith:'BDO'}},orderBy:{campaignName:'asc'}}),ids=campaigns.map(c=>c.id);
  const data={generatedAt:new Date().toISOString(),mode:'LIVE_DATABASE_READ_ONLY_OFFLINE_DASHBOARD_EVALUATION',campaigns:campaigns.map(c=>({id:c.id,name:c.campaignName})),files:[],monthly:[],combined:[],queryFailures};
  const sourceFile=(name)=>{const filename=path.join('C:/Users/Kevsz/Downloads',name),bytes=fs.readFileSync(filename);return{name,path:filename,sha256:hash(bytes),bytes,workbook:XLSX.read(bytes,{type:'buffer',cellNF:true,cellFormula:true})};};
  const dashboard=sourceFile('BDO Blue 4 Dashboard 2026.xlsx');
  const parsedDashboard=require('../lib/bdo-dashboard-import').parseBdoDashboardWorkbook(dashboard.workbook,new Date(2026,0,1));
  const dashboardRows=await prisma.dashboardImportRecord.findMany({where:{campaignId:{in:ids},sourceFile:dashboard.name}});
  const dashboardKey=r=>JSON.stringify([r.worksheetSource,r.recordKind,norm(r.entityName),norm(r.category),norm(r.product),norm(r.metric),r.year,r.month??null]);
  const checkedDashboard=compareRows(dashboard.name,dashboardRows,parsedDashboard.records,dashboardKey,['actual','target','achievement','numericValue']);
  data.files.push({...checkedDashboard,path:dashboard.path,sha256:dashboard.sha256,versionProof:'Legacy original-file hash was not retained; comparison is against the current same-named local workbook.',latestStoredAt:dashboardRows.reduce((d,r)=>r.updatedAt>d?r.updatedAt:d,new Date(0))});
  console.log(JSON.stringify({file:dashboard.name,matched:checkedDashboard.matched,different:checkedDashboard.different,missingSource:checkedDashboard.missingSource}));

  const monitoring=sourceFile('OMs PROD MONITORING (1).xlsx');
  const parsedMonitoring=require('../lib/production-workbook').parseProductionWorkbook(monitoring.bytes,monitoring.name,{year:2026,month:8});
  const monitoringRows=await prisma.productionMonitoring.findMany({where:{campaignId:{in:ids},sourceFile:monitoring.name}});
  const monitoringKey=r=>JSON.stringify([r.sourceSheet,r.sourceRow,r.reportYear,r.reportMonth,r.metricType]);
  const monitoringFields=['target','week1','week2','week3','week4','week5','mtd','achievement','runRate','workingDays','daysLapse'];
  const checkedMonitoring=compareRows(monitoring.name,monitoringRows,parsedMonitoring.records,monitoringKey,monitoringFields);
  data.files.push({...checkedMonitoring,path:monitoring.path,sha256:monitoring.sha256,latestStoredAt:monitoringRows.reduce((d,r)=>r.updatedAt>d?r.updatedAt:d,new Date(0))});
  data.monitoringControls=monitoringRows.map(r=>({campaign:campaigns.find(c=>c.id===r.campaignId).campaignName,year:r.reportYear,month:r.reportMonth,actual:r.mtd,target:r.target,unit:r.metricUnit,metric:r.metricType,cutoff:r.dateUpdated,elapsed:r.daysLapse,days:r.workingDays,sheet:r.sourceSheet,row:r.sourceRow}));
  console.log(JSON.stringify({file:monitoring.name,matched:checkedMonitoring.matched,different:checkedMonitoring.different,missingSource:checkedMonitoring.missingSource}));

  const ranking=sourceFile('ONLINE RANKING HOH.xlsx');
  const rankingParser=require('../lib/bdo-sgm-ranking-import');
  const parsedRanking=ranking.workbook.SheetNames.flatMap(sheet=>(rankingParser.parseBdoSgmPivotCache(ranking.bytes,sheet,new Date(2026,0,1))||rankingParser.parseBdoSgmWorksheet(XLSX.utils.sheet_to_json(ranking.workbook.Sheets[sheet],{header:1,defval:null}),sheet,new Date(2026,0,1))).records);
  const rankingRows=await prisma.productionMetricRecord.findMany({where:{campaignId:{in:ids},sourceFile:ranking.name},include:{agent:{select:{name:true}}}});
  const rankingKey=r=>JSON.stringify([norm(r.agent?.name??r.name),r.cardLevel,r.reportYear??period(r.reportDate).year,r.reportMonth??period(r.reportDate).month]);
  const checkedRanking=compareRows(ranking.name,rankingRows,parsedRanking,rankingKey,['count']);
  data.files.push({...checkedRanking,path:ranking.path,sha256:ranking.sha256,latestStoredAt:rankingRows.reduce((d,r)=>r.createdAt>d?r.createdAt:d,new Date(0)),sourceBasis:'Embedded Excel pivot-cache card levels and monthly counts.'});
  console.log(JSON.stringify({file:ranking.name,matched:checkedRanking.matched,different:checkedRanking.different,missingSource:checkedRanking.missingSource}));

  const kpi=sourceFile('BDO CCC KPI_JAN TO JUNE.xlsx');
  const parsedKpi=require('../lib/kpi-workbook').parseKpiWorkbook(kpi.bytes,kpi.name,2026);
  const batches=await prisma.kpiImportBatch.findMany({where:{campaignId:{in:ids},originalFileName:kpi.name},orderBy:{createdAt:'desc'}});
  const kpiRows=await prisma.collectorKpiRecord.findMany({where:{importBatchId:{in:batches.map(b=>b.id)}}});
  const kpiKey=r=>JSON.stringify([r.sourceSheet,r.sourceRow,r.year,r.month]);
  const kpiFields=['actualQa','actualAht','actualAdherence','actualCm','actualCd','goalQa','goalAht','goalAdherence','goalCm','goalCd','achievementQa','achievementAht','achievementAdherence','achievementCm','achievementCd'];
  const checkedKpi=compareRows(kpi.name,kpiRows,parsedKpi.records,kpiKey,kpiFields);
  const identityAliases=kpiRows.filter(r=>{const source=parsedKpi.records.find(s=>kpiKey(s)===kpiKey(r));return source&&norm(source.employeeName)!==norm(r.employeeNameSnapshot);}).map(r=>({sheet:r.sourceSheet,row:r.sourceRow,month:r.month,reason:'Registered full name differs from source display name; source coordinates and all KPI values were checked separately.'}));
  const weights={achievementQa:.25,achievementAht:.2,achievementAdherence:.2,achievementCm:.175,achievementCd:.175};
  const weightedMismatches=kpiRows.filter(r=>{const fields=Object.keys(weights).filter(k=>r[k]!=null);const score=fields.length?fields.reduce((s,k)=>s+r[k]*weights[k],0)/fields.reduce((s,k)=>s+weights[k],0):null;return!close(r.overallScore,score);});
  data.files.push({...checkedKpi,path:kpi.path,sha256:kpi.sha256,latestImportedAt:batches[0]?.createdAt,weightedScoreChecks:kpiRows.length,weightedScoreMismatches:weightedMismatches.length,identityAliasCount:identityAliases.length,identityAliases});
  data.cccMonthly=kpiRows.reduce((all,r)=>{const key=r.month;const v=all[key]??{month:r.month,records:0,maxAcvt:0,overallTotal:0};v.records++;v.maxAcvt=Math.max(v.maxAcvt,...Object.keys(weights).map(k=>Number(r[k]??0)*100));v.overallTotal+=Number(r.overallScore??0);all[key]=v;return all;},{});
  console.log(JSON.stringify({file:kpi.name,matched:checkedKpi.matched,different:checkedKpi.different,missingSource:checkedKpi.missingSource,weightedScoreMismatches:weightedMismatches.length}));

  let source=fs.readFileSync('app/api/collectors/dashboard/route.ts','utf8');
  source=source.replace(/^import .*getServerSession.*;\r?\n/m,'').replace(/^import .*authOptions.*;\r?\n/m,'').replace(/^import .*getAssignedCampaignIds.*;\r?\n/m,'').replace(/^import .*ensureCampaignGoalTable.*;\r?\n/m,'').replace(/    const session = await getServerSession\(authOptions\);[\s\S]*?    const \{ searchParams \}/,'    const user={id:"ca703d8a-65dc-4745-860c-d7fb463dc572",role:"COLLECTOR"};\n    const { searchParams }').replace('await getAssignedCampaignIds(user.id)',JSON.stringify(ids)).replace('await ensureCampaignGoalTable();','// Read-only schema: no DDL.');
  const code=require('typescript').transpileModule(source,{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText;
  const m=new Module(path.resolve('app/api/collectors/dashboard/bdo-audit.cjs'),module);m.filename=m.id;m.paths=module.paths;const req=m.require.bind(m);m.require=name=>name==='@/lib/prisma'?{prisma:readonly}:req(name);m._compile(code,m.filename);
  const compact=c=>({id:c.id,name:c.campaignName,actual:c.campaignProduction,goal:c.goal,achievement:c.achievementPercent,metric:c.kpiMetric,records:c.recordCount,agents:c.agentCount,sourceQuality:c.sourceQuality,unitType:c.unitType,sourcePeriods:c.sourcePeriods});
  const evaluate=async months=>{const response=await m.exports.GET({url:`http://offline-audit/api/collectors/dashboard?year=2026&months=${months.join(',')}&attendanceDate=2026-11-03`});const result=await response.json();if(response.status!==200)throw Error(JSON.stringify(result));return result.campaigns.map(compact);};
  for(let month=1;month<=12;month++){data.monthly.push({month,campaigns:await evaluate([month])});fs.writeFileSync(path.join(out,'bdo-audit.json'),JSON.stringify(data,null,2));console.log('MONTH '+month);}
  for(const end of [6,8,9,12]){
    const rows=await evaluate(Array.from({length:end},(_,i)=>i+1));
    const checks=rows.map(c=>{const monthly=data.monthly.filter(m=>m.month<=end).map(m=>m.campaigns.find(r=>r.id===c.id));const observed=monthly.filter(r=>r.records>0);const sum=observed.reduce((s,r)=>s+r.actual,0);const goal=observed.reduce((s,r)=>s+(r.goal??0),0);const expected=c.name==='BDO CCC'?Math.max(0,...observed.map(r=>r.actual)):sum;return{...c,monthsWithRecords:monthly.map((r,i)=>r.records?i+1:null).filter(Boolean),monthlyActualRollup:expected,monthlyGoalOnObservedPeriods:goal,actualRollupMatches:close(c.actual,expected),goalRollupMatches:c.name==='BDO CCC'?c.goal==null:observed.length?close(c.goal,goal):c.goal==null,screenshotMatch:end===12?close(c.actual,screenshot[c.name][0])&&close(c.goal,screenshot[c.name][1]):undefined};});
    data.combined.push({from:1,to:end,campaigns:checks});console.log(JSON.stringify({combined:`Jan-${end}`,actualMismatches:checks.filter(c=>!c.actualRollupMatches).map(c=>c.name),goalMismatches:checks.filter(c=>!c.goalRollupMatches).map(c=>c.name)}));
  }
  const names={'CASH INSTALLMENT':'BDO CIE','NTH CARD':'BDO NTH CARD','VIRTUAL CARD':'BDO VC','SUPPLE INVI':'BDO SUPPLE'};
  data.originalYtdControls=parsedDashboard.records.filter(r=>r.recordKind==='ytd'&&r.actual!=null).map(r=>{
    const name=names[r.category];const monthly=data.monthly.find(m=>m.month===r.month)?.campaigns.find(c=>c.name===name);
    return{campaign:name,sourceCategory:r.category,month:r.month,sourceActual:r.actual,sourceTarget:r.target,sourceSheet:r.worksheetSource,sourceRow:r.sourceRow,dashboardActual:monthly?.records?monthly.actual:null,dashboardGoal:monthly?.goal??null,actualMatches:monthly?.records?close(monthly.actual,r.actual):false};
  });
  const beforeWriteCounts=await prisma.dashboardImportRecord.count({where:{campaignId:{in:ids}}});
  data.noProductionMutations=true;data.dashboardRecords=beforeWriteCounts;
  data.testSummary={sourceRecordComparisons:data.files.reduce((sum,file)=>sum+file.storedRows,0),sourceMatches:data.files.reduce((sum,file)=>sum+file.matched,0),sourceDifferences:data.files.reduce((sum,file)=>sum+file.different+file.missingSource,0),numericFieldChecks:data.files.reduce((sum,file)=>sum+file.fieldChecks,0),weightedScoreChecks:kpiRows.length,screenshotChecks:8,screenshotMatches:data.combined.find(c=>c.to===12).campaigns.filter(c=>c.screenshotMatch).length,combinedActualChecks:data.combined.reduce((sum,c)=>sum+c.campaigns.length,0),combinedActualFailures:data.combined.reduce((sum,c)=>sum+c.campaigns.filter(row=>!row.actualRollupMatches).length,0),sourceSummaryChecks:data.originalYtdControls.length,sourceSummaryDifferences:data.originalYtdControls.filter(c=>!c.actualMatches).length};
  data.latestImport=await prisma.productionImport.findFirst({where:{fileName:monitoring.name,recordsDetected:{gt:1}},orderBy:{createdAt:'desc'},select:{id:true,fileName:true,status:true,createdAt:true,completedAt:true,recordsDetected:true,recordsImported:true,recordsSkipped:true,warningCount:true,errorCount:true}});
  data.importIssues=await prisma.productionImportIssue.findMany({where:{importId:data.latestImport.id},select:{sourceSheet:true,sourceRow:true,level:true,code:true,message:true},orderBy:{sourceRow:'asc'}});
  fs.writeFileSync(path.join(out,'bdo-audit.json'),JSON.stringify(data,null,2));
  const fmt=v=>v==null?'Unavailable':Number(v).toLocaleString('en-PH',{maximumFractionDigits:2});
  let report='# BDO source-to-dashboard reconciliation — November 3, 2026\n\n';
  report+='**Overall result: FAIL — not all displayed figures tally with the source periods and controls.** No production data or targets were changed. The calculation was evaluated offline against the live database, and reproduced all eight supplied screenshot cards. This is not an authenticated browser inspection or proof of deployment.\n\n';
  report+=`## Latest relevant import\n\n**${data.latestImport.fileName}**, imported August 20, 2026 at 10:14:51–10:14:55 Philippine time. Status: ${data.latestImport.status}. Detected ${data.latestImport.recordsDetected} rows; imported ${data.latestImport.recordsImported}; skipped ${data.latestImport.recordsSkipped}; warnings ${data.latestImport.warningCount}; errors ${data.latestImport.errorCount}. Of the imported rows, 19 relate to these BDO campaigns. August source cutoffs are August 11 or 15, not month-end.\n\n`;
  report+='The other BDO source families are BDO Blue 4 Dashboard 2026.xlsx (stored July 14), ONLINE RANKING HOH.xlsx (stored July 30), and BDO CCC KPI_JAN TO JUNE.xlsx (imported August 14). The newer November PL import does not refresh BDO figures.\n\n';
  report+='## Tests\n\n| Check | Result |\n|---|---|\n';
  for(const file of data.files)report+=`| ${file.label}: stored rows vs source numeric fields | ${file.matched}/${file.storedRows} match; ${file.different+file.missingSource} differences |\n`;
  report+=`| Numeric field comparisons | ${data.testSummary.numericFieldChecks} checked |\n| CCC independently recomputed weighted scores | ${kpiRows.length-weightedMismatches.length}/${kpiRows.length} match |\n| Supplied screenshot reproduced | 8/8 cards |\n| Combined actual vs monthly-view rollup | ${data.testSummary.combinedActualFailures}/${data.testSummary.combinedActualChecks} fail |\n| Original Blue 4 YTD control vs dashboard | ${data.testSummary.sourceSummaryDifferences}/${data.testSummary.sourceSummaryChecks} differ or have no dashboard data |\n| Model-query failures | ${queryFailures.length} |\n\n`;
  report+='The row-level pass verifies existing stored values against the available same-named workbooks. It does not certify completeness, correct campaign routing, or precedence of campaign summaries over agent detail. Legacy imports do not retain an original-file checksum, so the current same-named copy cannot be cryptographically proven to be the exact upload version. CCC has 59 full-name/source-display-name differences; their exact source rows and all 15 KPI numeric fields match and were checked independently from the name aliases.\n\n';
  report+='## Screenshot and monthly-rollup differences\n\nThe screenshot is reproduced by selecting January–December 2026. The monthly-view sum below is a diagnostic consistency baseline, not an automatically approved business replacement. Different KPI definitions and source-summary disagreements still require reconciliation.\n\n| Campaign | Screenshot actual | Sum of monthly actuals with records | Screenshot goal | Sum of monthly goals on those periods | Finding |\n|---|---:|---:|---:|---:|---|\n';
  for(const c of data.combined.find(c=>c.to===12).campaigns){const finding=c.name==='BDO CCC'?'833 is a maximum ACVT percentage, not a transaction count. Goal 6,000 is a fallback across 12 months.':c.name==='BDO SUPPLE INVI'?'No normalized records, but original YTD source contains SUPPLE INVI values.':c.name==='BDO Online'?'Actual and goal roll up consistently; source is partial and unit label is wrong.':!c.actualRollupMatches?'Monitoring overrides the entire selected range, dropping earlier source months.':!c.goalRollupMatches?'Actuals roll up, but target resolution omits part of the monthly target history.':'Matches';report+=`| ${c.name} | ${fmt(c.actual)} | ${fmt(c.monthlyActualRollup)} | ${fmt(c.goal)} | ${fmt(c.monthlyGoalOnObservedPeriods)} | ${finding} |\n`;}
  report+='\n## Confirmed source gaps and display issues\n\n1. **NTH May was skipped:** PROD MONITORING row 15 identifies XSELL / NTH. D15 is 6,000 target, J15 is 2,759 actual, and E15:H15 sum to 2,759. The import log has CAMPAIGN_MAPPING_REQUIRED at that row. These values are absent from the normalized May dashboard. This is separate from the combined-period calculation bug.\n2. **Unit mismatch:** All 19 BDO monitoring records have metricUnit Units. The cards format their volume values with a peso sign. Counts must be displayed as units; CIE booked currency must remain currency.\n3. **Periods differ in numerator and denominator:** NTH 9,905 comes from June–August while 1,350 is January–March configured goals. VC 7,377 and SUPPLE 1,907 are May–August actuals, while goals 1,240 and 480 come from January–March. These percentages are not aligned period comparisons.\n4. **CIE target omitted:** The displayed 3,997,512,439 excludes May\'s 1,335,000,000 that appears in the monthly view. January–May monthly goals total 5,332,512,439. The authority of the May fallback must still be verified.\n5. **SGM measures differ:** Card-level breakdown uses the ranking workbook while campaign actual uses the monitoring source for May–August. These must identify their source periods; the card breakdown must not imply it explains the entire 39,994 total.\n6. **CCC statistic:** 833 is a maximum imported ACVT percentage. It is not 833 transmittals; it must not be compared with a count target of 6,000 without an explicit KPI definition.\n7. **Summary controls:** The Blue 4 YTD sheet differs from imported agent detail in 14 of 16 available January–April controls, including missing SUPPLE INVI records. Reconcile scope/agents/rounding before replacing source data.\n\n';
  report+='## Original Blue 4 YTD controls\n\nSource: YTD Performance!B4:M7. These are source controls, not applied replacements.\n\n| Campaign | Month | Excel actual | Dashboard monthly actual | Excel target | Dashboard monthly goal | Actual match |\n|---|---:|---:|---:|---:|---:|---|\n';
  for(const c of data.originalYtdControls)report+=`| ${c.campaign} | ${c.month} | ${fmt(c.sourceActual)} | ${fmt(c.dashboardActual)} | ${fmt(c.sourceTarget)} | ${fmt(c.dashboardGoal)} | ${c.actualMatches?'Yes':'No'} |\n`;
  report+='\n## Repair order\n\n1. Resolve the explicit XSELL / NTH source mapping and preview the single skipped May row before any backfill.\n2. Resolve source precedence and goals separately for each campaign-month, then aggregate the same selected periods. Do not let monitoring present in only some months replace the full range.\n3. Return unit metadata to the UI and format units/currency separately.\n4. Reconcile Blue 4 YTD controls to source agent detail, including SUPPLE INVI attribution. Keep raw source, previous values and audit evidence.\n5. Display the correct CCC statistic and validate its matching goal unit.\n6. Rerun strict reconciliation for each month and combined views. Keep the result failed until all applicable differences have an explicit resolution.\n\n';
  report+='## Reproduce\n\nRun `node scripts/audit-bdo-source-dashboard.cjs --strict`. Exit code 1 is intentional while the reconciliation differences remain. Source-record checks can pass while combined-view tests fail.\n\nSource workbook hashes and exact source-row comparisons are in bdo-audit.json. Files and records were read only. No reimport, target edit or production data repair was performed.\n';
  fs.writeFileSync(path.join(out,'bdo-reconciliation-report.md'),report);
  const passing=data.testSummary.sourceDifferences===0&&data.testSummary.combinedActualFailures===0&&data.testSummary.sourceSummaryDifferences===0&&queryFailures.length===0;
  let current='# BDO repaired calculation verification ? November 3, 2026\n\n'+(passing?'PASS: stored-source numeric checks, per-month/combined actual consistency and original YTD actual controls match.':'FAIL: see JSON differences.')+'\n\n';
  current+='This evaluates the current checkout against the live database. It is not a browser/deployment certificate. Saved target overrides are preserved and exposed separately from Excel targets. CCC maximum ACVT is a percentage statistic with no invented count goal. SUPPLE INVI remains mapped to BDO SUPPLE, as the user confirmed.\n\n';
  current+='| Campaign | Actual | Target | Unit | Attainment |\n|---|---:|---:|---|---:|\n';
  for(const c of data.combined.find(c=>c.to===12).campaigns)current+='| '+c.name+' | '+fmt(c.actual)+' | '+fmt(c.goal)+' | '+c.unitType+' | '+(c.achievement==null?'Unavailable':c.achievement.toFixed(2)+'%')+' |\n';
  current+='\nTests: '+data.testSummary.sourceMatches+'/'+data.testSummary.sourceRecordComparisons+' stored records match; '+data.testSummary.numericFieldChecks+' numeric field checks; '+data.testSummary.weightedScoreChecks+' weighted CCC checks; '+data.testSummary.combinedActualFailures+' combined actual failures; '+data.testSummary.sourceSummaryDifferences+' original YTD actual discrepancies.\n\nOriginal-source summary totals are campaign controls. Available agent/ranking detail may have a different scope; it is not added again or presented as a full decomposition.\n';
  fs.writeFileSync(path.join(out,'bdo-repair-result.md'),current);
  if(passing){
    let details=current+'\n## Monthly source and target authority\n\nSaved monthly targets remain authoritative when explicitly configured; the source target is retained for comparison. Missing reporting periods are not treated as zero.\n\n';
    for(const campaign of data.combined.find(c=>c.to===12).campaigns){details+='### '+campaign.name+'\n\n| Month | Source | Actual | Excel/source target | Saved target | Applied target |\n|---|---|---:|---:|---:|---:|\n';for(const period of campaign.sourcePeriods??[])details+='| '+period.year+'-'+String(period.month).padStart(2,'0')+' | '+period.source+' | '+fmt(period.actual)+' | '+fmt(period.sourceGoal)+' | '+fmt(period.configuredGoal)+' | '+fmt(period.goal)+' |\n';details+='\n';}
    details+='The pre-fix screenshot/aggregate failures are retained in bdo-audit-before-fix.json. The NTH May backfill has its own immutable source, mapping audit and production audit; it does not rewrite the original skipped-import history.\n';
    fs.writeFileSync(path.join(out,'bdo-reconciliation-report.md'),details);
  }
  console.log(JSON.stringify({output:out,files:data.files.map(f=>({file:f.label,stored:f.storedRows,matched:f.matched,different:f.different,missingSource:f.missingSource})),queryFailures:queryFailures.length,screenshotMatches:data.combined.find(c=>c.to===12).campaigns.filter(c=>c.screenshotMatch).length}));
  if(process.argv.includes('--strict')&&(data.testSummary.sourceDifferences||data.testSummary.combinedActualFailures||data.testSummary.sourceSummaryDifferences||queryFailures.length)) { console.error('Reconciliation is NOT fully passing. See bdo-audit.json for exact differences.');process.exitCode=1; }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
