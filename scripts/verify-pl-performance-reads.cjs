// Offline read-only integration evaluation; no HTTP session is issued.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert/strict');
require('@next/env').loadEnvConfig(process.cwd());
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'CommonJS',moduleResolution:'node'}});
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(process.cwd(),request.slice(2)):request,parent,...args);};
const {prisma}=require('../lib/prisma');
const campaignId='262f60f1-9268-4722-be9c-7e84920383aa';
const simulation=process.argv.includes('--simulate-pl');
const preview=JSON.parse(fs.readFileSync(path.join(process.env.TEMP,'opsview-pl-history-reconciliation-2026/preview.json')));
const generated=[];
for(const period of preview.periods){const common={campaignId,worksheetSource:'Sheet1',category:'Personal Loans',product:'Volume',metric:'Booked Volume',year:2026,month:period.month,reportDate:new Date(Date.UTC(2026,period.month-1,1)),updatedAt:new Date(),target:null,achievement:null,level:null,numericValue:null};generated.push(...period.agents.map(a=>({...common,recordKind:'agent_monitoring',monitoringType:'PL_SOURCE_BOOKED_AGENT',entityName:a.name,actual:a.actual,target:a.target,sourceRow:a.sourceRow})),{...common,recordKind:'ytd',monitoringType:'PL_SOURCE_TOTAL',entityName:'BPI PL source control',actual:period.total,sourceRow:136});}
function matches(row,where={}){
  for(const [key,value] of Object.entries(where)){
    if(key==='OR'){if(!value.some(v=>matches(row,v)))return false;continue;}
    if(key==='AND'){if(![].concat(value).every(v=>matches(row,v)))return false;continue;}
    if(!(key in row))continue;
    if(value&&typeof value==='object'&&!(value instanceof Date)){
      if(value.in&&!value.in.includes(row[key]))return false;
      if(value.gte&&row[key]<value.gte)return false;if(value.lte&&row[key]>value.lte)return false;
      if(value.not===null&&row[key]==null)return false;
    }else if(row[key]!==value)return false;
  }return true;
}
const readOps=new Set(['findMany','findFirst','findFirstOrThrow','findUnique','findUniqueOrThrow','count','aggregate','groupBy']);
const readonly=new Proxy(prisma,{get(target,key){
  if(['$executeRaw','$executeRawUnsafe','$transaction'].includes(key))return()=>{throw Error('Writes prohibited in verification');};
  if(typeof target[key]==='function')return target[key].bind(target);
  if(target[key]&&typeof target[key]==='object'&&!String(key).startsWith('_'))return new Proxy(target[key],{get(model,op){if(typeof model[op]!=='function')return model[op];return async(...args)=>{assert(readOps.has(op));const rows=await model[op](...args);return simulation&&key==='dashboardImportRecord'&&op==='findMany'?[...rows,...generated.filter(r=>matches(r,args[0]?.where)).map(r=>args[0]?.select?Object.fromEntries(Object.keys(args[0].select).map(k=>[k,r[k]])):r)]:rows;};}});
  return target[key];
}});
function load(file){let source=fs.readFileSync(file,'utf8').replace(/^import .*getServerSession.*;\r?\n/m,'').replace(/^import .*authOptions.*;\r?\n/m,'').replace(/await getServerSession\(authOptions\)/g,'({user:{id:"offline-review",role:"CEO"}})');const code=require('typescript').transpileModule(source,{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText;const m=new Module(path.resolve(file)+'.offline.cjs',module);m.filename=m.id;m.paths=module.paths;const req=m.require.bind(m);m.require=name=>name==='@/lib/prisma'?{...require('../lib/prisma'),prisma:readonly}:simulation&&name==='@/lib/bulk-import-reports'?{getBulkImportedCampaignIds:async()=>[campaignId]}:req(name);m._compile(code,m.filename);return m.exports.GET;}
async function main(){const routes={performance:load('app/api/reports/campaign-performance/route.ts'),campaigns:load('app/api/reports/campaigns/route.ts'),dashboard:load('app/api/dashboard/route.ts')};for(const period of [{month:1,total:422961998},{month:2,total:314396999},{month:3,total:483365100},...preview.periods]){for(const [name,get] of Object.entries(routes)){const response=await get({url:`http://offline-review/api?campaignId=${campaignId}&year=2026&month=${period.month}`});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));const actual=name==='performance'?data.overallPerformance.totalActual:name==='campaigns'?data.campaigns.find(c=>c.id===campaignId)?.mtd:data.campaignTable.find(c=>c.id===campaignId)?.mtd;assert.equal(actual,period.total,`${name} month ${period.month}`);console.log(JSON.stringify({simulation,route:name,month:period.month,actual}));}}
for(const [name,get] of Object.entries(routes)){const response=await get({url:`http://offline-review/api?campaignId=${campaignId}&year=2026&month=0&allMonths=true`});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));const actual=name==='performance'?data.overallPerformance.totalActual:name==='campaigns'?data.campaigns.find(c=>c.id===campaignId)?.mtd:data.campaignTable.find(c=>c.id===campaignId)?.mtd;assert.equal(actual,2126885227,`${name} all months`);console.log(JSON.stringify({simulation,route:name,period:'ALL',actual}));}}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>prisma.$disconnect());
