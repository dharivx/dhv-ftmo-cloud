import {readNews,readMaintenance} from './scraper.mjs';
import {week,DAY} from '../shared/core.mjs';
const base=new URL(process.env.WORKER_URL||'https://invalid.invalid');
if(base.protocol!=='https:'||base.hostname==='invalid.invalid'||base.username||base.password) throw new Error('Set WORKER_URL to the deployed HTTPS Worker URL');
const secret=process.env.INGEST_SECRET;
if(!secret||secret.length<32) throw new Error('Set INGEST_SECRET (at least 32 characters)');
async function upload(route,body,method='POST',type='application/json') {
  const r=await fetch(new URL(route,base),{method,headers:{Authorization:`Bearer ${secret}`,'Content-Type':type},body:type==='application/json'?JSON.stringify(body):body,signal:AbortSignal.timeout(60000)});
  if(!r.ok) throw new Error(`Worker upload failed (${r.status})`);
  return r.json();
}
let failed=false;
for(const offset of [0,7*DAY]) {
  // Capture the actual requested week before navigating; keep that range in the payload.
  const anchor=Date.now()+offset,range=week(anchor),key=`news:${range.from}`;
  try {
    const events=await readNews(anchor),checkedAt=Date.now();
    await upload('/ingest',{kind:'news',range,checkedAt,events});
    console.log('Updated',key,'groups:',events.length);
  } catch(e) {
    failed=true;console.error('Failed source:',key,String(e.message).slice(0,300));
    try{await upload('/failure',{key});}catch{console.error('Could not notify Worker about source failure.');}
  }
}
try {
  const events=await readMaintenance(Date.now());
  await upload('/ingest',{kind:'maintenance',checkedAt:Date.now(),events});
  console.log('Updated maintenance groups:',events.length);
} catch(e) {
  failed=true;console.error('Maintenance read failed:',String(e.message).slice(0,300));
  try{await upload('/failure',{key:'maintenance'});}catch{console.error('Could not notify Worker about maintenance failure.');}
}
if(process.env.TEST_TELEGRAM==='true') {
  try{await upload('/test',{});console.log('Telegram connection test sent.');}
  catch{failed=true;console.error('Telegram test failed. Check Cloudflare Telegram secrets.');}
}
if(failed) process.exitCode=1;
