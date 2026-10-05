import {MIN,fmt} from './core.mjs';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function tableHtml({range,events,checkedAt}) {
  const rows=events.map(e=>`<tr><td>${esc(fmt(e.start))}</td><td>${esc(e.title)}</td><td class="scope">${esc(e.scope)}</td><td>${esc(fmt(e.start-2*MIN))}<br>→ ${esc(fmt(e.start+2*MIN))}</td></tr>`).join('');
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;padding:48px;background:#f4f5f7;color:#17191d;font:21px Arial,sans-serif}
  main{background:white;border-radius:18px;padding:38px}h1{font-size:34px;margin:8px 0 14px}p{line-height:1.5}.label{font-size:17px;font-weight:bold;letter-spacing:2px;color:#626975}
  table{border-collapse:collapse;width:100%;table-layout:fixed;margin:28px 0}th{background:#181b21;color:white;text-align:left;padding:18px}td{padding:18px;border-bottom:1px solid #ddd;overflow-wrap:anywhere;line-height:1.45;vertical-align:top}tr:nth-child(even){background:#f7f8fa}th:nth-child(1){width:19%}th:nth-child(2){width:30%}th:nth-child(3){width:29%}th:nth-child(4){width:22%}.scope{font-weight:bold}.foot{font-size:18px;color:#555e69}
  </style><main><div class="label">DHV · FTMO STANDARD</div><h1>Tin hạn chế giao dịch — tuần tới</h1><p>${esc(range.from)} → ${esc(range.to)} · Múi giờ Việt Nam (UTC+7)</p>
  <table><thead><tr><th>Ngày / giờ tin</th><th>Sự kiện</th><th>Mã / nhóm mã bị hạn chế</th><th>Khung giờ hạn chế</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Chưa thấy sự kiện Restricted event trong lịch vừa đọc. Lịch tuần tới có thể chưa được FTMO cập nhật đầy đủ.</td></tr>'}</tbody></table>
  <p class="foot">Phạm vi mã giữ theo nhãn FTMO: “USD” là các cặp Forex có USD; “US Indices” là nhóm chỉ số Mỹ. Không tự bổ sung mã ngoài phạm vi nguồn.</p><p class="foot">Không mở/đóng lệnh hoặc để lệnh chờ, SL/TP khớp trong cửa sổ hạn chế. Áp dụng Standard sau pass.</p><p class="foot">Nguồn: ftmo.com/en/calendar/ · Kiểm tra ${esc(fmt(checkedAt))}. Lịch có thể thay đổi; bot tiếp tục cập nhật và nhắc trước 90 phút.</p></main></html>`;
}
