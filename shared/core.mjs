import { createHash } from 'node:crypto';
export const MIN = 60_000, DAY = 86_400_000;
export const CALENDAR = 'https://ftmo.com/en/calendar/';
export const UPDATES = 'https://ftmo.com/en/trading-updates/';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
export const fmt = t => new Intl.DateTimeFormat('vi-VN', {timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t));
export function week(now) {
  const vn = new Date(now + 7*60*MIN);
  const start = Date.UTC(vn.getUTCFullYear(),vn.getUTCMonth(),vn.getUTCDate() - (vn.getUTCDay()+6)%7) - 7*60*MIN;
  const ymd = t => new Date(t+7*60*MIN).toISOString().slice(0,10);
  return {start,end:start+7*DAY,from:ymd(start),to:ymd(start+6*DAY)};
}
export function vnDate(text, anchor) {
  const m = text.match(/\b(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\b/);
  if (!m) throw new Error('Tin bị hạn chế chưa có giờ xác định: '+text);
  const [,hh,mm,dd,mo] = m.map(Number);
  if(hh>23 || mm>59 || dd<1 || dd>31 || mo<1 || mo>12) throw new Error('Ngày giờ tin không hợp lệ');
  const year=new Date(anchor).getUTCFullYear();
  const choices=[year-1,year,year+1].map(y=>Date.UTC(y,mo-1,dd,hh-7,mm));
  const t=choices.sort((a,b)=>Math.abs(a-anchor)-Math.abs(b-anchor))[0];
  const check=new Date(t+7*60*MIN);
  if(check.getUTCMonth()!==mo-1 || check.getUTCDate()!==dd) throw new Error('Ngày tin không hợp lệ');
  return t;
}
export function parseRows(rows, now) {
  const range=week(now), events=new Map();
  for(const cells of rows) {
    if(cells.length<3 || !cells[0].includes('Restricted event')) continue;
    const title=cells[0].replace(/Restricted event/g,'').replace(/\s+/g,' ').trim();
    const scope=cells[1].replace(/\s+/g,' ').trim();
    if(!title || !scope) throw new Error('Thiếu tên tin hoặc mã bị ảnh hưởng');
    const start=vnDate(cells[2],now);
    if(start<range.start || start>=range.end) throw new Error('Lịch FTMO không khớp tuần yêu cầu');
    const e={kind:'news',title,scope,start,end:start+2*MIN,source:CALENDAR};
    e.id=hash([e.kind,title,scope,start]); events.set(e.id,e);
  }
  return [...events.values()].sort((a,b)=>a.start-b.start);
}
export function groupEvents(events) {
  const groups=new Map();
  for(const e of events) {
    const key=hash([e.start,e.scope]);
    if(!groups.has(key)) groups.set(key,{...e,titles:[],id:key});
    const g=groups.get(key); if(!g.titles.includes(e.title)) g.titles.push(e.title);
  }
  return [...groups.values()].map(g=>({...g,title:g.titles.sort().join(' / '),id:hash([g.start,g.scope,g.titles.sort()])})).sort((a,b)=>a.start-b.start);
}
export function parseMaintenance(text, now) {
  const clean=text.replace(/\u00a0/g,' ').replace(/\s+/g,' ');
  if(!/Trading Update/i.test(clean)) throw new Error('Không nhận diện được bài Trading Update');
  const heading=clean.match(/Trading Update[s]?\s*\|\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  if(!heading) throw new Error('Không xác định được ngày bài Trading Update');
  const published=Date.parse(heading[1]+' 00:00:00 GMT');
  if(!Number.isFinite(published) || now-published>14*DAY || published-now>DAY) throw new Error('Bài Trading Update quá cũ hoặc ngày không hợp lệ');
  const offset=clean.match(/GMT\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i);
  if(!offset) throw new Error('Bài FTMO thiếu múi giờ; không tự đoán giờ bảo trì');
  const offsetMin=(Number(offset[2])*60+Number(offset[3]||0))*(offset[1]==='-'?-1:1);
  const sections=clean.split(/(?=We (?:will|are going to) (?:perform|conduct))/i).filter(s=>/^We /i.test(s));
  const events=[];
  for(const s0 of sections) {
    const s=s0.split(/During the maintenance|Overnight rollover|Related|The situation in Ukraine/i)[0];
    if(!/maintenance/i.test(s)) continue;
    const date=s.match(/\b(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/);
    const explicitDates=[...s.matchAll(/\b(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/g)];
    if(explicitDates.length>1) throw new Error('Thông báo có nhiều ngày bảo trì; cần kiểm tra giờ nguồn trực tiếp');
    const times=s.match(/(?:between|from)\s+(\d{1,2}):(\d{2})\s*(?:and|to|[-–])\s*(\d{1,2}):(\d{2})/i);
    if(!date || !times) throw new Error('FTMO có thông báo bảo trì nhưng định dạng giờ chưa được hỗ trợ. Mở Trading Updates kiểm tra.');
    const [,h1,m1,h2,m2]=times.map(Number);
    if(h1>23||h2>23||m1>59||m2>59) throw new Error('Giờ bảo trì không hợp lệ');
    const midnight=Date.parse(date[1]+' 00:00:00 GMT');
    const start=midnight+(h1*60+m1-offsetMin)*MIN;
    let end=midnight+(h2*60+m2-offsetMin)*MIN;
    if(end<start) end+=DAY;
    if(!Number.isFinite(start)||end<=start||end-start>DAY) throw new Error('Khoảng bảo trì không hợp lệ');
    const scope=[...new Set(s.match(/MT4|MT5|cTrader|DXtrade|TradingView/gi)||[])].join(', ');
    if(!scope) throw new Error('Không xác định được nền tảng bảo trì');
    events.push({kind:'maintenance',title:'Bảo trì '+scope,scope,start,end,source:UPDATES,id:hash([scope,start,end])});
  }
  if(/maintenance/i.test(clean) && !events.length && !/(?:no|not any|without)[^.]{0,70}maintenance/i.test(clean)) throw new Error('Có nội dung bảo trì chưa phân tích được; cần kiểm tra nguồn');
  return events;
}
export function detail(e) {
  if(e.kind==='maintenance') return `🔧 ${e.title}\n${fmt(e.start)} → ${fmt(e.end)} (VN)\nPhạm vi: ${e.scope}\nThời gian dự kiến theo FTMO; không phải xác nhận nền tảng đã hoạt động.\n${e.source}`;
  return `🔴 ${e.title}\nGiờ tin: ${fmt(e.start)} (VN)\n⛔ Hạn chế: ${fmt(e.start-2*MIN)} → ${fmt(e.start+2*MIN)}\nPhạm vi FTMO: ${e.scope}\nStandard sau pass: không mở/đóng lệnh hoặc để lệnh chờ, SL/TP khớp trong khoảng trên.\n${e.source}`;
}
