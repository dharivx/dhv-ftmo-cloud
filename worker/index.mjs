import {timingSafeEqual} from 'node:crypto';
import {MIN,DAY,week,CALENDAR,UPDATES} from '../shared/core.mjs';
import {validateSnapshot,buildMessages,message,reminderText,STALE_AFTER,STOP_AFTER} from './logic.mjs';
import {enqueue,putSnapshot,claim} from './store.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function authorized(request,env) {
  if(!env.INGEST_SECRET || env.INGEST_SECRET.length<32) return false;
  const a=new TextEncoder().encode(request.headers.get('Authorization')||'');
  const b=new TextEncoder().encode(`Bearer ${env.INGEST_SECRET}`);
  return a.length===b.length && timingSafeEqual(a,b);
}
export async function telegram(env,method,data) {
  if(!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error('Missing Telegram secrets');
  const body=data instanceof FormData?data:JSON.stringify(data);
  const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{
    method:'POST',headers:data instanceof FormData?undefined:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(20000),
  });
  let result;try{result=await r.json();}catch{throw new Error(`Telegram response invalid (${r.status})`);}
  if(!r.ok||!result.ok) {const e=new Error(`Telegram send failed (${r.status})`);e.retryAfter=Number(result.parameters?.retry_after)||60;throw e;}
  return result.result;
}
async function readJson(request) {
  if(Number(request.headers.get('content-length'))>512000) throw new Error('Payload too large');
  const raw=await request.text();if(raw.length>512000) throw new Error('Payload too large');return JSON.parse(raw);
}
export async function handle(request,env,now=Date.now()) {
  const u=new URL(request.url);
  if(u.pathname==='/'&&request.method==='GET') return json({service:'DHV FTMO alerts',version:'0.3.0'});
  if(!authorized(request,env)) return json({error:'Unauthorized'},401);
  if(u.pathname==='/status'&&request.method==='GET') {
    const r=await env.DB.prepare('SELECT source_key,revision,checked_at,attempted_at,error FROM snapshots ORDER BY source_key').all();
    return json({sources:r.results,now,reminderMinutes:Number(env.ALERT_MINUTES||90)});
  }
  if(u.pathname==='/ingest'&&request.method==='POST') {
    let p;try{p=validateSnapshot(await readJson(request),now);}catch(e){return json({error:e.message},400);}
    const old=await env.DB.prepare('SELECT * FROM snapshots WHERE source_key=?').bind(p.key).first();
    if(old&&old.checked_at>p.checkedAt) return json({error:'Older snapshot rejected'},409);
    const baseline=old?.checked_at?JSON.parse(old.payload):null;
    const rows=buildMessages(p,baseline,now,Number(env.ALERT_MINUTES||90));
    await putSnapshot(env.DB,p,rows,now);
    return json({ok:true,key:p.key,revision:p.revision});
  }
  if(u.pathname==='/failure'&&request.method==='POST') {
    const data=await readJson(request);
    if(!/^maintenance$|^news:\d{4}-\d{2}-\d{2}$/.test(data.key)) return json({error:'Invalid key'},400);
    await env.DB.prepare(`INSERT INTO snapshots(source_key,attempted_at,error) VALUES(?,?,?) ON CONFLICT(source_key) DO UPDATE SET attempted_at=excluded.attempted_at,error=excluded.error`)
      .bind(data.key,now,'Bộ đọc GitHub chưa lấy được nguồn FTMO. Xem Actions run mới nhất.').run();
    return json({ok:true});
  }
  if(u.pathname==='/image'&&request.method==='PUT') {
    const target=u.searchParams.get('week'),revision=u.searchParams.get('revision');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(target||'')||!/^[a-f0-9]{24}$/.test(revision||'')) return json({error:'Invalid image reference'},400);
    const snap=await env.DB.prepare('SELECT revision FROM snapshots WHERE source_key=?').bind(`news:${target}`).first();
    if(snap?.revision!==revision) return json({error:'Snapshot revision mismatch'},409);
    if(Number(request.headers.get('content-length'))>1800000) return json({error:'PNG too large'},413);
    const bytes=await request.arrayBuffer(),head=new Uint8Array(bytes,0,Math.min(8,bytes.byteLength));
    if(bytes.byteLength>1800000||head.join(',')!=='137,80,78,71,13,10,26,10') return json({error:'Invalid PNG or size'},400);
    await env.IMAGES.put(`${target}:${revision}`,bytes,{expirationTtl:14*86400});
    return json({ok:true});
  }
  if(u.pathname==='/test'&&request.method==='POST') {
    await telegram(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:'✅ DHV FTMO Cloud đã kết nối Telegram. Lịch tuần: Chủ Nhật 19:00 VN. Nhắc tin: trước 90 phút. Hãy kiểm tra /status để xác nhận nguồn đã được đọc.'});
    return json({ok:true});
  }
  return json({error:'Not found'},404);
}
async function monitor(env,now) {
  const keys=[`news:${week(now).from}`,`news:${week(now+7*DAY).from}`,'maintenance'];
  const {results}=await env.DB.prepare('SELECT * FROM snapshots WHERE source_key IN (?,?,?)').bind(...keys).all();
  const rows=[];
  for(const key of keys) {
    const snap=results.find(s=>s.source_key===key);
    if(!snap?.checked_at||snap.error||now-snap.checked_at>STALE_AFTER) {
      rows.push(message(`source-error:${key}:${Math.floor(now/(8*60*MIN))}`,key,'source-error',{
        text:`⚠️ Dữ liệu FTMO chưa sẵn sàng hoặc cập nhật chậm: ${key}.\nKiểm tra GitHub Actions và nguồn FTMO. Lịch đã lưu tối đa 24 giờ có thể vẫn được nhắc kèm cảnh báo; đây không phải xác nhận không có tin.\n${key==='maintenance'?UPDATES:CALENDAR}`,
      },now,now+8*60*MIN,now));
    }
  }
  await enqueue(env.DB,rows);
}
export async function tick(env,now=Date.now()) {
  await monitor(env,now);
  const token=crypto.randomUUID(),jobs=await claim(env.DB,now,token);
  for(const job of jobs) {
    try {
      const p=JSON.parse(job.payload);
      const snap=job.source_key?await env.DB.prepare('SELECT * FROM snapshots WHERE source_key=?').bind(job.source_key).first():null;
      if(job.category==='reminder') {
        const text=snap?.checked_at?reminderText(p,snap,now):null;
        if(!text) {
          // Old data is never presented as current; monitor sends a source warning.
          await env.DB.prepare('UPDATE messages SET next_attempt=?,lease_until=0 WHERE id=? AND lease_token=?').bind(now+5*MIN,job.id,token).run();
          continue;
        }
        await telegram(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text,link_preview_options:{is_disabled:true}});
      } else if(job.category==='weekly') {
        if(!snap?.checked_at||snap.error||now-snap.checked_at>STALE_AFTER||snap.revision!==p.revision) throw new Error('Weekly source is stale/mismatched');
        const png=await env.IMAGES.get(`${p.week}:${p.revision}`,{type:'arrayBuffer'});
        if(!png) {
          if(now-job.deliver_at>10*MIN) await enqueue(env.DB,[message(`missing-image:${p.week}`,job.source_key,'source-error',{text:'⚠️ Chưa tạo/nhận được ảnh bảng tuần FTMO. Kiểm tra GitHub Actions. Bot sẽ thử lại trong tối Chủ Nhật.'},now,job.expires_at,now)]);
          throw new Error('Weekly PNG unavailable');
        }
        const form=new FormData();form.append('chat_id',env.TELEGRAM_CHAT_ID);form.append('caption',p.caption);
        form.append('document',new Blob([png],{type:'image/png'}),`FTMO-${p.week}.png`);
        await telegram(env,'sendDocument',form);
      } else {
        await telegram(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:p.text,link_preview_options:{is_disabled:true}});
      }
      await env.DB.prepare('UPDATE messages SET sent_at=?,lease_until=0 WHERE id=? AND lease_token=?').bind(now,job.id,token).run();
    } catch(e) {
      console.error('Delivery will retry:',job.category,String(e.message).slice(0,120));
      await env.DB.prepare('UPDATE messages SET next_attempt=?,lease_until=0 WHERE id=? AND lease_token=?').bind(now+Math.max(60,Math.min(3600,e.retryAfter||60))*1000,job.id,token).run();
    }
  }
  if(new Date(now).getUTCMinutes()===0) {
    await env.DB.prepare('DELETE FROM messages WHERE expires_at<?').bind(now-30*DAY).run();
    await env.DB.prepare('DELETE FROM snapshots WHERE attempted_at<?').bind(now-40*DAY).run();
  }
}
export default {
  async fetch(request,env) {
    try{return await handle(request,env);}catch{console.error('Request failed; check bindings/schema.');return json({error:'Internal error'},500);}
  },
  async scheduled(controller,env,ctx) {ctx.waitUntil(tick(env));},
};
