# DHV FTMO Cloud v0.3 — GitHub Actions + Cloudflare

Bot đọc lịch FTMO và nhắc Telegram, **không cần bật máy 24/24, không cần VPS, n8n hoặc API AI**. Chỉ cần dùng máy một lần để cài và deploy. Sau đó GitHub và Cloudflare tự chạy.

**Gói này là mã nguồn để triển khai, chưa được bật trên tài khoản của bạn.** Chưa có token, chat ID, Cloudflare database ID hoặc repo GitHub thật trong gói.

## Lịch gửi đã chốt

| Loại | Giờ gửi Việt Nam | Nội dung |
|---|---|---|
| Bảng tin tuần tới | Chủ Nhật 19:00 | Một ảnh PNG, thứ Hai đến Chủ Nhật tuần tới; tên tin, ngày/giờ, mọi phạm vi mã FTMO đánh dấu và khung hạn chế |
| Nhắc tin | **Trước 90 phút (1 giờ 30)** | Tên tin, mã/nhóm mã liên quan, khung hạn chế và thời điểm đọc nguồn |
| Bảo trì | Khi phát hiện mới/thay đổi; trước 24 giờ và 1 giờ | Nền tảng và thời gian Việt Nam |
| Nguồn lỗi/cũ | Tự phát hiện, hạn chế lặp cảnh báo | Nhắc kiểm tra GitHub Actions và FTMO trực tiếp |

Tin lúc 00:30 thứ Hai sẽ nhắc lúc 23:00 Chủ Nhật. Tin cùng giờ và cùng phạm vi được gộp. Tiêu chí là **Restricted event** của FTMO, không chỉ màu đỏ. Gói này dành cho **FTMO Standard sau pass**.

Mốc 90 phút là mục tiêu nhắc sớm hơn, **không bảo đảm không bao giờ trễ**. Nếu cron hoặc Telegram trễ, tin nhắn ghi số phút thực tế còn lại. Không nhắc sự kiện đã diễn ra.

## Hai dịch vụ làm gì?

- **GitHub Actions:** mở trang FTMO bằng Chromium, đọc tuần hiện tại + tuần kế tiếp + thông báo bảo trì; tạo bảng ảnh rồi chuyển dữ liệu sang Worker qua khóa bí mật.
- **Cloudflare Workers:** kiểm tra mỗi phút, gửi Telegram theo dữ liệu đã lưu. **D1** lưu lịch/hàng đợi/chống trùng; **KV** giữ ảnh bảng trong 14 ngày.
- Token Telegram chỉ nằm trong Cloudflare. GitHub chỉ có URL Worker và khóa cập nhật; không cần Telegram token hoặc quyền quản trị Cloudflare.
- Truy cập mặc định qua địa chỉ `workers.dev`, không cần mua domain. Không có dashboard web công khai chứa thông tin cấu hình.

## Bước 1 — Tạo bot Telegram

1. Trong Telegram, tìm tài khoản chính thức **@BotFather**, dùng `/newbot`.
2. Lưu token riêng. Mở chat với bot mới và bấm **Start**, nhắn một câu.
3. Lấy chat ID của chính bạn. Trên Windows có thể mở PowerShell chạy đoạn này, nhập token khi được hỏi:

```powershell
$botSecret = Read-Host 'Telegram bot token' -AsSecureString
$botCredential = New-Object System.Management.Automation.PSCredential('bot', $botSecret)
$botToken = $botCredential.GetNetworkCredential().Password
try {
  $reply = Invoke-RestMethod -Method Get -Uri ('https://api.telegram.org/bot' + $botToken + '/getUpdates')
  $reply.result | ForEach-Object { $_.message.chat } | Select-Object id, type, first_name, title -Unique
} catch { Write-Host 'Không đọc được Telegram. Kiểm tra token/kết nối; không chia sẻ URL chứa token.' }
Remove-Variable botToken, botCredential, botSecret -ErrorAction SilentlyContinue
```

Chọn `id` đúng của chat riêng với bạn. Nếu rỗng, nhắn thêm cho bot rồi chạy lại. Dùng bot mới để tránh xung đột webhook của bot đang phục vụ ứng dụng khác. Không gửi token qua cuộc trò chuyện này.

## Bước 2 — Deploy Cloudflare một lần

Cần tài khoản Cloudflare, Node.js 24 và quyền dùng Workers Free/D1/KV. Giải nén và mở terminal tại thư mục có `wrangler.jsonc`.

```sh
npm install
npx wrangler login
npx wrangler d1 create dhv-ftmo
npx wrangler kv namespace create IMAGES
```

`wrangler login` mở trình duyệt để bạn đăng nhập. Hai lệnh tạo tài nguyên trả về ID. Mở `wrangler.jsonc`:

- Thay `REPLACE_WITH_D1_DATABASE_ID` bằng `database_id` vừa nhận.
- Thay `REPLACE_WITH_KV_NAMESPACE_ID` bằng ID namespace KV vừa nhận.
- Giữ `ALERT_MINUTES` là `90`.

Tạo bảng và deploy:

```sh
npx wrangler d1 execute dhv-ftmo --remote --file=worker/schema.sql
npx wrangler deploy
```

Lưu URL HTTPS Worker mà lệnh deploy trả về. Ví dụ dạng `https://dhv-ftmo-alerts.<tài-khoản>.workers.dev` — dùng URL thật từ kết quả, không dùng ví dụ.

Nhập ba secret bằng lệnh, không viết vào mã nguồn:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put INGEST_SECRET
```

- `TELEGRAM_BOT_TOKEN`: token từ BotFather.
- `TELEGRAM_CHAT_ID`: chat ID nhận thông báo.
- `INGEST_SECRET`: mật khẩu ngẫu nhiên riêng, ít nhất 32 ký tự; có thể tạo bằng trình quản lý mật khẩu. Lưu lại để nhập cùng giá trị vào GitHub.

Ngay khi Worker cron chạy mà chưa có dữ liệu, nó có thể báo nguồn chưa sẵn sàng. Hoàn thành bước GitHub ngay sau đó. Cron do Cloudflare quản lý, không phụ thuộc terminal đang mở.

## Bước 3 — Đưa mã lên GitHub riêng tư

Tạo repo **Private** trong tài khoản GitHub của bạn. Đưa **nội dung bên trong thư mục giải nén** lên gốc repo, gồm cả `.github/workflows/collect-ftmo.yml`. Không bọc thêm một thư mục cha. Không đưa `node_modules`, `.env`, `.dev.vars`, token hoặc dữ liệu đăng nhập lên repo; `.gitignore` đã có sẵn.

Cách thuận tiện nếu không quen git: GitHub Desktop → Add local repository → Create repository tại thư mục này → Commit → Publish repository và chọn giữ repo riêng tư. Trước khi publish, kiểm tra danh sách file không có secret.

Trong repo GitHub → **Settings → Secrets and variables → Actions → New repository secret**, thêm:

| Secret | Giá trị |
|---|---|
| `WORKER_URL` | URL HTTPS thật của Worker |
| `INGEST_SECRET` | Chính xác khóa đã nhập ở Cloudflare |

Vào **Actions → Read FTMO calendar → Run workflow**. Chọn `test_telegram = true` cho lần thử đầu. Workflow được đặt `contents: read`, không tự commit dữ liệu vào repo.

Run thành công phải có log `Updated news:...`, `Updated maintenance groups:...`, và tin kết nối Telegram nếu chọn thử. Nếu một nguồn lỗi, run sẽ báo đỏ, giữ dữ liệu cũ ở Cloudflare và gửi cảnh báo qua Worker. Đừng kết luận bot đã sẵn sàng chỉ từ tin kết nối; phải kiểm tra cả nguồn.

Khi lần chạy thử thành công, bạn có thể **tắt máy tính**. Không cần chạy `npm start` hoặc Docker.

## Lịch đọc và chi phí

- GitHub đọc mỗi **4 giờ**, tại phút 17; theo giờ VN: 03:17, 07:17, 11:17, 15:17, 19:17, 23:17. Có thêm lần đọc **Chủ Nhật 18:17** để chuẩn bị bảng 19:00.
- Nếu lần 18:17 bị trễ, Worker có thể dùng ảnh/lịch hợp lệ đã lấy trước đó. Nếu không có ảnh khớp dữ liệu, sẽ chờ và thử lại trong tối Chủ Nhật; không gửi ảnh của tuần khác. Hết ngày Chủ Nhật thì bảng đó hết hạn, không tự chuyển sang gửi vào thứ Hai.
- GitHub job timeout **7 phút**. Khoảng 191 lần chạy tự động trong tháng 31 ngày, tương đương khoảng 1.337 phút nếu lần nào cũng kéo dài đủ 7 phút, chưa tính tác vụ khác, chạy tay hay cách tính thời gian của nền tảng. Thực tế cần xem usage sau khi triển khai.
- GitHub Free hiện có 2.000 phút/tháng cho repo riêng tư. Hạn mức dùng chung với các repo khác của tài khoản. Nên đặt ngân sách Actions có chặn sử dụng trả phí, hoặc không cấu hình phương thức thanh toán cho phần vượt hạn mức.
- Cloudflare cron một phút/lần khoảng 1.440 lượt/ngày; bản thân số lượt gọi nằm dưới 100.000 lượt/ngày của Workers Free. D1/KV, CPU và các dịch vụ khác có hạn mức riêng. Mã được thiết kế nhẹ nhưng **chưa đo CPU/quota trên tài khoản thực**, nên không cam kết miễn phí vô điều kiện.
- Chọn các gói Free, theo dõi Usage sau chạy thử. Không cần Cloudflare Browser Run, Workers Paid, AI API hoặc VPS. Nếu vượt giới hạn miễn phí, cần giảm tải hoặc dịch vụ có thể ngừng chạy.

## Độ mới dữ liệu và xử lý trễ

Lịch có thể thay đổi giữa hai lần đọc, tức bot có thể chậm phát hiện gần 4 giờ cộng độ trễ GitHub. Đặt nhắc 90 phút không loại bỏ hạn chế đó.

- Sau **8 giờ** không cập nhật thành công, hoặc bộ đọc báo lỗi: cảnh báo nguồn.
- Lịch đã lưu chưa quá **24 giờ** vẫn có thể được nhắc, kèm nhãn dữ liệu cũ/lỗi và thời điểm đọc nguồn.
- Quá **24 giờ**: ngừng gửi nhắc sự kiện từ nguồn đó, tiếp tục cảnh báo kiểm tra trực tiếp.
- Bảng tuần chỉ gửi khi nguồn không báo lỗi và dữ liệu không quá 8 giờ; ảnh phải khớp phiên bản lịch.
- Thay đổi/hủy tin sẽ xóa nhắc cũ chưa gửi và tính lại nhắc mới. Nếu bảng đã gửi mà lịch đổi, bot gửi thông báo cập nhật bằng chữ; không gửi lại cả bảng liên tục.
- Có chống gửi trùng bằng D1 và lease. Trường hợp Telegram đã nhận nhưng phản hồi/ghi nhận bị mất vẫn có thể lặp tin; không cam kết exactly-once.
- Bot không khóa MT5, không đóng lệnh và không xác nhận “được giao dịch trở lại”. Việc khớp SL/TP trong cửa sổ hạn chế vẫn là vấn đề cần tự quản lý.

## Xem trạng thái và sửa lỗi

- **GitHub Actions đỏ:** mở run mới nhất. HTTP 401 thường do hai `INGEST_SECRET` khác nhau. HTTP 409 có thể là bản lịch cũ hoặc lệch phiên bản ảnh; chạy lại workflow. Lỗi FTMO/CAPTCHA/định dạng: kiểm tra nguồn thực tế; không có cơ chế vượt CAPTCHA.
- **Có dữ liệu mà không nhận Telegram:** kiểm tra ba secret Cloudflare và đã bấm Start với bot chưa. Chạy lại workflow với `test_telegram=true`.
- **Worker báo thiếu bảng/database:** kiểm tra D1/KV binding và đã chạy schema SQL chưa.
- **Theo dõi Worker:** Cloudflare Dashboard → Workers & Pages → worker này → Logs/Metrics hoặc `npx wrangler tail` khi chẩn đoán. Không cần mở lệnh này thường xuyên.
- `GET /status` yêu cầu header `Authorization: Bearer <INGEST_SECRET>`; trả thời điểm đọc, lỗi và phiên bản nguồn. Không đặt khóa trong query URL.
- Repo công khai có thể bị GitHub tự tắt lịch sau thời gian không hoạt động theo chính sách của họ; hướng dẫn này dùng repo riêng tư. Kiểm tra Actions định kỳ, không coi miễn phí là cam kết hoạt động vĩnh viễn.
- Muốn tạm dừng: vô hiệu hóa workflow GitHub và xóa cron của Worker. Xóa cron trong `wrangler.jsonc` rồi deploy nếu cần dừng lâu dài.

## Nâng cấp từ v0.2

Đây là bộ cloud mới, không import JSON n8n. Sau khi thử cloud thành công, tắt workflow n8n cũ để tránh hai bot cùng gửi. Không xóa dữ liệu cũ nếu còn cần kiểm tra.

Thư mục `collector/` chỉ chạy trên GitHub; `worker/` chạy Cloudflare; `shared/` chứa bộ đọc/định dạng dùng chung. Ảnh được tạo bằng mã HTML/CSS, không dùng image AI.

## Kiểm thử đã thực hiện

15 kiểm thử cục bộ với Node.js/SQLite thật và Telegram/KV giả lập: nhắc 90 phút, qua 0 giờ/tuần/năm, lọc Restricted event, GMT của bảo trì, bảng tuần tới, thay đổi/hủy tin, khóa lease chống trùng, API có xác thực, HTTP 429 và gửi ảnh đúng phiên bản. Chạy bằng `node --test` với Node.js 24.

Định dạng nguồn FTMO đã được kiểm tra ở các phiên bản trước. **Chưa triển khai trên Cloudflare/GitHub thật, chưa gửi Telegram thật từ gói cloud, chưa đo CPU trên Workers Free.** Cần chạy thử bằng tài khoản của bạn; bộ kiểm thử mô phỏng D1 không thay thế kiểm thử runtime Cloudflare.

Nguồn tài liệu kiểm tra ngày 19/09/2026:

- [FTMO news restrictions](https://ftmo.com/en/faq/can-i-trade-news/)
- [FTMO Calendar](https://ftmo.com/en/calendar/) và [Trading Updates](https://ftmo.com/en/trading-updates/)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 setup](https://developers.cloudflare.com/d1/get-started/) và [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
