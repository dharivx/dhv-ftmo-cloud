import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {MIN,DAY,week,hash,parseRows,groupEvents,parseMaintenance,vnDate} from '../shared/core.mjs';
import {validateSnapshot,buildMessages,reminderText} from '../worker/logic.mjs';
import {putSnapshot,claim} from '../worker/store.mjs';
import {handle,tick} from '../worker/index.mjs';
import {tableHtml} from '../shared/table.mjs';

const now=Date.parse('2026-09-20T12:00:00Z'); // Sunday 19:00 VN
function event(start,title='CPI',scope='USD + US Indices + XAUUSD + DXY') {
  return {id:hash([start,title,scope]),kind:'news',title,scope,start,end:start+2*MIN};
}
function packet(anchor=now,offset=0,events=[]) {
  return validateSnapshot({kind:'news',range:week(anchor+offset),checkedAt:anchor,events},anchor);
}
// Run real SQLite statements through a minimal D1-shaped adapter.
function env() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){
    return {args:[],bind(...args){this.args=args;return this;},
      async first(){return sqlite.prepare(sql).get(...this.args)||null;},
      async all(){return {results:sqlite.prepare(sql).all(...this.args)};},
      async run(){return {results:[],meta:sqlite.prepare(sql).run(...this.args)};}};
  },async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const images=new Map();
  return {DB,IMAGES:{async put(k,v){images.set(k,v);},async get(k){return images.get(k)||null;}},INGEST_SECRET:'x'.repeat(40),TELEGRAM_BOT_TOKEN:'fake:test',TELEGRAM_CHAT_ID:'123',ALERT_MINUTES:'90',sqlite};
}
async function install(e,p,time=now) {await putSnapshot(e.DB,p,buildMessages(p,null,time,90),time);}
test('Vietnam week boundary and next-year dates',()=>{
  assert.equal(week(Date.parse('2026-09-20T18:00:00Z')).from,'2026-09-21');
  assert.equal(vnDate('00:30 01/01',Date.parse('2026-12-31T12:00:00Z')),Date.parse('2026-12-31T17:30:00Z'));
});
test('Read only Restricted event and group simultaneous scopes',()=>{
  const rows=[['CPI Restricted event','USD','19:30 17/09'],['Wages Restricted event','USD','19:30 17/09'],['Speech','USD','19:30 17/09']];
  const events=groupEvents(parseRows(rows,now));assert.equal(events.length,1);assert.equal(events[0].titles.length,2);
  assert.throws(()=>parseRows([['CPI Restricted event','USD','Tentative']],now));
});
test('Maintenance parses announced GMT offset including winter and overnight',()=>{
  const text='Trading Update | 17 Sep 2026 GMT+3. We will perform maintenance on MT5 on 19 Sep 2026 between 2:00 and 18:00.';
  const [e]=parseMaintenance(text,now);assert.equal(e.start,Date.parse('2026-09-18T23:00:00Z'));
  const [winter]=parseMaintenance(text.replace('GMT+3','GMT+2').replace('2:00 and 18:00','23:00 and 1:00'),now);
  assert.equal(winter.end-winter.start,120*MIN);assert.throws(()=>parseMaintenance(text.replace('GMT+3',''),now));
});
test('Weekly image schedules Sunday 19:00 for next week, not current week',()=>{
  const next=week(now+7*DAY),p=packet(now,7*DAY,[event(next.start+DAY)]);
  const list=buildMessages(p,null,now,90),weekly=list.find(m=>m.category==='weekly');
  assert.equal(weekly.deliver_at,now);assert.equal(weekly.expires_at,next.start);
  assert.equal(JSON.parse(weekly.payload).week,'2026-09-21');
  assert.ok(!buildMessages(packet(now),null,now).some(m=>m.category==='weekly'));
});
test('Every news reminder is 90 minutes; Monday 00:30 reminds Sunday 23:00',()=>{
  const next=week(now+7*DAY),e=event(next.start+30*MIN);
  const rows=buildMessages(packet(now,7*DAY,[e]),null,now);
  const reminders=rows.filter(m=>m.category==='reminder');assert.equal(reminders.length,1);
  assert.equal(reminders[0].deliver_at,e.start-90*MIN);
});
test('Reject wrong-week, invalid and old payloads',()=>{
  assert.throws(()=>packet(now,7*DAY,[event(now)]));
  const p=packet(now);assert.throws(()=>validateSnapshot({...p,checkedAt:now-2*60*MIN},now));
  assert.throws(()=>packet(now,0,[{...event(now),id:'unsafe'}]));
});
test('A late reminder reports actual minutes, stale data warns, >24h does not claim current',()=>{
  const e=event(now+45*MIN),p=packet(now,0,[e]);
  const snap={payload:JSON.stringify(p),checked_at:now-9*60*MIN,error:null};
  const text=reminderText({event:e,minutes:90},snap,now);
  assert.ok(text.includes('45 phút'));assert.ok(text.includes('nhắc trễ'));assert.ok(text.includes('cập nhật chậm'));
  assert.equal(reminderText({event:e,minutes:90},{...snap,checked_at:now-25*60*MIN},now),null);
});
test('D1 removes obsolete reminders after reschedule and preserves sent records',async()=>{
  const e=env(),a=packet(now,0,[event(now+2*60*MIN)]);await install(e,a);
  const reminder=buildMessages(a,null,now).find(m=>m.category==='reminder');
  await e.DB.prepare('UPDATE messages SET sent_at=? WHERE id=?').bind(now,reminder.id).run();
  const b=packet(now,0,[event(now+3*60*MIN)]);await putSnapshot(e.DB,b,buildMessages(b,a,now),now);
  assert.equal(e.sqlite.prepare('SELECT sent_at FROM messages WHERE id=?').get(reminder.id).sent_at,now);
  await putSnapshot(e.DB,packet(now),[],now);
  assert.equal(e.sqlite.prepare("SELECT COUNT(*) AS n FROM messages WHERE category='reminder' AND sent_at IS NULL").get().n,0);
});
test('Atomic leases prevent two runs claiming the same due reminder',async()=>{
  const e=env(),p=packet(now,0,[event(now+90*MIN)]);await install(e,p);
  const a=await claim(e.DB,now,'a'),b=await claim(e.DB,now,'b');
  assert.equal(a.length,1);assert.equal(b.length,0);
  assert.equal((await claim(e.DB,now+4*MIN,'c')).length,1);
});
test('Protected endpoints reject unauthenticated writes',async()=>{
  const r=await handle(new Request('https://worker.example/ingest',{method:'POST',body:'{}'}),env(),now);
  assert.equal(r.status,401);
});
test('Authenticated ingest and stale upload rejection',async()=>{
  const e=env(),p=packet(now),headers={Authorization:`Bearer ${e.INGEST_SECRET}`};
  let r=await handle(new Request('https://worker.example/ingest',{method:'POST',headers,body:JSON.stringify(p)}),e,now);
  assert.equal(r.status,200);
  r=await handle(new Request('https://worker.example/ingest',{method:'POST',headers,body:JSON.stringify({...p,checkedAt:now-MIN})}),e,now);
  assert.equal(r.status,409);
});
test('Full tick sends one reminder then deduplicates next tick',async()=>{
  const e=env(),p=packet(now,0,[event(now+90*MIN)]);await install(e,p);
  await install(e,packet(now,7*DAY));
  // Avoid weekly image due in this test.
  e.sqlite.exec("DELETE FROM messages WHERE category='weekly'");
  await install(e,validateSnapshot({kind:'maintenance',checkedAt:now,events:[]},now));
  const calls=[],original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:1}});};
  try {await tick(e,now+MIN);await tick(e,now+2*MIN);}finally{globalThis.fetch=original;}
  assert.equal(calls.length,1);assert.ok(calls[0].text.includes('89 phút'));
});
test('Weekly PNG uses stored matching revision and is sent once',async()=>{
  const e=env(),next=week(now+7*DAY),p=packet(now,7*DAY,[event(next.start+DAY)]);await install(e,p);
  await install(e,packet(now));await install(e,validateSnapshot({kind:'maintenance',checkedAt:now,events:[]},now));
  await e.IMAGES.put(`${p.range.from}:${p.revision}`,new Uint8Array([137,80,78,71,13,10,26,10]).buffer);
  const calls=[],original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls.push({url,body:options.body});return Response.json({ok:true,result:{message_id:2}});};
  try{await tick(e,now+MIN);await tick(e,now+2*MIN);}finally{globalThis.fetch=original;}
  assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/sendDocument'));
  assert.ok(calls[0].body.get('caption').includes('2026-09-21'));
});
test('Telegram 429 is retried and never marked sent prematurely',async()=>{
  const e=env();await install(e,packet(now,0,[event(now+90*MIN)]));await install(e,packet(now,7*DAY));
  await install(e,validateSnapshot({kind:'maintenance',checkedAt:now,events:[]},now));e.sqlite.exec("DELETE FROM messages WHERE category='weekly'");
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({ok:false,parameters:{retry_after:120}},{status:429});
  try{await tick(e,now+MIN);}finally{globalThis.fetch=original;}
  const row=e.sqlite.prepare("SELECT * FROM messages WHERE category='reminder'").get();
  assert.equal(row.sent_at,null);assert.equal(row.next_attempt,now+3*MIN);
});
test('One table retains all rows/scopes and escapes external titles',()=>{
  const html=tableHtml({range:week(now),events:[event(now,'<script>x</script>'),event(now+MIN,'Other','EUR')],checkedAt:now});
  assert.equal((html.match(/<table>/g)||[]).length,1);assert.equal((html.match(/<tr>/g)||[]).length,3);
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('trước 90 phút'));
});
