import {chromium} from 'playwright';
import {week,parseRows,groupEvents,parseMaintenance,UPDATES,CALENDAR} from '../shared/core.mjs';

async function pageTask(fn) {
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({locale:'en-US',timezoneId:'Asia/Ho_Chi_Minh'});
    const page=await context.newPage();
    page.setDefaultTimeout(25_000);
    return await fn(page);
  } finally { await browser.close(); }
}
async function navigate(page,url) {
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60_000});
  const body=await page.locator('body').innerText();
  if(/verify you are human|checking your browser|access denied|just a moment/i.test(body.slice(0,3000))) {
    throw new Error('FTMO yêu cầu xác minh trình duyệt. Bộ đọc dừng; không vượt CAPTCHA.');
  }
}
export async function readNews(now) {
  return pageTask(async page=>{
    const w=week(now);
    const u=new URL(CALENDAR);
    u.search=new URLSearchParams({dateFrom:w.from,dateTo:w.to,timezone:'Asia/Ho_Chi_Minh',restriction:'true'}).toString();
    await navigate(page,u.href);
    await page.getByRole('heading',{name:'Economic Calendar',exact:true}).waitFor();
    const restricted=page.getByRole('checkbox',{name:'Show only restricted events',exact:true});
    if(!await restricted.isChecked()) await restricted.check();
    const hidePast=page.getByRole('checkbox',{name:'Hide past news',exact:true});
    if(await hidePast.isChecked()) await hidePast.uncheck();
    const main=page.getByRole('main');
    if(!(await main.innerText()).includes('Asia/Ho Chi Minh')) {
      // Select by accessible role instead of unstable React-generated IDs.
      await main.getByRole('combobox').nth(0).fill('Ho Chi');
      await page.getByRole('option',{name:'Asia/Ho Chi Minh (UTC+07:00)',exact:true}).click();
    }
    await page.waitForFunction(()=>{
      const m=document.querySelector('main');
      return m && (m.querySelectorAll('tbody tr td').length>0 || /There are no events based on your current filters/.test(m.innerText));
    },null,{timeout:30_000});
    const raw=await main.innerText();
    if(!raw.includes('Asia/Ho Chi Minh')) throw new Error('Không xác nhận được múi giờ lịch');
    const url=new URL(page.url());
    if(url.searchParams.get('dateFrom')!==w.from || url.searchParams.get('dateTo')!==w.to) throw new Error('Trang đổi khoảng ngày, cần kiểm tra bộ đọc');
    const rows=await main.getByRole('row').evaluateAll(rows=>rows.map(r=>Array.from(r.querySelectorAll('td')).slice(0,3).map(c=>c.innerText)));
    const events=groupEvents(parseRows(rows,now));
    if(!events.length && !raw.includes('There are no events based on your current filters')) throw new Error('Lịch trống nhưng không có xác nhận không có sự kiện');
    return events;
  });
}
export async function readMaintenance(now) {
  return pageTask(async page=>{
    await navigate(page,UPDATES);
    await page.getByRole('heading',{level:1}).waitFor();
    return parseMaintenance(await page.getByRole('main').innerText(),now);
  });
}

export async function renderTable(table) {
  const {tableHtml}=await import('../shared/table.mjs');
  return pageTask(async page=>{
    await page.setViewportSize({width:1440,height:900});
    await page.setContent(tableHtml(table),{waitUntil:'load'});
    await page.evaluate(()=>document.fonts.ready);
    return page.screenshot({fullPage:true,type:'png'});
  });
}
