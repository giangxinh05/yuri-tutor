import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, get, push, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { CONFIG, UI, getBillingCycle, dateKeyToDate, formatDateDisplay } from './utils.js';

// ─── Firebase Config ──────────────────────────────────────────────────────────
// Inject at build time or replace with your own project values.
// See env.example for required variables.
const firebaseConfig = {
    apiKey:      window.__ENV?.FIREBASE_API_KEY      || "REPLACE_ME",
    authDomain:  window.__ENV?.FIREBASE_AUTH_DOMAIN  || "REPLACE_ME",
    databaseURL: window.__ENV?.FIREBASE_DATABASE_URL || "REPLACE_ME",
    projectId:   window.__ENV?.FIREBASE_PROJECT_ID   || "REPLACE_ME"
};

const app  = initializeApp(firebaseConfig);
const db   = getDatabase(app);
const auth = getAuth(app);

const ADMIN_CONFIG = { ...CONFIG, LOGS_PER_PAGE: 5 };

// ─── State ────────────────────────────────────────────────────────────────────
let currentFetchedLogs      = {};
let currentActiveFamilyCode = '';
let currentStudentsInFamily = [];
let filteredLogsArray       = [];
let currentPage             = 1;
let _unsubs                 = [];   // FIX: track all onValue listeners

// ─── Student metadata ─────────────────────────────────────────────────────────
// Map student IDs (Firebase keys) to display info.
// Keep this file out of version control if names are real.
// Alternatively, load this from Firebase: Students/{id}/meta
const STUDENT_META = {
    "Nam":  { fullName: "Gojo", avatar: "https://i.pinimg.com/736x/35/09/26/35092624aace413e6fa28e63f52d95ad.jpg" },
    "Minh": { fullName: "Geto", avatar: "https://i.pinimg.com/736x/f0/61/e2/f061e252d59657c5167d9c729de07f0c.jpg" }
};

function clearUnsubs() {
    _unsubs.forEach(fn => { try { fn(); } catch(e) {} });
    _unsubs = [];
}

function adminShowToast(msg, isError = false) { UI.showToast(msg, isError); }

function switchScreen(screenId) {
    ['admin-login-screen','admin-search-family-screen','admin-family-overview-screen','admin-editor-screen']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = id === screenId
                ? (screenId === 'admin-editor-screen' ? 'grid' : 'block')
                : 'none';
        });
}

function showSkeleton(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const skeletonItem = `<div style="background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);
        background-size:200% 100%;animation:shimmer 1.2s infinite;border-radius:16px;height:90px;margin-bottom:15px;"></div>`;
    el.innerHTML = skeletonItem.repeat(4) +
        `<style>@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>`;
}

// ─── Chart (Canvas API) ───────────────────────────────────────────────────────
function renderProgressChart(canvasId, logsObj, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 300, H = canvas.clientHeight || 160;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const validKeys = Object.keys(logsObj).filter(k => !logsObj[k].deleted).sort().slice(-10);
    if (validKeys.length < 2) {
        ctx.fillStyle = '#b2bec3'; ctx.font = '13px Nunito,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Cần ít nhất 2 buổi để hiển thị biểu đồ', W/2, H/2);
        return;
    }

    const ratingMap = { '⭐⭐⭐⭐⭐': 5, '⭐⭐⭐⭐': 4, '⭐⭐⭐': 3 };
    const points = validKeys.map(k => {
        const l = logsObj[k];
        let score = 3;
        for (const [star, val] of Object.entries(ratingMap)) {
            if ((l.attitude || '').startsWith(star)) { score = val; break; }
        }
        return { label: formatDateDisplay(k).slice(0, 5), score };
    });

    const pad = { l:36, r:16, t:20, b:44 };
    const gW = W - pad.l - pad.r, gH = H - pad.t - pad.b;
    const stepX = gW / (points.length - 1);

    // Grid
    for (let i = 1; i <= 5; i++) {
        const y = pad.t + gH - ((i - 1) / 4) * gH;
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + gW, y); ctx.stroke();
        ctx.fillStyle = '#adb5bd'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(i + '⭐', pad.l - 4, y + 4);
    }

    // Fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + gH);
    grad.addColorStop(0, color + '44'); grad.addColorStop(1, color + '05');
    ctx.beginPath();
    points.forEach((p, i) => {
        const x = pad.l + i * stepX, y = pad.t + gH - ((p.score - 1) / 4) * gH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.l + (points.length - 1) * stepX, pad.t + gH);
    ctx.lineTo(pad.l, pad.t + gH); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // Line
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    points.forEach((p, i) => {
        const x = pad.l + i * stepX, y = pad.t + gH - ((p.score - 1) / 4) * gH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots + labels
    points.forEach((p, i) => {
        const x = pad.l + i * stepX, y = pad.t + gH - ((p.score - 1) / 4) * gH;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = '#636e72'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(p.label, x, H - pad.b + 15);
    });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    if (user) switchScreen('admin-search-family-screen');
    else       switchScreen('admin-login-screen');
});

document.getElementById('btnLoginAdmin').addEventListener('click', () => {
    const email = document.getElementById('adminEmail').value;
    const pass  = document.getElementById('adminPass').value;
    if (!email || !pass) return adminShowToast('Nhập đầy đủ email và mật khẩu!', true);
    signInWithEmailAndPassword(auth, email, pass)
        .catch(() => adminShowToast('Sai email hoặc mật khẩu!', true));
});

document.getElementById('btnLogoutAdmin').addEventListener('click', () => {
    clearUnsubs();
    signOut(auth);
});

const savedAdminTheme = localStorage.getItem('adminTheme');
if (savedAdminTheme) document.documentElement.setAttribute('data-theme', savedAdminTheme);

document.getElementById('themeToggleAdmin').addEventListener('click', () => {
    const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('adminTheme', newTheme);
});

// ─── Search family ────────────────────────────────────────────────────────────
document.getElementById('btnSearchFamily').addEventListener('click', () => {
    const code = document.getElementById('searchFamilyCode').value.trim().toUpperCase();
    if (!code) return adminShowToast('Vui lòng nhập mã!', true);

    get(ref(db, `Passcodes/${code}`)).then(snap => {
        if (!snap.exists()) return adminShowToast('Mã gia đình không tồn tại!', true);
        currentActiveFamilyCode = code;
        currentStudentsInFamily = snap.val();
        document.getElementById('displayFamilyCode').textContent = code;

        const qrContainer = document.getElementById('qrCodeContainer');
        qrContainer.innerHTML = '';
        new QRCode(qrContainer, {
            text: `https://yuri-tutor-report.web.app/?code=${code}`,
            width: 128, height: 128
        });

        renderFamilyOverview(currentStudentsInFamily);
        switchScreen('admin-family-overview-screen');
    }).catch(() => adminShowToast('Lỗi kết nối Firebase!', true));
});

document.getElementById('btnBackToSearch').addEventListener('click', () => {
    clearUnsubs();
    switchScreen('admin-search-family-screen');
});

document.getElementById('btnGoToWriteReport').addEventListener('click', () => {
    const select = document.getElementById('studentId');
    select.innerHTML = '';
    currentStudentsInFamily.forEach(st => {
        const meta = STUDENT_META[st] || { fullName: `Bé ${st}` };
        const opt  = document.createElement('option');
        opt.value = st; opt.textContent = `👦 ${meta.fullName}`;
        select.appendChild(opt);
    });
    document.getElementById('logDate').valueAsDate = new Date();
    generateBillingCycles();
    loadStudentLogs();
    listenToFeedbacksForFamily();
    loadBroadcast();
    switchScreen('admin-editor-screen');
});

document.getElementById('btnBackToOverview').addEventListener('click', () => {
    renderFamilyOverview(currentStudentsInFamily);
    switchScreen('admin-family-overview-screen');
});

// ─── Family Overview ──────────────────────────────────────────────────────────
function renderFamilyOverview(studentsArray) {
    showSkeleton('admin-overview-container');
    const promises = studentsArray.map(id => get(ref(db, `Students/${id}`)));
    Promise.all(promises).then(snaps => {
        const all = {};
        snaps.forEach((snap, i) => {
            if (snap.exists()) all[studentsArray[i]] = snap.val();
        });

        const container = document.getElementById('admin-overview-container');
        if (Object.keys(all).length === 0) {
            container.innerHTML = '<p>Chưa có dữ liệu học tập.</p>'; return;
        }

        const cycle = getBillingCycle();
        let allDatesInCycle  = new Set();
        let studentCardsHtml = '';
        const totalClassesExpected = 8;

        studentsArray.forEach((id, index) => {
            const s = all[id]; if (!s) return;
            const meta   = STUDENT_META[id] || { fullName: `Bé ${id}`, avatar: 'https://via.placeholder.com/60' };
            const isEven = index % 2 === 0;
            const color  = isEven ? '#6c5ce7' : '#00b894';
            const grad   = isEven ? 'linear-gradient(90deg,#6c5ce7,#a29bfe)' : 'linear-gradient(90deg,#00b894,#55efc4)';
            const chartId = `ov_chart_${id}`;

            let logsHtml = '';
            if (s.logs) {
                const allDates = Object.keys(s.logs).filter(k => !s.logs[k].deleted).sort().reverse();
                allDates.forEach(d => {
                    const logDate = dateKeyToDate(d);
                    if (logDate >= cycle.start && logDate <= cycle.end) allDatesInCycle.add(d);
                });
                allDates.slice(0, 3).forEach(d => {
                    const l = s.logs[d];
                    logsHtml += `
                    <div class="log-box">
                        <div style="display:flex;justify-content:space-between;align-items:center;
                            margin-bottom:8px;border-bottom:1px solid var(--border-color);padding-bottom:8px;">
                            <span style="font-weight:800;color:${color};">📅 ${formatDateDisplay(d)}</span>
                            <span style="font-size:0.8rem;font-weight:bold;">${UI.escapeHTML(l.attitude||'').split(' ')[0]}</span>
                        </div>
                        <div style="font-size:0.85rem;line-height:1.5;">
                            ${UI.escapeHTML(l.content||'').substring(0,100)}...
                        </div>
                    </div>`;
                });
            }

            const validLogsCount = s.logs ? Object.keys(s.logs).filter(k => !s.logs[k].deleted).length : 0;

            // Phần nhận xét admin
            const analysisHtml = `
            <div style="margin:15px 0;padding:15px;background:linear-gradient(135deg,#fff9db,#ffec99);
                border-radius:14px;border-left:4px solid #f59f00;">
                <div style="font-weight:800;color:#e67700;margin-bottom:8px;">💡 Nhận xét phân tích</div>
                <textarea id="analysis_${id}" rows="3" placeholder="Nhập nhận xét về tiến độ học tập của bé để phụ huynh xem..."
                    style="width:100%;padding:10px;border-radius:10px;border:1px solid #fcc419;
                    font-family:inherit;font-size:0.9rem;box-sizing:border-box;resize:vertical;
                    background:#fffdf0;">${UI.escapeHTML(s.analysis || '')}</textarea>
                <button onclick="saveAnalysis('${id}')" 
                    style="margin-top:8px;background:#f59f00;color:white;border:none;
                    padding:8px 18px;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;">
                    💾 Lưu nhận xét
                </button>
                ${s.analysisUpdatedAt ? `<span style="font-size:0.75rem;color:#868e96;margin-left:10px;">Đã cập nhật: ${s.analysisUpdatedAt}</span>` : ''}
            </div>`;

            studentCardsHtml += `
            <div class="student-card" style="border-top-color:${color}">
                <div class="student-header">
                    <img src="${meta.avatar}" class="student-avatar" style="border-color:${color}">
                    <div class="student-info">
                        <h3>${meta.fullName}</h3><p>ID: ${id}</p>
                    </div>
                </div>
                <div style="display:flex;justify-content:space-between;font-weight:800;margin-bottom:8px;">
                    <span>Tiến độ</span>
                    <span style="color:${color}">${s.progress||0}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width:${s.progress||0}%;background:${grad}"></div>
                </div>

                ${validLogsCount >= 2 ? `
                <div style="margin:15px 0;">
                    <div style="font-weight:800;color:${color};margin-bottom:8px;font-size:0.9rem;">📈 Biểu đồ thái độ (${validLogsCount} buổi)</div>
                    <canvas id="${chartId}" style="width:100%;height:150px;display:block;border-radius:10px;border:1px solid var(--border-color);"></canvas>
                </div>` : ''}

                ${analysisHtml}

                <div style="font-size:0.85rem;font-weight:800;color:#636e72;margin:12px 0 8px 0;">📚 3 buổi gần nhất:</div>
                <div class="logs-container" style="max-height:280px;">${logsHtml || '<p style="color:#b2bec3;text-align:center;">Chưa có báo cáo.</p>'}</div>
            </div>`;
        });

        const totalSessions = allDatesInCycle.size;
        const billingHtml = `
        <div style="width:100%;background:linear-gradient(135deg,#ebfbee,#d3f9d8);padding:30px;
            border-radius:24px;margin-top:10px;border:2px solid #b2f2bb;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px;">
                <div>
                    <div style="font-size:1.1rem;font-weight:800;color:#2b8a3e;margin-bottom:5px;">💰 TỔNG HỌC PHÍ KỲ HIỆN TẠI</div>
                    <div>Từ ngày ${cycle.displayStart} đến ${cycle.displayEnd}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:2.2rem;font-weight:900;color:#2b8a3e">${(totalSessions * CONFIG.FEE_PER_LESSON).toLocaleString('vi-VN')} đ</div>
                    <div style="font-size:1rem;color:#5c940d;font-weight:bold;margin-top:5px;">(Đã dạy: ${totalSessions} buổi)</div>
                </div>
            </div>
        </div>`;

        container.innerHTML = `<div style="display:flex;gap:30px;flex-wrap:wrap;">${studentCardsHtml}</div>` + billingHtml;
        document.getElementById('attendanceRate').innerText =
            Math.min(100, Math.round((totalSessions / totalClassesExpected) * 100));

        // Render charts sau DOM
        studentsArray.forEach((id, index) => {
            const s = all[id]; if (!s || !s.logs) return;
            const color = index % 2 === 0 ? '#6c5ce7' : '#00b894';
            const validLogs = {};
            Object.keys(s.logs).forEach(k => { if (!s.logs[k].deleted) validLogs[k] = s.logs[k]; });
            if (Object.keys(validLogs).length >= 2) {
                requestAnimationFrame(() => renderProgressChart(`ov_chart_${id}`, validLogs, color));
            }
        });

    }).catch(err => {
        console.error('Lỗi tải overview:', err);
        adminShowToast('Lỗi lấy dữ liệu Firebase!', true);
    });
}

// Lưu nhận xét phân tích (global vì dùng inline onclick)
window.saveAnalysis = function(studentId) {
    const text = document.getElementById(`analysis_${studentId}`)?.value || '';
    update(ref(db, `Students/${studentId}`), {
        analysis: text,
        analysisUpdatedAt: new Date().toLocaleString('vi-VN')
    }).then(() => adminShowToast('Đã lưu nhận xét!'))
      .catch(() => adminShowToast('Lỗi lưu nhận xét!', true));
};

// ─── Broadcast ────────────────────────────────────────────────────────────────
function loadBroadcast() {
    const unsub = onValue(ref(db, 'Broadcast'), snap => {
        document.getElementById('broadcastMsg').value = snap.val() || '';
    });
    _unsubs.push(unsub);
}

function updateBroadcast() {
    const msg = document.getElementById('broadcastMsg').value;
    set(ref(db, 'Broadcast'), msg).then(() => {
        const ts = Date.now().toString();
        const updates = {};
        currentStudentsInFamily.forEach(st => {
            updates[`Students/${st}/notifications/${ts}`] = {
                type: 'general', title: '📢 Cô Giang thông báo chung',
                content: msg, time: new Date().toLocaleString('vi-VN')
            };
        });
        update(ref(db), updates).then(() => adminShowToast('Đã phát thông báo tới gia đình!'));
    }).catch(() => adminShowToast('Lỗi phát thông báo!', true));
}
document.getElementById('btnUpdateBroadcast').addEventListener('click', updateBroadcast);

// ─── Feedbacks ────────────────────────────────────────────────────────────────
function listenToFeedbacksForFamily() {
    // FIX: dùng object fb thay vì counter để tránh race condition
    const fbData = {};  // key: path → item

    function renderFeedbacks() {
        const fb = Object.values(fbData).sort((a, b) => b.id.localeCompare(a.id));
        document.getElementById('unreadCount').innerText = fb.length;
        const listDiv = document.getElementById('admin-feedbacks-list');
        if (fb.length === 0) {
            listDiv.innerHTML = '<p style="text-align:center;color:#b2bec3;font-size:0.9rem;">Hòm thư trống.</p>';
            return;
        }
        listDiv.innerHTML = fb.map(f => {
            const borderColor = f.type === 'Thanh toán' ? '#00b894' : '#0984e3';
            return `
            <div style="background:var(--card-bg);border-radius:12px;padding:12px;
                border-left:4px solid ${borderColor};
                border-top:1px solid var(--border-color);border-right:1px solid var(--border-color);
                border-bottom:1px solid var(--border-color);">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
                    <strong style="color:${borderColor};font-size:0.85rem;">📌 ${f.type}</strong>
                    <span style="font-size:0.75rem;color:#636e72;">${f.date || ''}</span>
                </div>
                <div style="font-size:0.95rem;margin-bottom:8px;">
                    ${UI.escapeHTML(f.content || '').replace(/\n/g,'<br>')}
                </div>
                <div style="display:flex;justify-content:flex-end;gap:5px;">
                    <button class="btn-sm" style="background:#00b894;"
                        data-action="reply" data-studentid="${f.studentId}">Phản hồi</button>
                    <button class="btn-sm" style="background:#ff7675;"
                        data-action="delete" data-path="${f.path}">Xóa</button>
                </div>
            </div>`;
        }).join('');
    }

    // Listen to general feedbacks
    const u1 = onValue(ref(db, 'Feedbacks/General'), snap => {
        // Xóa tất cả item General cũ
        Object.keys(fbData).forEach(k => { if (fbData[k].studentId === 'General') delete fbData[k]; });
        const data = snap.val();
        if (data) {
            Object.keys(data).forEach(k => {
                const item = data[k];
                // FIX: handle nested push() structure
                const actualData = (item && item.content) ? item : (item ? Object.values(item)[0] : null);
                if (actualData && !actualData.deleted) {
                    const pathKey = `Feedbacks/General/${k}`;
                    fbData[pathKey] = {
                        id: k, type: actualData.type || 'Lịch học chung',
                        studentId: 'General', path: pathKey,
                        content: actualData.content, date: actualData.date
                    };
                }
            });
        }
        renderFeedbacks();
    });
    _unsubs.push(u1);

    currentStudentsInFamily.forEach(st => {
        const u2 = onValue(ref(db, `Students/${st}/feedbacks`), snap => {
            Object.keys(fbData).forEach(k => { if (fbData[k].studentId === st) delete fbData[k]; });
            const data = snap.val();
            if (data) {
                Object.keys(data).forEach(k => {
                    const item = data[k];
                    const actualData = (item && item.content) ? item : (item ? Object.values(item)[0] : null);
                    if (actualData && !actualData.deleted) {
                        const pathKey = `Students/${st}/feedbacks/${k}`;
                        fbData[pathKey] = {
                            id: k, type: `Bé ${st}`,
                            studentId: st, path: pathKey,
                            content: actualData.content, date: actualData.date
                        };
                    }
                });
            }
            renderFeedbacks();
        });
        _unsubs.push(u2);
    });
}

let replyTargetStudentId = null;

function ensureReplyModal() {
    if (document.getElementById('adminReplyModal')) return;
    const modal = document.createElement('div');
    modal.id = 'adminReplyModal';
    modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(0,0,0,0.5);z-index:2000;justify-content:center;align-items:center;';
    modal.innerHTML = `
        <div style="background:var(--card-bg);padding:30px;border-radius:20px;
            width:92%;max-width:420px;box-shadow:0 20px 40px rgba(0,0,0,0.2);">
            <h3 style="margin:0 0 15px 0;color:var(--primary);">💬 Phản hồi phụ huynh</h3>
            <textarea id="adminReplyText" placeholder="Nhập nội dung phản hồi..."
                style="width:100%;height:110px;padding:12px;border-radius:12px;font-family:inherit;
                border:2px solid #e2e8f0;box-sizing:border-box;font-size:0.95rem;margin-bottom:15px;"></textarea>
            <div style="display:flex;gap:10px;">
                <button id="btnCancelReply" style="flex:1;padding:12px;border:none;border-radius:12px;
                    background:#f1f2f6;color:#2d3436;font-weight:800;cursor:pointer;">Hủy</button>
                <button id="btnSendReply" style="flex:2;padding:12px;border:none;border-radius:12px;
                    background:var(--success);color:white;font-weight:800;cursor:pointer;">GỬI PHẢN HỒI</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('btnCancelReply').onclick = () =>
        (document.getElementById('adminReplyModal').style.display = 'none');
    document.getElementById('btnSendReply').onclick = () => {
        const msg = document.getElementById('adminReplyText').value.trim();
        if (!msg) return adminShowToast('Vui lòng nhập nội dung!', true);
        const ts = Date.now();
        set(ref(db, `Students/${replyTargetStudentId}/notifications/${ts}`), {
            type: 'reply', title: '💬 Cô Giang phản hồi',
            content: msg, time: new Date().toLocaleString('vi-VN')
        }).then(() => {
            adminShowToast('Đã gửi phản hồi!');
            document.getElementById('adminReplyModal').style.display = 'none';
            document.getElementById('adminReplyText').value = '';
        }).catch(() => adminShowToast('Lỗi gửi phản hồi!', true));
    };
}

document.getElementById('admin-feedbacks-list').addEventListener('click', function(e) {
    if (e.target.tagName !== 'BUTTON') return;
    const action    = e.target.getAttribute('data-action');
    const studentId = e.target.getAttribute('data-studentid');
    const path      = e.target.getAttribute('data-path');

    if (action === 'reply') {
        if (studentId === 'General')
            return adminShowToast("Dùng 'Phát Loa Thông Báo' để trả lời lịch học chung nhé!", true);
        ensureReplyModal();
        replyTargetStudentId = studentId;
        document.getElementById('adminReplyText').value = '';
        document.getElementById('adminReplyModal').style.display = 'flex';
    } else if (action === 'delete') {
        if (confirm('Ẩn tin nhắn này?')) {
            update(ref(db, path), { deleted: true, deletedAt: Date.now() })
                .then(() => adminShowToast('Đã ẩn tin nhắn!'))
                .catch(() => adminShowToast('Lỗi xóa tin nhắn!', true));
        }
    }
});

// ─── Student logs ─────────────────────────────────────────────────────────────
let _logsUnsub = null;

function loadStudentLogs() {
    const stId = document.getElementById('studentId').value;
    if (!stId) return;
    showSkeleton('admin-logs-list');

    // FIX: hủy listener cũ trước khi đăng ký mới
    if (_logsUnsub) { _logsUnsub(); _logsUnsub = null; }

    _logsUnsub = onValue(ref(db, `Students/${stId}`), snap => {
        const data = snap.val();
        if (!data) {
            currentFetchedLogs = {};
            document.getElementById('admin-logs-list').innerHTML = '<p>Chưa có dữ liệu.</p>';
            document.getElementById('progress').value      = 0;
            document.getElementById('progressRange').value = 0;
            return;
        }
        document.getElementById('progress').value      = data.progress || 0;
        document.getElementById('progressRange').value = data.progress || 0;
        currentFetchedLogs = data.logs || {};

        // Cập nhật biểu đồ trong editor
        updateEditorChart(stId, data.logs || {});
        processLogs();
    });
}

function updateEditorChart(stId, logsObj) {
    let chartWrapper = document.getElementById('editorChartWrapper');
    if (!chartWrapper) {
        chartWrapper = document.createElement('div');
        chartWrapper.id = 'editorChartWrapper';
        chartWrapper.style.cssText = 'margin-bottom:15px;';
        const firstCard = document.querySelector('#admin-editor-screen .card');
        if (firstCard) firstCard.appendChild(chartWrapper);
    }
    const validLogs = {};
    Object.keys(logsObj).forEach(k => { if (!logsObj[k].deleted) validLogs[k] = logsObj[k]; });
    const count = Object.keys(validLogs).length;
    if (count < 2) {
        chartWrapper.innerHTML = '';
        return;
    }
    const meta = STUDENT_META[stId] || {};
    chartWrapper.innerHTML = `
        <div style="font-weight:800;color:var(--primary);margin-bottom:8px;font-size:0.85rem;">
            📈 Biểu đồ tiến độ (${count} buổi)
        </div>
        <canvas id="editorChart_${stId}" style="width:100%;height:140px;display:block;
            border-radius:10px;border:1px solid var(--border-color);"></canvas>`;
    requestAnimationFrame(() => renderProgressChart(`editorChart_${stId}`, validLogs, '#6c5ce7'));
}

// ─── Process & Paginate Logs ──────────────────────────────────────────────────
function processLogs() {
    const cycleEl = document.getElementById('cycleFilter');
    if (!cycleEl || !cycleEl.value) return;
    const cycleVal = cycleEl.value;
    const kw       = (document.getElementById('logSearch').value || '').trim().toLowerCase();
    filteredLogsArray = [];
    currentPage = 1;

    Object.keys(currentFetchedLogs).sort().reverse().forEach(k => {
        const l = currentFetchedLogs[k];
        if (l.deleted) return;
        const t = dateKeyToDate(k).getTime();
        const passC = cycleVal === 'all' ||
            (t >= parseInt(cycleVal.split('_')[0]) && t <= parseInt(cycleVal.split('_')[1]));
        const passK = !kw ||
            (l.content  || '').toLowerCase().includes(kw) ||
            (l.homework || '').toLowerCase().includes(kw) ||
            k.includes(kw);
        if (passC && passK) filteredLogsArray.push({ key: k, data: l });
    });

    document.getElementById('totalLessons').innerText = filteredLogsArray.length;
    renderPaginatedLogs();
}

function renderPaginatedLogs() {
    const start = (currentPage - 1) * ADMIN_CONFIG.LOGS_PER_PAGE;
    const paginatedItems = filteredLogsArray.slice(start, start + ADMIN_CONFIG.LOGS_PER_PAGE);
    let html = '';
    paginatedItems.forEach(item => {
        const k = item.key, l = item.data;
        const safeContent  = UI.escapeHTML(l.content  || '').replace(/\n/g, '<br>');
        const safeHomework = l.homework ? UI.escapeHTML(l.homework).replace(/\n/g, '<br>') : '';
        const safeAttitude = UI.escapeHTML(l.attitude || '');
        const editTag = l.editHistory
            ? `<button class="btn-sm" style="background:#b2bec3;padding:2px 6px;"
                onclick="window.showHistory('${k}')">🕒 Đã sửa</button>` : '';
        html += `
        <div class="log-item-card">
            <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:10px;
                    border-bottom:1px solid var(--border-color);padding-bottom:6px;">
                    <span style="font-weight:800;color:var(--primary)">📅 ${formatDateDisplay(k)} ${editTag}</span>
                    <span style="background:var(--bg);padding:2px 8px;border-radius:6px;font-size:0.75rem;font-weight:700;">
                        ${safeAttitude.split(' ')[0]}
                    </span>
                </div>
                <div style="font-size:0.9rem;margin-bottom:8px;"><strong>Nội dung:</strong><br>${safeContent}</div>
                ${safeHomework ? `<div style="font-size:0.85rem;color:#636e72;background:var(--bg);padding:8px;border-radius:8px;">
                    <strong>Link/Bài tập:</strong><br>${safeHomework}</div>` : ''}
            </div>
            <div style="text-align:right;margin-top:12px;border-top:1px dashed var(--border-color);padding-top:8px;">
                <button class="btn-sm" style="background:var(--warning);color:#2d3436"
                    data-action="edit" data-key="${k}">Sửa</button>
                <button class="btn-sm" style="background:var(--danger);margin-left:4px;"
                    data-action="delete" data-key="${k}">Xóa</button>
            </div>
        </div>`;
    });
    document.getElementById('admin-logs-list').innerHTML = html || '<p style="text-align:center;color:#b2bec3;">Trống.</p>';
    const totalPages = Math.max(1, Math.ceil(filteredLogsArray.length / ADMIN_CONFIG.LOGS_PER_PAGE));
    document.getElementById('pageInfo').innerText   = `${currentPage} / ${totalPages}`;
    document.getElementById('btnPrevPage').disabled = currentPage === 1;
    document.getElementById('btnNextPage').disabled = currentPage === totalPages;
}

window.showHistory = function(key) {
    const history = currentFetchedLogs[key]?.editHistory;
    if (!history) return;
    document.getElementById('historyContent').innerHTML = history.map((h, idx) => `
        <div style="border-bottom:1px solid var(--border-color);padding-bottom:10px;margin-bottom:10px;">
            <div style="font-size:0.8rem;color:#636e72;">Lần sửa ${idx+1} - ${new Date(h.updatedAt).toLocaleString('vi-VN')}</div>
            <div style="font-size:0.9rem;">${UI.escapeHTML(h.content||'').replace(/\n/g,'<br>')}</div>
        </div>`).join('');
    document.getElementById('historyModal').style.display = 'flex';
};

document.getElementById('admin-logs-list').addEventListener('click', function(e) {
    if (e.target.tagName !== 'BUTTON') return;
    const action = e.target.getAttribute('data-action');
    const key    = e.target.getAttribute('data-key');
    if (action === 'edit') {
        const log = currentFetchedLogs[key];
        startEdit(key, log.attitude, log.content, log.homework);
    } else if (action === 'delete') {
        const stId = document.getElementById('studentId').value;
        if (confirm(`Ẩn bài học ngày ${formatDateDisplay(key)}?`)) {
            update(ref(db, `Students/${stId}/logs/${key}`), { deleted: true, deletedAt: Date.now() })
                .then(() => adminShowToast('Đã ẩn bài học.'))
                .catch(() => adminShowToast('Lỗi xóa bài học!', true));
        }
    }
});

// ─── Form: Edit / Save / Cancel ──────────────────────────────────────────────
function validateForm() {
    const date = document.getElementById('logDate').value;
    const p    = document.getElementById('progress').value;
    const c    = document.getElementById('content').value.trim();
    if (!date || p === '' || !c) { adminShowToast('Nhập đủ Ngày, Tiến độ và Nội dung!', true); return null; }
    return { date, progress: parseInt(p), content: c };
}

function buildLogData(date, content, homework, attitude, existingKey) {
    const logData = { date: formatDateDisplay(date), content, homework, attitude, updatedAt: Date.now() };
    if (existingKey && currentFetchedLogs[existingKey]) {
        const old = currentFetchedLogs[existingKey];
        logData.editHistory = [...(old.editHistory || []),
            { content: old.content, updatedAt: old.updatedAt || Date.now() }
        ];
    }
    return logData;
}

function buildNotification(displayDate, homework) {
    const isMat = homework && homework.includes('http');
    return {
        type:    isMat ? 'material' : 'report',
        title:   isMat ? '📂 Bài tập / tài liệu mới' : '📝 Cập nhật báo cáo học',
        content: `Cô Giang cập nhật nội dung học ngày ${displayDate}`,
        time:    new Date().toLocaleString('vi-VN')
    };
}

function buildUpdates(key, progress, logData, notifPayload, targetStudents) {
    const updates = {};
    const ts = Date.now();
    targetStudents.forEach(st => {
        updates[`Students/${st}/progress`]             = progress;
        updates[`Students/${st}/logs/${key}`]          = logData;
        updates[`Students/${st}/notifications/${ts}`]  = notifPayload;
    });
    return updates;
}

function saveReport() {
    const validated = validateForm();
    if (!validated) return;
    const { date, progress, content } = validated;
    const homework   = document.getElementById('homework').value;
    const attitude   = document.getElementById('attitude').value;
    const both       = document.getElementById('saveForBoth').checked;
    const id         = document.getElementById('studentId').value;
    const editingKey = document.getElementById('editingDateKey').value;
    const key        = editingKey || date;

    const logData      = buildLogData(date, content, homework, attitude, editingKey);
    const notifPayload = buildNotification(logData.date, homework);
    const targets      = both ? currentStudentsInFamily : [id];
    const updates      = buildUpdates(key, progress, logData, notifPayload, targets);

    update(ref(db), updates)
        .then(() => { adminShowToast(both ? 'Đã lưu cho TẤT CẢ bé!' : 'Đã lưu báo cáo!'); cancelEdit(); })
        .catch(() => adminShowToast('Lỗi lưu dữ liệu!', true));
}

function startEdit(k, a, c, h) {
    document.getElementById('logDate').value        = k;
    document.getElementById('attitude').value       = a;
    document.getElementById('content').value        = c;
    document.getElementById('homework').value       = h || '';
    document.getElementById('editingDateKey').value = k;
    document.getElementById('formTitle').innerText  = `✏️ Sửa ngày: ${formatDateDisplay(k)}`;
    document.getElementById('btnSubmit').innerText  = 'CẬP NHẬT';
    document.getElementById('btnSubmit').style.background = 'var(--warning)';
    document.getElementById('btnCancel').style.display   = 'block';
    document.getElementById('saveForBoth').checked  = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
    document.getElementById('logDate').valueAsDate    = new Date();
    document.getElementById('content').value          = '';
    document.getElementById('homework').value         = '';
    document.getElementById('editingDateKey').value   = '';
    document.getElementById('formTitle').innerText    = '📝 Soạn báo cáo mới';
    document.getElementById('btnSubmit').innerText    = 'Lưu báo cáo';
    document.getElementById('btnSubmit').style.background = 'var(--success)';
    document.getElementById('btnCancel').style.display    = 'none';
    document.getElementById('saveForBoth').checked    = false;
}

// ─── Billing Cycles dropdown ──────────────────────────────────────────────────
function generateBillingCycles() {
    const select = document.getElementById('cycleFilter');
    const now = new Date(); let m = now.getMonth(), y = now.getFullYear();
    if (now.getDate() < 16) { m--; if (m < 0) { m = 11; y--; } }
    let html = '<option value="all">📂 Xem tất cả thời gian</option>';
    for (let i = 0; i < 12; i++) {
        let sm = m - i, sy = y; while (sm < 0) { sm += 12; sy--; }
        const start = new Date(sy, sm, 16).getTime();
        const end   = new Date(sy, sm + 1, 15, 23, 59, 59).getTime();
        html += `<option value="${start}_${end}" ${i===0?'selected':''}>
            Kỳ học: 16/${sm+1}/${sy} → 15/${(sm+1)%12+1}/${sm===11?sy+1:sy}
            ${i===0 ? '(Kỳ này)' : ''}
        </option>`;
    }
    select.innerHTML = html;
}

// ─── Attach Material ──────────────────────────────────────────────────────────
function attachMaterial() {
    const name = document.getElementById('matName').value.trim();
    const url  = document.getElementById('matUrl').value.trim();
    if (!url) return adminShowToast('Vui lòng dán link URL!', true);
    const formatString = name ? `${name}: ${url}` : url;
    const hw = document.getElementById('homework');
    hw.value = hw.value ? hw.value + '\n' + formatString : formatString;
    document.getElementById('matName').value = '';
    document.getElementById('matUrl').value  = '';
    adminShowToast('Đã chèn liên kết! Nhớ ấn Lưu Báo Cáo.');
}

// ─── Export PDF ───────────────────────────────────────────────────────────────
function exportToPDF() {
    const stId = document.getElementById('studentId').value;
    const meta = STUDENT_META[stId] || { fullName: `Bé ${stId}` };
    const printDiv = document.createElement('div');
    printDiv.style.cssText = 'padding:20px;font-family:Nunito,sans-serif;color:#2d3436;';
    let htmlContent = `
    <div style="text-align:center;margin-bottom:30px;border-bottom:2px solid #6c5ce7;padding-bottom:15px;">
        <h2 style="color:#6c5ce7;margin:0 0 10px 0;">BÁO CÁO HỌC TẬP</h2>
        <h3 style="margin:0;">Học sinh: ${meta.fullName}</h3>
    </div>`;
    if (filteredLogsArray.length === 0)
        htmlContent += `<p style="text-align:center;">Chưa có dữ liệu học tập trong kỳ này.</p>`;
    filteredLogsArray.forEach(item => {
        const l = item.data;
        htmlContent += `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:15px;margin-bottom:15px;">
            <div style="display:flex;justify-content:space-between;border-bottom:1px dashed #cbd5e1;
                padding-bottom:8px;margin-bottom:10px;">
                <span style="font-weight:bold;color:#0984e3;">📅 ${l.date || formatDateDisplay(item.key)}</span>
                <span style="font-weight:bold;color:#00b894;">${UI.escapeHTML(l.attitude||'').split(' ')[0]}</span>
            </div>
            <div style="margin-bottom:8px;line-height:1.5;">
                <strong>📝 Nội dung:</strong><br>${UI.escapeHTML(l.content||'').replace(/\n/g,'<br>')}
            </div>
            ${l.homework ? `<div style="font-size:0.9rem;color:#636e72;background:#fff;padding:8px;border-radius:8px;">
                <strong>📂 Bài tập:</strong> ${UI.escapeHTML(l.homework).replace(/\n/g,'<br>')}
            </div>` : ''}
        </div>`;
    });
    printDiv.innerHTML = htmlContent;
    const opt = {
        margin: 10,
        filename: `Bao_Cao_${stId}_${new Date().toLocaleDateString('vi-VN').replace(/\//g,'-')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    adminShowToast('Đang tạo PDF...');
    html2pdf().set(opt).from(printDiv).save()
        .then(() => adminShowToast('Đã xuất PDF!'))
        .catch(() => adminShowToast('Lỗi tạo PDF!', true));
}

// ─── Event bindings ───────────────────────────────────────────────────────────
document.getElementById('studentId').addEventListener('change', loadStudentLogs);
document.getElementById('cycleFilter').addEventListener('change', () => { currentPage = 1; processLogs(); });
document.getElementById('logSearch').addEventListener('input', () => { currentPage = 1; processLogs(); });
document.getElementById('progressRange').addEventListener('input', function() {
    document.getElementById('progress').value = this.value;
});
document.getElementById('progress').addEventListener('input', function() {
    document.getElementById('progressRange').value = this.value;
});
document.getElementById('btnAttachMat').addEventListener('click', attachMaterial);
document.getElementById('btnSubmit').addEventListener('click', saveReport);
document.getElementById('btnCancel').addEventListener('click', cancelEdit);
document.getElementById('btnExportPDF').addEventListener('click', exportToPDF);
document.getElementById('btnPrevPage').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderPaginatedLogs(); }
});
document.getElementById('btnNextPage').addEventListener('click', () => {
    if (currentPage * ADMIN_CONFIG.LOGS_PER_PAGE < filteredLogsArray.length) { currentPage++; renderPaginatedLogs(); }
});
document.querySelectorAll('.quick-tag').forEach(btn => {
    btn.addEventListener('click', function() {
        const txt = this.getAttribute('data-insert');
        const el  = document.getElementById('content');
        el.value  = el.value ? el.value + '\n' + txt : txt;
    });
});
