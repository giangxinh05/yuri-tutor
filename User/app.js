import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, push, set, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
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

let allParentNotifs = [];
let notifiedKeys = [];
try { notifiedKeys = JSON.parse(localStorage.getItem('notifiedKeys')) || []; } catch(e) {}

// ─── Service Worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}

// ─── Offline banner ───────────────────────────────────────────────────────────
const connectedRef = ref(db, '.info/connected');
let offlineBanner = null;
onValue(connectedRef, snap => {
    if (!offlineBanner) {
        offlineBanner = document.createElement('div');
        offlineBanner.style.cssText = `display:none;position:fixed;top:0;left:0;right:0;z-index:9999;
            background:#ff7675;color:white;text-align:center;padding:10px;font-weight:800;font-size:0.95rem;`;
        offlineBanner.textContent = '⚠️ Đang ngoại tuyến – dữ liệu có thể chưa được cập nhật';
        document.body.prepend(offlineBanner);
    }
    offlineBanner.style.display = snap.val() ? 'none' : 'block';
});

// ─── Skeleton loader ──────────────────────────────────────────────────────────
function showSkeleton(containerId) {
    const skeletonItem = `<div style="background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);
        background-size:200% 100%;animation:shimmer 1.2s infinite;
        border-radius:16px;height:100px;margin-bottom:15px;"></div>`;
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = skeletonItem.repeat(3) +
        `<style>@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>`;
}

// ─── Chart renderer (dùng Canvas API thuần) ──────────────────────────────────
function renderProgressChart(canvasId, logsObj, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // Lấy 8 buổi gần nhất, sắp xếp tăng dần
    const sorted = Object.keys(logsObj).sort().slice(-8);
    if (sorted.length < 2) {
        ctx.fillStyle = '#b2bec3';
        ctx.font = '13px Quicksand,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Cần ít nhất 2 buổi để hiển thị biểu đồ', W/2, H/2);
        return;
    }

    const ratings = { '⭐⭐⭐⭐⭐': 5, '⭐⭐⭐⭐': 4, '⭐⭐⭐': 3 };
    const points = sorted.map(k => {
        const l = logsObj[k];
        const att = l.attitude || '';
        let score = 3;
        for (const [star, val] of Object.entries(ratings)) {
            if (att.startsWith(star)) { score = val; break; }
        }
        return { label: formatDateDisplay(k).slice(0,5), score };
    });

    const pad = { l:30, r:20, t:20, b:40 };
    const gW = W - pad.l - pad.r;
    const gH = H - pad.t - pad.b;
    const stepX = gW / (points.length - 1);

    // Grid lines
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    for (let i = 1; i <= 5; i++) {
        const y = pad.t + gH - ((i - 1) / 4) * gH;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + gW, y); ctx.stroke();
        ctx.fillStyle = '#b2bec3'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(i + '⭐', pad.l - 4, y + 4);
    }

    // Fill area
    const gradient = ctx.createLinearGradient(0, pad.t, 0, pad.t + gH);
    gradient.addColorStop(0, color + '55');
    gradient.addColorStop(1, color + '05');
    ctx.beginPath();
    points.forEach((p, i) => {
        const x = pad.l + i * stepX;
        const y = pad.t + gH - ((p.score - 1) / 4) * gH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.l + (points.length-1)*stepX, pad.t+gH);
    ctx.lineTo(pad.l, pad.t+gH);
    ctx.closePath();
    ctx.fillStyle = gradient; ctx.fill();

    // Line
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    points.forEach((p, i) => {
        const x = pad.l + i * stepX;
        const y = pad.t + gH - ((p.score - 1) / 4) * gH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots + labels
    points.forEach((p, i) => {
        const x = pad.l + i * stepX;
        const y = pad.t + gH - ((p.score - 1) / 4) * gH;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = '#636e72'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(p.label, x, H - pad.b + 14);
    });
}

// ─── Auth Manager ─────────────────────────────────────────────────────────────
const AuthManager = {
    init() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                document.getElementById('login-screen').style.display  = 'none';
                document.getElementById('report-screen').style.display = 'block';
                document.getElementById('inboxBtn').style.display      = 'flex';

                const code = localStorage.getItem('familyCode') || sessionStorage.getItem('familyCode');
                if (!code) { signOut(auth); return; }

                try {
                    const snap = await get(ref(db, `Passcodes/${code}`));
                    if (snap.exists()) {
                        const students = snap.val();
                        AppCore.loadFamilyData(students, code);
                        AppCore.listenToInbox(students);
                        AppCore.listenToBroadcast();
                    } else {
                        signOut(auth);
                    }
                } catch(e) {
                    console.error('Lỗi lấy passcode:', e);
                    signOut(auth);
                }
            } else {
                document.getElementById('login-screen').style.display  = 'block';
                document.getElementById('report-screen').style.display = 'none';
                document.getElementById('inboxBtn').style.display      = 'none';
            }
        });

        document.getElementById('btnLogin').addEventListener('click', () => this.login());
        document.getElementById('passcode').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });
        document.getElementById('btnLogout').addEventListener('click', () => {
            signOut(auth).then(() => { localStorage.clear(); sessionStorage.clear(); location.reload(); });
        });
        document.getElementById('forgotPasscode').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('forgotModal').style.display = 'flex';
        });

        if (localStorage.getItem('theme') === 'dark')
            document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('themeToggle').onclick = () => {
            const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', t);
            localStorage.setItem('theme', t);
        };
    },

    login() {
        const code = document.getElementById('passcode').value.trim().toUpperCase();
        const btn  = document.getElementById('btnLogin');
        if (!code) return UI.showToast('Vui lòng nhập mã gia đình!', true);

        btn.textContent = 'ĐANG VÀO LỚP...'; btn.disabled = true;

        if (document.getElementById('rememberMe').checked) localStorage.setItem('familyCode', code);
        else sessionStorage.setItem('familyCode', code);

        get(ref(db, `Passcodes/${code}`)).then(snap => {
            if (!snap.exists()) {
                localStorage.removeItem('familyCode'); sessionStorage.removeItem('familyCode');
                UI.showToast('Mã gia đình không tồn tại!', true);
                btn.textContent = 'VÀO LỚP'; btn.disabled = false;
                return;
            }
            const dummyEmail    = code.toLowerCase() + '@yuriapp.com';
            const dummyPassword = code + (window.__ENV?.PASSCODE_SUFFIX || 'REPLACE_ME');
            signInWithEmailAndPassword(auth, dummyEmail, dummyPassword)
                .then(() => {
                    UI.showToast('Đăng nhập thành công!');
                    btn.textContent = 'VÀO LỚP'; btn.disabled = false;
                    if ('Notification' in window && Notification.permission === 'default')
                        Notification.requestPermission();
                })
                .catch(() => {
                    localStorage.removeItem('familyCode'); sessionStorage.removeItem('familyCode');
                    UI.showToast('Mã chưa kích hoạt trên hệ thống!', true);
                    btn.textContent = 'VÀO LỚP'; btn.disabled = false;
                    signOut(auth);
                });
        }).catch(() => {
            UI.showToast('Không kết nối được Firebase!', true);
            btn.textContent = 'VÀO LỚP'; btn.disabled = false;
        });
    }
};

// ─── App Core ─────────────────────────────────────────────────────────────────
const AppCore = {
    // Giữ unsubscribe functions để tránh listener chồng lên nhau
    _unsubs: [],

    _clearUnsubs() {
        this._unsubs.forEach(fn => { try { fn(); } catch(e) {} });
        this._unsubs = [];
    },

    loadFamilyData(studentsArray, familyCode) {
        showSkeleton('data-container');
        this._clearUnsubs();

        const allData = {};
        let loadedCount = 0;

        const renderUI = () => {
            const container = document.getElementById('data-container');
            if (Object.keys(allData).length === 0) {
                container.innerHTML = '<p style="text-align:center;margin-top:50px;">Chưa có dữ liệu bài học nào.</p>';
                return;
            }
            const cycle = getBillingCycle();
            let allDatesInCycle = new Set();
            let studentCardsHtml = '';

            studentsArray.forEach((id, index) => {
                const s = allData[id]; if (!s) return;
                const isEven = index % 2 === 0;
                const color = isEven ? '#6c5ce7' : '#00b894';
                const grad  = isEven ? 'linear-gradient(90deg,#6c5ce7,#a29bfe)' : 'linear-gradient(90deg,#00b894,#55efc4)';
                const chartId = `chart_${id}`;

                let logsHtml = '';
                if (s.logs) {
                    const allDates    = Object.keys(s.logs).filter(k => !s.logs[k].deleted).sort().reverse();
                    const displayDates = allDates.slice(0, CONFIG.LOGS_PER_PAGE);

                    allDates.forEach(d => {
                        const logDate = dateKeyToDate(d);
                        if (logDate >= cycle.start && logDate <= cycle.end) allDatesInCycle.add(d);
                    });

                    displayDates.forEach(d => {
                        const l = s.logs[d];
                        const logDate = dateKeyToDate(d);
                        const badgeHtml = (logDate >= cycle.start && logDate <= cycle.end)
                            ? `<span style="background:#ffeaa7;color:#d35400;padding:3px 10px;
                                border-radius:8px;font-size:0.75rem;font-weight:bold;margin-left:10px;">⭐ Kỳ này</span>` : '';
                        logsHtml += `
                        <div class="log-box">
                            <div style="display:flex;justify-content:space-between;align-items:center;
                                margin-bottom:12px;border-bottom:2px dashed #f1f2f6;padding-bottom:10px;">
                                <div style="font-weight:800;font-size:1.1rem;color:${color};">
                                    📅 ${formatDateDisplay(d)} ${badgeHtml}
                                </div>
                                <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:6px 12px;
                                    border-radius:10px;font-size:0.82rem;font-weight:bold;">
                                    ${UI.escapeHTML(l.attitude || '')}
                                </div>
                            </div>
                            <div style="margin-bottom:10px;line-height:1.5;">
                                <strong>Nội dung:</strong><br>${UI.escapeHTML(l.content || '').replace(/\n/g,'<br>')}
                            </div>
                            <div style="background:#f0f3ff;padding:12px;border-radius:12px;margin-top:12px;font-size:0.95rem;">
                                <strong>📝 Bài tập & Tài liệu:</strong><br>
                                ${UI.formatHomeworkText(l.homework)}
                            </div>
                        </div>`;
                    });
                }

                // Nhận xét phân tích từ giáo viên
                const analysisHtml = s.analysis
                    ? `<div style="background:linear-gradient(135deg,#fff9db,#ffec99);border-left:4px solid #f59f00;
                        padding:16px;border-radius:14px;margin-bottom:20px;">
                        <div style="font-weight:800;color:#e67700;margin-bottom:6px;">💡 Nhận xét của Cô Giang</div>
                        <div style="color:#2d3436;line-height:1.6;">${UI.escapeHTML(s.analysis).replace(/\n/g,'<br>')}</div>
                        ${s.analysisUpdatedAt ? `<div style="font-size:0.75rem;color:#868e96;margin-top:8px;">Cập nhật: ${s.analysisUpdatedAt}</div>` : ''}
                      </div>` : '';

                studentCardsHtml += `
                <div class="student-card" style="border-top-color:${color}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                        <span style="font-size:2rem;font-weight:900;">${isEven ? '👦' : '👶'} Bé ${UI.escapeHTML(id)}</span>
                        <button style="background:#e0e7ff;color:#4338ca;border:none;padding:10px 18px;
                            border-radius:14px;font-weight:bold;cursor:pointer;"
                            data-target="${UI.escapeHTML(id)}">💬 Nhắn cô</button>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-weight:800;margin-bottom:8px;color:#636e72;">
                        <span>Tiến độ tổng</span>
                        <span style="color:${color}">${s.progress || 0}%</span>
                    </div>
                    <div class="progress-bar" style="margin-bottom:20px;">
                        <div class="progress-fill" style="width:${s.progress||0}%;background:${grad}"></div>
                    </div>
                    
                    ${s.logs && Object.keys(s.logs).filter(k=>!s.logs[k].deleted).length >= 2 ? `
                    <div style="margin-bottom:20px;">
                        <div style="font-weight:800;color:${color};margin-bottom:10px;">📈 Biểu đồ thái độ học tập</div>
                        <canvas id="${chartId}" style="width:100%;height:160px;display:block;border-radius:12px;"></canvas>
                    </div>` : ''}

                    ${analysisHtml}

                    <h4 style="margin:0 0 15px 0;color:var(--primary);">📚 Lịch sử học tập:</h4>
                    <div class="logs-container">${logsHtml || '<p>Chưa có dữ liệu.</p>'}</div>
                </div>`;
            });

            const totalSessions = allDatesInCycle.size;
            const amount = totalSessions * CONFIG.FEE_PER_LESSON;
            const billingHtml = `
            <div style="width:100%;background:linear-gradient(135deg,#ebfbee,#d3f9d8);padding:30px;
                border-radius:24px;margin-top:10px;border:2px solid #b2f2bb;box-sizing:border-box;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px;">
                    <div>
                        <div style="font-size:1.1rem;font-weight:800;color:#2b8a3e;margin-bottom:5px;">💰 TỔNG HỌC PHÍ KỲ NÀY</div>
                        <div style="font-size:0.95rem;color:#5c940d;font-weight:700;">Từ ${cycle.displayStart} đến ${cycle.displayEnd}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:2.2rem;font-weight:900;color:#2b8a3e">${amount.toLocaleString('vi-VN')} đ</div>
                        <div style="font-size:0.9rem;color:#5c940d;font-weight:bold;margin-bottom:10px;">(Đã dạy: ${totalSessions} buổi)</div>
                        <button class="btn-main" id="btnOpenPayment"
                            style="background:#2b8a3e;padding:10px 20px;font-size:0.95rem;margin:0;">
                            💳 THANH TOÁN NGAY
                        </button>
                    </div>
                </div>
            </div>`;

            container.innerHTML = `<div style="display:flex;gap:30px;flex-wrap:wrap;">${studentCardsHtml}</div>` + billingHtml;
            this.bindEvents();

            // Render charts sau khi DOM đã sẵn sàng
            studentsArray.forEach((id, index) => {
                const s = allData[id];
                if (!s || !s.logs) return;
                const color = index % 2 === 0 ? '#6c5ce7' : '#00b894';
                const validLogs = {};
                Object.keys(s.logs).forEach(k => { if (!s.logs[k].deleted) validLogs[k] = s.logs[k]; });
                if (Object.keys(validLogs).length >= 2) {
                    requestAnimationFrame(() => renderProgressChart(`chart_${id}`, validLogs, color));
                }
            });

            // Payment handler
            document.getElementById('btnOpenPayment')?.addEventListener('click', () => {
                if (amount === 0) return UI.showToast('Kỳ này chưa có học phí!', true);
                const bankId      = window.__ENV?.BANK_ID || 'REPLACE_ME';
                const accountNo   = window.__ENV?.BANK_ACCOUNT_NO || 'REPLACE_ME';
                const accountName = window.__ENV?.BANK_ACCOUNT_NAME || 'REPLACE_ME';
                const content     = studentsArray.map(s => `be ${s}`).join(' va ');
                const qrUrl       = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent('Hoc phi cua ' + content)}&accountName=${encodeURIComponent(accountName)}`;
                document.getElementById('qrCodeImage').src          = qrUrl;
                document.getElementById('paymentAmount').innerText   = amount.toLocaleString('vi-VN') + ' đ';
                document.getElementById('paymentContent').innerText  = `Nội dung: Hoc phi cua ${content}`;
                document.getElementById('paymentModal').style.display = 'flex';
                const btn = document.getElementById('btnConfirmPayment');
                btn.dataset.amount = amount;
                btn.dataset.family = studentsArray.join(' và ');
            });
        };

        studentsArray.forEach(id => {
            // FIX: unsubscribe cũ trước, lưu unsub mới
            const unsub = onValue(ref(db, `Students/${id}`), snap => {
                allData[id] = snap.exists() ? snap.val() : {};
                loadedCount++;
                // Chỉ render lần đầu; sau đó re-render khi tất cả đã load
                if (loadedCount >= studentsArray.length) renderUI();
            }, { onlyOnce: false });
            this._unsubs.push(unsub);
        });
    },

    listenToBroadcast() {
        const unsub = onValue(ref(db, 'Broadcast'), snap => {
            const msg = snap.val();
            const banner = document.getElementById('broadcastDisplay');
            if (!banner) return;
            if (msg) {
                banner.style.display = 'block';
                banner.innerText = '📢 ' + msg;
                allParentNotifs = allParentNotifs.filter(n => n.key !== 'general');
                allParentNotifs.push({
                    key: 'general', type: 'general',
                    title: '📢 Cô Giang thông báo chung',
                    content: msg, time: 'Mới nhất'
                });
                this.updateInboxUI();
            } else {
                banner.style.display = 'none';
            }
        });
        this._unsubs.push(unsub);
    },

    listenToInbox(studentsArray) {
        let initialLoadDone = false;
        studentsArray.forEach(id => {
            const unsub = onValue(ref(db, `Students/${id}/notifications`), snap => {
                const n = snap.val(); if (!n) return;
                allParentNotifs = allParentNotifs.filter(item => item.student !== id);
                Object.keys(n).forEach(k => {
                    let item = n[k]; item.key = k; item.student = id;
                    allParentNotifs.push(item);
                    if (!notifiedKeys.includes(k)) {
                        notifiedKeys.push(k);
                        if (notifiedKeys.length > 50) notifiedKeys.shift();
                        localStorage.setItem('notifiedKeys', JSON.stringify(notifiedKeys));
                        if (initialLoadDone && 'Notification' in window && Notification.permission === 'granted') {
                            navigator.serviceWorker.ready
                                .then(reg => reg.showNotification(item.title, {
                                    body: item.content,
                                    icon: 'https://api.dicebear.com/7.x/bottts/png?seed=YuriEdTech&backgroundColor=6c5ce7',
                                    vibrate: [200, 100, 200]
                                }))
                                .catch(() => new Notification(item.title, { body: item.content }));
                        }
                    }
                });
                this.updateInboxUI();
            });
            this._unsubs.push(unsub);
        });
        setTimeout(() => initialLoadDone = true, 2500);
    },

    updateInboxUI() {
        allParentNotifs.sort((a, b) => (b.key > a.key ? 1 : -1));
        const lastRead    = parseInt(localStorage.getItem('lastReadTimestamp') || '0');
        const unreadCount = allParentNotifs.filter(n => {
            const ts = n.key === 'general' ? 0 : parseInt(n.key);
            return ts > lastRead;
        }).length;
        document.getElementById('unreadBadge').innerText = unreadCount || '0';
        document.getElementById('inbox-messages').innerHTML = allParentNotifs.map(n => {
            const borderColor = n.type === 'reply' ? '#00b894' : n.type === 'material' ? '#f39c12' : '#0984e3';
            return `<div style="background:var(--card-bg);border-left:5px solid ${borderColor};
                padding:15px;border-radius:12px;border:1px solid #e2e8f0;">
                <div style="font-weight:800;margin-bottom:5px;">${UI.escapeHTML(n.title)}</div>
                <div style="font-size:0.95rem;line-height:1.4;">${UI.escapeHTML(n.content)}</div>
                <div style="font-size:0.8rem;color:#b2bec3;margin-top:5px;">${UI.escapeHTML(n.time || '')}</div>
            </div>`;
        }).join('');
    },

    bindEvents() {
        document.querySelectorAll('[data-target]').forEach(btn => {
            btn.onclick = (e) => {
                const target = e.currentTarget.getAttribute('data-target');
                document.getElementById('inboxModal').style.display    = 'none';
                document.getElementById('feedbackTarget').value        = target;
                document.getElementById('modalTitle').innerText        =
                    target === 'Chung' ? 'Yêu cầu Lịch học' : 'Lời nhắn riêng bé ' + target;
                document.getElementById('feedbackModal').style.display = 'flex';
            };
        });
    }
};

// ─── Global event listeners ───────────────────────────────────────────────────
document.getElementById('inboxBtn').onclick = () => {
    document.getElementById('inboxModal').style.display = 'flex';
    localStorage.setItem('lastReadTimestamp', Date.now().toString());
    document.getElementById('unreadBadge').innerText = '0';
};

document.querySelectorAll('[data-close]').forEach(btn => {
    btn.onclick = (e) => {
        document.getElementById(e.currentTarget.getAttribute('data-close')).style.display = 'none';
    };
});

// FIX: push(ref, data) → set(push(ref), data)
document.getElementById('btnSubmitFeedback').onclick = () => {
    const text = document.getElementById('feedbackText').value.trim();
    if (!text) return UI.showToast('Vui lòng nhập nội dung!', true);
    const target = document.getElementById('feedbackTarget').value;
    const path   = target === 'Chung' ? `Feedbacks/General` : `Students/${target}/feedbacks`;
    const btn    = document.getElementById('btnSubmitFeedback');
    btn.disabled = true; btn.textContent = 'ĐANG GỬI...';
    set(push(ref(db, path)), {
        content: UI.escapeHTML(text),
        date: new Date().toLocaleString('vi-VN')
    })
    .then(() => {
        UI.showToast('Đã gửi tin nhắn cho Cô Giang!');
        document.getElementById('feedbackModal').style.display = 'none';
        document.getElementById('feedbackText').value = '';
    })
    .catch(() => UI.showToast('Lỗi gửi tin nhắn!', true))
    .finally(() => { btn.disabled = false; btn.textContent = 'GỬI ĐI'; });
};

// FIX: push(ref, data) → set(push(ref), data)
document.getElementById('btnConfirmPayment').onclick = function() {
    const amount = this.dataset.amount;
    const family = this.dataset.family;
    const btn = this;
    btn.disabled = true; btn.textContent = 'ĐANG XÁC NHẬN...';
    set(push(ref(db, `Feedbacks/General`)), {
        content: `💰 Gia đình bé ${family} báo cáo ĐÃ CHUYỂN KHOẢN thành công số tiền ${parseInt(amount).toLocaleString('vi-VN')} đ. Cô kiểm tra tài khoản nhé!`,
        date: new Date().toLocaleString('vi-VN'),
        type: 'Thanh toán'
    })
    .then(() => {
        UI.showToast('Đã gửi thông báo xác nhận cho Cô giáo!');
        document.getElementById('paymentModal').style.display = 'none';
    })
    .catch(() => UI.showToast('Lỗi xác nhận thanh toán!', true))
    .finally(() => { btn.disabled = false; btn.textContent = '✅ ĐÃ CHUYỂN KHOẢN'; });
};

AuthManager.init();
