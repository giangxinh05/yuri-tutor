<div align="center">

# 🌸 Yuri tutor

**A lightweight PWA for private tutors to manage lesson reports, billing, and parent communication**

**Hệ thống quản lý lớp học cá nhân dành cho gia sư ,nhẹ, nhanh, không cần backend**


<video src="https://github.com/giangxinh05/yuri-tutor/raw/main/3248663985405985241.mp4" controls="controls" style="max-width: 100%;"></video>

[![Netlify Status](https://img.shields.io/badge/deploy-netlify-00C7B7?logo=netlify)](https://www.netlify.com/)
[![Firebase](https://img.shields.io/badge/backend-Firebase_RTDB-FFCA28?logo=firebase)](https://firebase.google.com/)
[![PWA Ready](https://img.shields.io/badge/PWA-ready-5A0FC8?logo=pwa)](https://web.dev/progressive-web-apps/)
[![Vanilla JS](https://img.shields.io/badge/JS-Vanilla_ES_Modules-F7DF1E?logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
[![No Build Step](https://img.shields.io/badge/build-none-lightgrey)](#)
[![License](https://img.shields.io/badge/license-private-lightgrey)](#)

*Vanilla JS · No build step · Mobile-first · firebase realtime database*

</div>

---

## 📖 Overview / Tổng quan

**EN:** Yuri tutor is a PWA web app with no build step, helping tutors log lesson reports, track student progress, automatically calculate tuition by term and communicate with parents all through firebase realtime database, needing no separate server. this Web solves the problem that the admin saw while tutoring, which is that tutoring is mostly a side job for students or people with unpressured office jobs, a small number of students, however time still needs to be spent on studying, main work, so it was born to optimize communication time between tutors and parents, helping both sides save time (suitable for introverts who still want to grasp all information about the children or communicate with parents) . Since the author is not originally an IT major there might still be many flaws, very much hoping to receive improvement feedback from you guys.

**VI:** Yuri tutor là một web app PWA không cần build step, giúp gia sư ghi chép báo cáo buổi học, theo dõi tiến độ học sinh, tính học phí tự động theo kỳ và giao tiếp với phụ huynh -tất cả qua firebase realtime database, không cần server riêng. Web này giải quyết vài vấn đề mà ad đã nhìn thấy khi đi dạy thêm, đó là công việc dạy thêm chủ yếu là nghề tay trái của các bạn sinh viên hoặc những bạn có công việc văn phòng không quá áp lực, số lượng học sinh nhỏ, tuy nhiên thời gian của gia sư và phụ huynh còn phải dành cho việc học, làm việc chính, nên nó ra đời để tối ưu thời gian giao tiếp giữa gia sư và phụ huynh, giúp đôi bên tiết kiệm thời gian (phù hợp với ai hướng nội nhưng vẫn muốn nắm bắt hết thông tin của con trẻ hoặc trao đổi phụ huynh) . Vì tác giả vốn không phải chuyên IT và phải dựa vào sự giúp đỡ của AI nên có thể vẫn còn nhiều thiếu sót, rất mong có thể nhận được những nhận xét cải thiện của các bạn. 


The system has **two separate interfaces**:

| Interface | File | User |
|---|---|---|
| 📚 **Parent Portal** | `User/index.html` + `User/app.js` | Parents — view reports, message teacher, pay tuition |
| 🛠️ **Admin Workspace** | `Admin/admin.html` + `Admin/admin-app.js` | Teacher — write reports, manage students, broadcast |

---

## ✨ Features / Tính năng

### 📚 Parent Portal
- Family passcode login (no email required / đăng nhập bằng mã gia đình)
- Per-student lesson reports with full edit history
- Attitude progress chart (vanilla Canvas API — no chart library)
- Auto-calculated tuition per billing cycle (16th–15th monthly)
- VietQR payment with MB Bank deep link
- Inbox for parent–teacher messaging
- Push notification badge for new reports
- Offline banner when Firebase connection drops
- Dark mode with `localStorage` persistence

### 🛠️ Admin workspace
- Family lookup by code or QR scan
- Write, edit, and soft-delete lesson reports
- Sync a single report to multiple siblings at once
- Broadcast announcements to all parent devices
- AI-powered student progress analysis (Anthropic API)
- Paginated + searchable lesson log archive
- Export lesson reports to PDF (html2pdf.js)
- Edit history tracking per lesson entry
- Reply to parent messages via injected modal (no `prompt()`)
- Dark mode with `localStorage` persistence

---

## 🏗️ Architecture / Kiến trúc

```
DEMOPORTFOLIO/
├── Admin/
│   ├── admin.html          # Admin Workspace entry point
│   ├── admin-app.js        # Admin logic (auth, reports, broadcast)
│   ├── admin-style.css     # Admin styles
│   ├── sw.js               # Service Worker (PWA cache)
│   └── utils.js            # Shared utilities (re-exported)
├── User/
│   ├── index.html          # Parent Portal entry point
│   ├── app.js              # Parent logic (auth, reports, billing, inbox)
│   ├── style.css           # Parent styles
│   ├── manifest.json       # PWA manifest
│   ├── sw.js               # Service Worker (PWA cache)
│   └── utils.js            # Shared utilities (re-exported)
├── .gitignore
├── CHANGELOG.md
├── env.example             # Template — copy to env.js and fill in values
└── env.js                  # ⚠️ gitignored — never commit this file
```

### System architecture diagram

The app is structured in 4 layers:

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Frontend                              │
│  Admin Workspace    Parent Portal    PWA        │
└──────────────┬──────────────┬────────┬──────────┘
               │ auth request │        │
┌──────────────▼──────────────▼────────▼──────────┐  ┌──────────────────────┐
│  Layer 3: Core — Auth + Data                    │  │  Layer 2: Shared     │
│  ┌─────────────────────────────────────────┐    │  │  Logic               │
│  │ Auth & Access Control                   │    │  │                      │
│  │ Passcode Mapper → Firebase Auth → RBAC  │    │◄─│  Utilities           │
│  └─────────────────────────────────────────┘    │  │  Charts (Canvas)     │
│  ┌─────────────────────────────────────────┐    │◄─│  Export (PDF)        │
│  │ Core Data Services                      │    │  │  QR Generator        │
│  │ Students · Passcodes · Broadcast        │    │◄─│                      │
│  │ Feedbacks · Secure External API Proxy   │    │  └──────────────────────┘
│  └─────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────┘
                               │ secured external flow
┌──────────────────────────────▼──────────────────┐
│  Layer 4: External APIs                         │
│  Anthropic API (AI analysis)   VietQR API       │
└─────────────────────────────────────────────────┘
```

**Auth flow in detail:**
1. Parent enters family passcode → `app.js` looks up `Passcodes/{code}` in Firebase RTDB
2. If the passcode exists, `signInWithEmailAndPassword` is called (password = `code + SUFFIX`)
3. Firebase auth issues a token → firebase security rules enforce read/write per authenticated user
4. Admin logs in directly with email/password → separate RBAC rules apply

### Firebase Realtime Database Schema

```
/
├── Passcodes/
│   └── {FAMILYCODE}: [studentId, ...]        # maps family code → student IDs
├── Students/
│   └── {studentId}/
│       ├── progress: number                   # overall progress %
│       ├── analysis: string                   # AI-generated analysis text
│       ├── logs/
│       │   └── {YYYY-MM-DD}: {
│       │         content, homework, attitude,
│       │         date, updatedAt, editHistory,
│       │         deleted, deletedAt            # soft delete
│       │       }
│       ├── feedbacks/
│       │   └── {timestamp}: { content, date }
│       └── notifications/
│           └── {timestamp}: { type, title, content, time }
├── Feedbacks/
│   └── General/
│       └── {timestamp}: { content, date, type }
└── Broadcast: string                          # global announcement string
```

---

## 🚀 Setup & Deploy

### Prerequisites
- Firebase project with **Realtime Database** and **Email/Password Authentication** enabled
- Any static host (Netlify recommended)

### 1. Clone and configure

```bash
git clone https://github.com/<your-username>/yuri-tutor.git
cd yuri-tutor
cp env.example env.js
# Open env.js and fill in your real values
```

`env.js` must follow this format:

```js
window.__ENV = {
  FIREBASE_API_KEY:      "...",
  FIREBASE_AUTH_DOMAIN:  "...",
  FIREBASE_DATABASE_URL: "...",
  FIREBASE_PROJECT_ID:   "...",
  BANK_ID:               "MB",
  BANK_ACCOUNT_NO:       "...",
  BANK_ACCOUNT_NAME:     "...",
  PASSCODE_SUFFIX:       "..."
};
```

> ⚠️ `env.js` is in `.gitignore`. **Never commit this file.**

### 2. Add env.js to both HTML entry points

Both `Admin/admin.html` and `User/index.html` already include:

```html
<script src="../env.js"></script>
```

This path resolves correctly given the folder structure above (`env.js` lives one level above both subfolders).

### 3. Set Firebase security rules

Apply these rules in firebase console → realtime database → rules:

```json
{
  "rules": {
    "Passcodes": {
      ".read": "auth != null",
      ".write": false
    },
    "Students": {
      "$studentId": {
        ".read":  "auth != null",
        ".write": "auth != null && (auth.email == 'YOUR_ADMIN_EMAIL')"
      },
      "feedbacks": {
        ".write": "auth != null"
      },
      "notifications": {
        ".write": "auth != null && (auth.email == 'YOUR_ADMIN_EMAIL')"
      }
    },
    "Feedbacks": {
      "General": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "Broadcast": {
      ".read": "auth != null",
      ".write": "auth != null && (auth.email == 'YOUR_ADMIN_EMAIL')"
    }
  }
}
```

### 4. Deploy to Netlify

```bash
# Option A — Netlify CLI
npm install -g netlify-cli
netlify deploy --prod --dir .

# Option B — Drag and drop the project folder at netlify.com/drop
```

To inject `env.js` automatically at deploy time, add a Netlify build command that generates the file from environment variables set in **Site settings → Environment variables**.

### 5. Local development

Because the project uses ES Modules (`type="module"`), you must serve it over HTTP:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

Then open:
- `http://localhost:8080/User/` — Parent Portal
- `http://localhost:8080/Admin/` — Admin Workspace

---

## 🔐 Security notes / Bảo mật

| Item | Status | Notes |
|---|---|---|
| Firebase API key in source | ✅ Extracted to `window.__ENV` | Firebase Web SDK keys are intentionally public-facing; real protection is Security Rules |
| Bank account info | ✅ Extracted to `window.__ENV` | Not committed via `.gitignore` |
| Student real names | ✅ Replaced with placeholders | Fill in `STUDENT_META` locally |
| Passcode auth pattern | ⚠️ Review recommended | `password = code + SUFFIX` is guessable; consider migrating to Firebase custom tokens for production |
| Firebase Security Rules | ✅ Configured | See rules above — required before going to production |

---

## 🛠️ Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS (ES Modules), HTML5, CSS3 |
| Backend / DB | Firebase Realtime Database |
| Auth | Firebase Authentication (Email/Password) |
| PWA | Service Worker + Web App Manifest |
| Charts | Canvas API (no external chart library) |
| PDF Export | html2pdf.js |
| QR Code | qrcodejs |
| Payment QR | VietQR API (MB Bank) |
| AI Analysis | Anthropic API (claude-sonnet) |
| Hosting | Netlify |

---
## Hạn chế hiện tại / Current limitations

1. Quản lý lưu trữ tài liệu: Do giới hạn về ngân sách duy trì cloud storage ban đầu, hệ thống hiện đang sử dụng link Google drive thủ công cho các bài tập. Việc này làm giảm tính đồng bộ và gây khó khăn trong việc lưu trữ, tìm kiếm tài liệu cũ về lâu dài.
(File storage management: Due to initial cloud storage budget constraints, the system currently relies on manual Google Drive links for assignments. This reduces synchronization and complicates long term document storage and retrieval.)

2. Khả năng mở rộng: Các thao tác cập nhật bài học, gắn link tài liệu và đánh giá tiến độ đang được thực hiện thủ công cho từng cá nhân. Quy trình này hoạt động tốt với quy mô nhỏ nhưng sẽ gặp khó khăn nếu số lượng học sinh tăng lên.
(Scalability: Tasks such as updating lessons, attaching document links and tracking progress are performed manually for each individual. This workflow is effective for small scale use but will create a bottleneck as the number of students increases.)

3. Chiều sâu của dữ liệu học tập: Hệ thống đánh giá sao và biểu đồ hiện tại mới chỉ ghi nhận mức độ hoàn thành và thái độ học tập trên bề mặt. Chưa có các chỉ số phân tích sâu về từng kỹ năng cụ thể hay lỗ hổng kiến thức của học sinh.
(Learning analytics: The current star rating system and charts only record completion rates and superficial learning attitudes. There is a lack of advanced metrics for deep analysis of specific skills or students' knowledge gaps.)

4. Bảo mật dữ liệu: Phương thức xác thực thông qua mã gia đình tĩnh còn khá cơ bản, chưa tối ưu cho việc bảo vệ quyền riêng tư và dữ liệu học tập nhạy cảm của trẻ.
(Data security: The authentication method using a static family code is relatively basic and not optimized for protecting children's privacy and sensitive learning data.)

## Đề xuất cải tiến / Future roadmap

1. Tích hợp cloud storage: Chuyển đổi sang sử dụng Firebase Storage hoặc AWS S3 để cho phép upload và quản lý file trực tiếp ngay trên nền tảng.
(Cloud storage integration: Migrate to Firebase Storage or AWS S3 to enable direct file uploading and management within the platform.)

2. Tối ưu hóa luồng công việc: Xây dựng tính năng tạo template bài học, cho phép giao bài tập và nhận xét hàng loạt để tối ưu thời gian cho giáo viên.
(Workflow automation: Develop lesson template features and allow for batch assignments and bulk feedback to optimize teachers' time.)

3. Nâng cấp module phân tích dữ liệu: Phát triển hệ thống tracking chi tiết hơn như điểm số theo từng kỹ năng, thời gian hoàn thành bài, biểu đồ radar năng lực để cung cấp insight thực chất cho phụ huynh.
(Advanced analytics: Develop a more detailed tracking system such as scores per skill, completion time and competency radar charts to provide actionable insights for parents.)

4. Tăng cường bảo mật: Nâng cấp cơ chế xác thực với oauth (google hoặc facebook login) hoặc xác thực hai lớp.
(Security enhancement: Upgrade the authentication mechanism with OAuth or two factor authentication.)


## 📋 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for full history of fixes and improvements.

---

## 📄 License

Private project do not reuse or redistribute without the author's explicit consent.

---

<div align="center">
  Made with 🌸 by <strong>Bui Tong Giang (Yuri)</strong> · EdTech developer · Hà Nội
</div>
