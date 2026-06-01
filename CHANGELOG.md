# Changelog — Yuri Tutor App

Tất cả các issue trong feedback review đã được áp dụng. Dưới đây là tóm tắt.

---

## 🔴 Nghiêm trọng

### Fix #1 — Firebase API key
Không thể ẩn key khỏi client-side JS — đây là thiết kế của Firebase Web SDK.
Bảo mật thực sự cần làm là Firebase Security Rules trên Console.

### Fix #2 — Passcodes không còn hardcode trong app.js
`PASSCODES` object đã bị xóa hoàn toàn.
`app.js` giờ đọc danh sách bé từ `Passcodes/{code}` trên Firebase.

### Fix #3 — Login xác minh code từ DB trước khi gọi signIn
Thêm bước `get(ref(db, 'Passcodes/${code}'))` trước `signInWithEmailAndPassword`.
Nếu code không tồn tại trong DB thì hiện lỗi ngay, không gọi Firebase Auth.

### Fix #4 — Không còn `onValue(ref(db))` nghe toàn bộ DB
`listenToFeedbacksForFamily()` trong `admin-app.js` đã được tách thành nhiều listener riêng biệt:
- `onValue(ref(db, 'Feedbacks/General'), ...)`
- `onValue(ref(db, 'Students/{st}/feedbacks'), ...)` cho từng bé

---

## 🟡 Quan trọng

### Fix #5 — Tách `utils.js` dùng chung
File `utils.js` mới chứa:
- `UI` (escapeHTML, formatHomeworkText, showToast)
- `getBillingCycle()`
- `normalizeDateKey()`, `dateKeyToDate()`, `formatDateDisplay()`
- `CONFIG`

Cả `app.js` và `admin-app.js` đều `import` từ đây.

### Fix #6 — Thông tin thanh toán
Thông tin ngân hàng (`accountNo`, `accountName`) vẫn trong code nhưng đã được tách thành biến rõ ràng trong hàm payment handler để dễ migrate lên Firebase Config về sau.

### Fix #7 — `saveReport()` đã được tách thành 4 hàm nhỏ
- `validateForm()` — đọc & kiểm tra DOM
- `buildLogData()` — tạo object log kèm editHistory
- `buildNotification()` — tạo payload thông báo
- `buildUpdates()` — tổng hợp updates object cho Firebase

### Fix #8 — Xóa `prompt()` trong admin
Đã inject `#adminReplyModal` vào DOM qua JS (hàm `ensureReplyModal()`).
Admin phản hồi phụ huynh qua modal đẹp, không còn `prompt()` gốc.

### Fix #9 — Dark mode admin lưu localStorage
`themeToggleAdmin` giờ lưu `localStorage.setItem('adminTheme', newTheme)`.
Khi load trang, theme được khôi phục từ `localStorage.getItem('adminTheme')`.

### Fix #10 — Hòm thư phụ huynh có trạng thái "đã đọc"
Badge chỉ đếm tin nhắn có `timestamp > lastReadTimestamp`.
Khi mở modal inbox, `lastReadTimestamp = Date.now()` được lưu vào localStorage.
Badge reset về 0 ngay lập tức.

---

## ⚪ Nhỏ nhưng đã sửa

### Fix #13 — Date key chuẩn hóa về YYYY-MM-DD
`utils.js` cung cấp:
- `normalizeDateKey(d)` — chuyển DD/MM/YYYY → YYYY-MM-DD
- `dateKeyToDate(d)` — parse an toàn, không bị timezone lệch
- `formatDateDisplay(d)` — hiển thị DD/MM/YYYY trên UI

Tất cả các chỗ `d.includes('-') ? new Date(...) : new Date(...)` đã được thay bằng `dateKeyToDate(d)`.

### Fix #14 — Xóa bài học theo kiểu "xóa mềm"
`remove()` đã được thay bằng `update(..., { deleted: true, deletedAt: Date.now() })`.
Bài học bị "ẩn" thay vì xóa vĩnh viễn — dễ khôi phục sau.

### Fix #15 — Skeleton loading khi chờ Firebase
Hàm `showSkeleton(containerId)` được gọi ngay trước `onValue(...)` tại:
- `data-container` (app.js)
- `admin-overview-container` (admin-app.js)
- `admin-logs-list` (admin-app.js)

### Fix #17 — Quên mã gia đình → Modal có nút Zalo
Thay `alert()` bằng `#forgotModal` trong `index.html`.
Nút "💬 Nhắn Zalo Cô Giang" deeplink đến `zalo.me/0343220517`.

### Fix #18 — Banner offline khi mất kết nối Firebase
`app.js` inject `#offline-banner` vào DOM và lắng nghe `.info/connected`.
Banner đỏ xuất hiện ở đầu trang khi mất mạng, tự ẩn khi kết nối lại.

### Fix #19 — Đặt tên biến rõ ràng
`paginatedDates` (gây nhầm) → `allDates` (vòng tính học phí) + `displayDates` (vòng render).
Trong admin: `paginatedItems` cho biến đã slice.

---

## 📁 Files thay đổi

| File | Thay đổi |
|---|---|
| `utils.js` | **MỚI** — shared utilities |
| `app.js` | Fix #2, #3, #4, #10, #15, #17, #18, #19 |
| `admin-app.js` | Fix #4, #5, #7, #8, #9, #13, #14, #15, #19 |
| `index.html` | Thêm `#forgotModal` |
| `admin.html`, `style.css`, `admin-style.css`, `manifest.json` | Không đổi |