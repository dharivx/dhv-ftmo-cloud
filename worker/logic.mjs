import {MIN,DAY,week,hash,detail,fmt,CALENDAR,UPDATES} from '../shared/core.mjs';
export const STALE_AFTER=8*60*MIN;
export const STOP_AFTER=24*60*MIN;
export function keyFor(kind,range) {return kind==='maintenance'?'maintenance':`news:${range.from}`;}
export function validateSnapshot(p,now) {
  if(!p || !['news','maintenance'].includes(p.kind) || !Number.isFinite(p.checkedAt) || p.checkedAt>now+5*MIN || now-p.checkedAt>60*MIN) throw new Error('Invalid snapshot time/kind');
  if(!Array.isArray(p.events) || p.events.length>150) throw new Error('Invalid event count');
  if(p.kind==='news') {
    const current=week(now),next=week(now+7*DAY);
    if(!p.range || ![current.from,next.from].includes(p.range.from)) throw new Error('Unexpected calendar week');
    const expected=p.range.from===current.from?current:next;
    if(p.range.start!==expected.start||p.range.end!==expected.end||p.range.to!==expected.to) throw new Error('Invalid week range');
  }
  const ids=new Set();
  for(const e of p.events) {
    if(!e || !/^[a-f0-9]{24}$/.test(e.id)||ids.has(e.id)||e.kind!==p.kind || typeof e.title!=='string'||e.title.length>1600||!e.title.trim()||typeof e.scope!=='string'||e.scope.length>500||!e.scope.trim()) throw new Error('Invalid event');
    if(!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.end<=e.start) throw new Error('Invalid event times');
    if(e.kind==='news'&&(e.start<p.range.start||e.start>=p.range.end||e.end!==e.start+2*MIN)) throw new Error('Event outside requested week');
    if(e.kind==='maintenance'&&(e.end-e.start>DAY||Math.abs(e.start-now)>30*DAY)) throw new Error('Unexpected maintenance dates');
    e.source=e.kind==='news'?CALENDAR:UPDATES;ids.add(e.id);
  }
  return {...p,key:keyFor(p.kind,p.range),revision:hash(p.events.map(e=>[e.id,e.title,e.scope,e.start,e.end]))};
}
export function message(id,key,category,payload,deliverAt,expiresAt,now) {
  return {id,source_key:key,category,payload:JSON.stringify(payload),deliver_at:deliverAt,expires_at:expiresAt,created_at:now};
}
export function buildMessages(p,old,now,lead=90) {
  const out=[];
  for(const e of p.events) {
    for(const minutes of e.kind==='news'?[lead]:[1440,60]) {
      // Skip obsolete longer maintenance reminders when starting late.
      if(e.kind==='maintenance' && minutes===1440 && e.start-now<=60*MIN) continue;
      if(e.start<=now) continue;
      out.push(message(`remind:${e.id}:${minutes}`,p.key,'reminder',{event:e,minutes},e.start-minutes*MIN,e.start,now));
    }
  }
  const previous=old?.events||[];
  const oldIds=new Set(previous.map(e=>e.id)),newIds=new Set(p.events.map(e=>e.id));
  const changed=old && (p.events.some(e=>e.end>now&&!oldIds.has(e.id))||previous.some(e=>e.end>now&&!newIds.has(e.id)));
  if(changed || (!old&&p.kind==='maintenance'&&p.events.some(e=>e.end>now))) {
    const active=p.events.filter(e=>e.end>now);
    // One concise update, no flood of individual calendar events.
    const text=p.kind==='maintenance'
      ? `🔧 Lịch bảo trì FTMO mới / thay đổi\n${active.map(detail).join('\n\n')||'Thông báo cũ đã được gỡ. Kiểm tra lại nguồn.'}\n${UPDATES}`
      : `📌 FTMO cập nhật lịch tin ${p.range.from} → ${p.range.to}.\nGiờ hoặc danh sách sự kiện đã thay đổi; lịch nhắc được tính lại.\n${CALENDAR}`;
    out.push(message(`update:${p.key}:${p.revision}`,p.key,'update',{text:text.slice(0,3500)},now,now+DAY,now));
  }
  if(p.kind==='news') {
    const sundayTime=p.range.start-DAY+19*60*MIN;
    if(now<p.range.start) out.push(message(`weekly:${p.range.from}`,p.key,'weekly',{week:p.range.from,revision:p.revision,caption:`📅 FTMO STANDARD — ${p.range.from} → ${p.range.to}\nBảng tin hạn chế tuần tới · Giờ Việt Nam\nCập nhật: ${fmt(p.checkedAt)}\nNhắc trước tin ${lead} phút. Lịch có thể thay đổi.`},sundayTime,p.range.start,now));
  }
  return out;
}
export function reminderText(payload,snapshot,now) {
  const data=JSON.parse(snapshot.payload);
  if(now-snapshot.checked_at>STOP_AFTER) return null;
  const e=data.events.find(e=>e.id===payload.event.id);
  if(!e || now>=e.start) return null;
  const remaining=Math.ceil((e.start-now)/MIN);
  const late=remaining<payload.minutes-2?' (nhắc trễ)':'';
  const stale=snapshot.error || now-snapshot.checked_at>STALE_AFTER;
  return `⏰ Còn khoảng ${remaining} phút${late}\n${detail(e)}\nNguồn đọc lúc ${fmt(snapshot.checked_at)}.`+
    (stale?'\n⚠️ Nguồn đang lỗi hoặc cập nhật chậm. Đây là lịch đã lưu; kiểm tra lại FTMO.':'');
}
