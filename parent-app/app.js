import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, push, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig, APP_CONFIG, FALLBACK_PASSCODES, PAYMENT_CONFIG } from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const CONFIG = { FEE_PER_LESSON: 0, CYCLE_START_DAY: 16, LOGS_PER_PAGE: 15, ...APP_CONFIG };
const DEFAULT_SCHEDULE = [
    { day: 2, status: "fixed", start: "19:30", end: "21:30", fee: CONFIG.FEE_PER_LESSON, note: "Cố định" },
    { day: 3, status: "off", start: "", end: "", fee: CONFIG.FEE_PER_LESSON, note: "Nghỉ" },
    { day: 4, status: "off", start: "", end: "", fee: CONFIG.FEE_PER_LESSON, note: "Nghỉ" },
    { day: 5, status: "fixed", start: "19:30", end: "21:30", fee: CONFIG.FEE_PER_LESSON, note: "Cố định" },
    { day: 6, status: "off", start: "", end: "", fee: CONFIG.FEE_PER_LESSON, note: "Nghỉ" }
];

const TAB_TITLES = {
    "bao-cao": "Báo cáo học tập",
    "ho-so": "Hồ sơ năng lực",
    "hoc-phi": "Học phí",
    "lich-hoc": "Lịch học"
};

let allParentNotifs = [];
let currentFamilyCode = "";
let currentStudents = [];
let familySettings = {};
let cachedStudentData = {};
let cachedBillingInfo = null;
let notifiedKeys = [];
try { notifiedKeys = JSON.parse(localStorage.getItem("notifiedKeys")) || []; } catch(e) {}

const urlCode = new URLSearchParams(location.search).get("code");
if (urlCode) localStorage.setItem("familyCode", urlCode.trim().toUpperCase());

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(err => console.error(err));
}

const UI = {
    showToast(msg, type = "success") {
        const t = document.getElementById("toast");
        t.textContent = msg;
        t.style.background = type === "error" ? "var(--danger)" : "var(--success)";
        t.className = "show";
        setTimeout(() => t.className = "", 3500);
    },
    escapeHTML(str) {
        return str ? String(str).replace(/[&<>'"]/g, tag => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[tag])) : "";
    },
    formatHomeworkText(text) {
        if (!text) return "Không có";
        const escaped = this.escapeHTML(text);
        return escaped.replace(/(https?:\/\/[^\s]+)/g, url =>
            `<br><a href="${url}" target="_blank" class="download-btn">Tải tài liệu / bài tập</a>`
        ).replace(/\n/g, "<br>");
    },
    setLoading(btn, loadingText, isLoading) {
        if (!btn) return;
        if (isLoading) { btn.dataset.originalText = btn.textContent; btn.textContent = loadingText; btn.disabled = true; }
        else { btn.textContent = btn.dataset.originalText || btn.textContent; btn.disabled = false; }
    }
};

function normalizeStudents(value) {
    if (Array.isArray(value)) return value;
    if (value?.students && Array.isArray(value.students)) return value.students;
    if (value && typeof value === "object") return Object.values(value);
    return [];
}

async function resolveFamily(code) {
    const snap = await get(ref(db, `Passcodes/${code}`));
    if (snap.exists()) return normalizeStudents(snap.val());
    return FALLBACK_PASSCODES[code] || [];
}

function parseLogDate(d) {
    return d.includes("-")
        ? new Date(d.split("-")[0], d.split("-")[1] - 1, d.split("-")[2])
        : new Date(d.split("/")[2], d.split("/")[1] - 1, d.split("/")[0]);
}

const Tabs = {
    init() {
        document.querySelectorAll(".nav-btn").forEach(btn => {
            btn.addEventListener("click", () => this.switchTo(btn.dataset.tab));
        });
    },
    switchTo(tabId) {
        document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
        document.querySelectorAll(".tab-content").forEach(c => {
            c.style.display = c.id === `tab-${tabId}` ? "block" : "none";
        });
        document.getElementById("topBarTitle").textContent = TAB_TITLES[tabId] || "";
    }
};

const AuthManager = {
    init() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                document.getElementById("login-screen").style.display = "none";
                document.getElementById("app-screen").style.display = "block";
                document.getElementById("inboxBtn").style.display = "flex";

                const code = localStorage.getItem("familyCode") || sessionStorage.getItem("familyCode");
                const students = code ? await resolveFamily(code) : [];
                if (code && students.length) {
                    currentFamilyCode = code;
                    currentStudents = students;
                    document.getElementById("analyticsLink").href = `analytics.html?code=${encodeURIComponent(code)}`;
                    AppCore.loadAll(students, code);
                } else {
                    signOut(auth);
                }
            } else {
                document.getElementById("login-screen").style.display = "flex";
                document.getElementById("app-screen").style.display = "none";
                document.getElementById("inboxBtn").style.display = "none";
            }
        });

        document.getElementById("btnLogin").addEventListener("click", () => this.login());
        document.getElementById("passcode").addEventListener("keypress", (e) => { if(e.key === "Enter") this.login(); });
        document.getElementById("btnLogout").addEventListener("click", () => {
            signOut(auth).then(() => { localStorage.removeItem("familyCode"); sessionStorage.removeItem("familyCode"); location.reload(); });
        });
        document.getElementById("forgotPasscode").addEventListener("click", (e) => {
            e.preventDefault();
            alert("Vui lòng liên hệ giáo viên để cấp lại mã gia đình!");
        });
        if (urlCode) document.getElementById("passcode").value = urlCode.trim().toUpperCase();
    },

    async login() {
        const code = document.getElementById("passcode").value.trim().toUpperCase();
        const btn = document.getElementById("btnLogin");
        if (!code) return UI.showToast("Vui lòng nhập mã gia đình!", "error");

        UI.setLoading(btn, "ĐANG VÀO LỚP...", true);
        if (document.getElementById("rememberMe").checked) localStorage.setItem("familyCode", code);
        else sessionStorage.setItem("familyCode", code);

        const dummyEmail = code.toLowerCase() + "@" + (CONFIG.AUTH_EMAIL_DOMAIN || "example.local");
        const dummyPassword = code + (CONFIG.AUTH_PASSWORD_SUFFIX || "CHANGE_THIS_LOCALLY");
        signInWithEmailAndPassword(auth, dummyEmail, dummyPassword)
            .then(async () => {
                const students = await resolveFamily(code).catch(() => []);
                if (!students.length) {
                    localStorage.removeItem("familyCode"); sessionStorage.removeItem("familyCode");
                    await signOut(auth);
                    return UI.showToast("Mã gia đình không tồn tại hoặc chưa được cấp quyền!", "error");
                }
                UI.showToast("Đăng nhập thành công!");
                if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
            })
            .catch(() => {
                localStorage.removeItem("familyCode"); sessionStorage.removeItem("familyCode");
                UI.showToast("Mã chưa kích hoạt trên hệ thống!", "error");
                signOut(auth);
            })
            .finally(() => UI.setLoading(btn, "", false));
    }
};

const AppCore = {
    getBillingCycle() {
        const now = new Date();
        let m = now.getMonth(), y = now.getFullYear();
        if (now.getDate() < CONFIG.CYCLE_START_DAY) { m--; if (m < 0) { m = 11; y--; } }
        return {
            start: new Date(y, m, CONFIG.CYCLE_START_DAY, 0, 0, 0),
            end: new Date(y, m + 1, CONFIG.CYCLE_START_DAY - 1, 23, 59, 59),
            displayStart: `${CONFIG.CYCLE_START_DAY}/${m + 1}`,
            displayEnd: `${CONFIG.CYCLE_START_DAY - 1}/${(m + 1) % 12 + 1}`
        };
    },

    loadAll(students, code) {
        this.loadFamilySettings(code);
        this.loadFamilyData(students);
        this.loadAssessmentPreview(students);
        this.listenToInbox(students);
        this.listenToBroadcast(code);
    },

    loadFamilySettings(code) {
        onValue(ref(db, `Families/${code}/settings`), snap => { familySettings = snap.val() || {}; });
        onValue(ref(db, `Families/${code}/schedule`), snap => {
            this.renderSchedule(snap.val() || DEFAULT_SCHEDULE);
        });
    },

    renderSchedule(scheduleData) {
        const days = {2:"Thứ 2", 3:"Thứ 3", 4:"Thứ 4", 5:"Thứ 5", 6:"Thứ 6", 7:"Thứ 7", 8:"Chủ nhật"};
        const statusLabel = { off: "Nghỉ", fixed: "Cố định", makeup: "Học bù", changed: "Đổi lịch" };
        const schedule = Array.isArray(scheduleData) ? scheduleData : Object.values(scheduleData || {});
        const normalized = DEFAULT_SCHEDULE.map(d => ({ ...d, ...(schedule.find(x => Number(x.day) === d.day) || {}) }));
        document.getElementById("schedule-container").innerHTML = normalized.map(item => {
            const status = item.status || "off";
            const time = status === "off" ? "Nghỉ" : `${item.start || "--:--"} – ${item.end || "--:--"}`;
            return `<div class="schedule-day ${status !== "off" ? "active" : ""} ${status}">
                <div class="day-name">${days[item.day] || item.day}</div>
                <div class="time">${time}</div>
                <div class="note">${statusLabel[status] || status}</div>
                ${item.note && item.note !== "Cố định" && item.note !== "Nghỉ" ? `<div class="note">${UI.escapeHTML(item.note)}</div>` : ""}
            </div>`;
        }).join("");
    },

    loadFamilyData(studentsArray) {
        document.getElementById("data-container").innerHTML = '<p class="muted" style="text-align:center;padding:30px;">Đang tải...</p>';
        studentsArray.forEach(id => {
            onValue(ref(db, `Students/${id}`), snap => {
                cachedStudentData[id] = snap.val() || {};
                this.renderReportTab(studentsArray);
                this.renderBillingTab(studentsArray);
            });
        });
    },

    renderReportTab(studentsArray) {
        const colors = ["#6c5ce7", "#00b894"];
        const grads = ["linear-gradient(90deg,#6c5ce7,#a29bfe)", "linear-gradient(90deg,#00b894,#55efc4)"];
        const html = studentsArray.map((id, idx) => {
            const s = cachedStudentData[id] || {};
            const color = colors[idx % 2];
            const grad = grads[idx % 2];
            let logsHtml = "";
            const cycle = this.getBillingCycle();

            if (s.logs) {
                Object.keys(s.logs).sort().reverse().slice(0, CONFIG.LOGS_PER_PAGE).forEach(d => {
                    const l = s.logs[d];
                    const logDate = parseLogDate(d);
                    const inCycle = logDate >= cycle.start && logDate <= cycle.end;
                    logsHtml += `<div class="log-box">
                        <div class="log-header">
                            <span class="log-date" style="color:${color};">${l.date || d}</span>
                            ${inCycle ? '<span class="log-badge">Kỳ này</span>' : ""}
                            <span class="log-attitude">${UI.escapeHTML(l.attitude || "")}</span>
                        </div>
                        <div class="log-content"><strong>Nội dung:</strong><br>${UI.escapeHTML(l.content || "").replace(/\n/g, "<br>")}</div>
                        <div class="log-hw"><strong>Bài tập & tài liệu:</strong><br>${UI.formatHomeworkText(l.homework)}</div>
                    </div>`;
                });
            }

            return `<div class="student-card" style="border-top-color:${color}">
                <div class="student-card-header">
                    <span class="student-name">Bé ${UI.escapeHTML(id)}</span>
                    <button class="soft-btn" data-target="${UI.escapeHTML(id)}">Nhắn cô</button>
                </div>
                <div class="progress-bar"><div class="progress-fill" style="width:${s.progress||0}%;background:${grad}"></div></div>
                <div class="progress-label">Tiến độ tổng: ${s.progress || 0}%</div>
                <div class="logs-label">Lịch sử học tập</div>
                <div class="logs-container">${logsHtml || "<p class='muted'>Chưa có dữ liệu.</p>"}</div>
            </div>`;
        }).join("");
        document.getElementById("data-container").innerHTML = html;
        this.bindFeedbackButtons();
    },

    renderBillingTab(studentsArray) {
        const cycle = this.getBillingCycle();
        let uniqueDates = new Set();
        let sessionRows = [];

        studentsArray.forEach(id => {
            const s = cachedStudentData[id] || {};
            if (s.logs) {
                Object.keys(s.logs).forEach(d => {
                    const logDate = parseLogDate(d);
                    if (logDate >= cycle.start && logDate <= cycle.end) {
                        uniqueDates.add(d);
                    }
                });
            }
        });

        const sortedDates = [...uniqueDates].sort().reverse();
        sortedDates.forEach(d => {
            const sample = cachedStudentData[studentsArray[0]]?.logs?.[d];
            sessionRows.push(`<div class="session-row"><span>${sample?.date || d}</span><span style="color:#2b8a3e;">1 buổi</span></div>`);
        });

        const fee = Number(familySettings.feePerLesson || CONFIG.FEE_PER_LESSON);
        const total = uniqueDates.size * fee;

        document.getElementById("billing-container").innerHTML = `
            <div class="billing-card">
                <div class="billing-label">Học phí kỳ này</div>
                <div class="billing-sub">Từ ${cycle.displayStart} đến ${cycle.displayEnd} · ${studentsArray.join(" & ")}</div>
                <div class="billing-amount">${total.toLocaleString("vi-VN")} đ</div>
                <div class="billing-sessions">${uniqueDates.size} buổi × ${fee.toLocaleString("vi-VN")} đ</div>
                ${sessionRows.length ? `<div class="billing-sessions-detail">${sessionRows.join("")}</div>` : ""}
                <button class="btn-main" id="btnOpenPayment" style="background:#2b8a3e;">THANH TOÁN NGAY</button>
            </div>`;
        this.bindPayment(total, studentsArray);
    },

    bindPayment(amount, studentsArray) {
        const btn = document.getElementById("btnOpenPayment");
        if (!btn) return;
        btn.onclick = () => {
            if (amount === 0) return UI.showToast("Kỳ này chưa có học phí!", "error");
            const payment = familySettings.payment || {};
            const bankId = payment.bankId || PAYMENT_CONFIG.bankId || "";
            const accountNo = payment.accountNo || PAYMENT_CONFIG.accountNo || "";
            const accountName = payment.accountName || PAYMENT_CONFIG.accountName || "";
            const content = payment.content || PAYMENT_CONFIG.content || `Hoc phi cua ${studentsArray.join(" va ")}`;
            if (!bankId || !accountNo || !accountName) return UI.showToast("Chưa cấu hình thông tin thanh toán.", "error");
            document.getElementById("qrCodeImage").src = `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(accountNo)}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(accountName)}`;
            document.getElementById("paymentAmount").innerText = amount.toLocaleString("vi-VN") + " đ";
            document.getElementById("paymentContent").innerText = `Nội dung: ${content}`;
            document.getElementById("btnConfirmPayment").dataset.amount = amount;
            document.getElementById("btnConfirmPayment").dataset.family = studentsArray.join(" và ");
            document.getElementById("paymentModal").style.display = "flex";
        };
    },

    loadAssessmentPreview(studentsArray) {
        const container = document.getElementById("analytics-preview-container");
        container.innerHTML = '<p class="muted">Đang tải...</p>';
        const assessmentMap = {};
        studentsArray.forEach(id => {
            onValue(ref(db, `Students/${id}/assessments`), snap => {
                assessmentMap[id] = snap.val() || {};
                this.renderAssessmentPreview(studentsArray, assessmentMap);
            });
        });
    },

    renderAssessmentPreview(studentsArray, assessmentMap) {
        const container = document.getElementById("analytics-preview-container");
        const html = studentsArray.map((id, index) => {
            const allAssessments = assessmentMap[id] || {};
            const rows = Object.keys(allAssessments).sort().reverse().map(key => ({ key, ...allAssessments[key] }));
            const color = index % 2 === 0 ? "#6c5ce7" : "#00b894";

            if (!rows.length) return `<div class="learner-profile-card" style="border-top-color:${color}">
                <h3>Bé ${UI.escapeHTML(id)}</h3>
                <p class="muted">Chưa có dữ liệu đánh giá.</p></div>`;

            const termCards = rows.map((term, termIndex) => {
                const skills = [
                    ["Nghe", term.listening || 0, "#0984e3"],
                    ["Nói", term.speaking || 0, "#00b894"],
                    ["Đọc", term.reading || 0, "#6c5ce7"],
                    ["Viết", term.writing || 0, "#ff7675"]
                ];
                const strongest = [...skills].sort((a,b) => b[1]-a[1])[0];
                const weakest = [...skills].sort((a,b) => a[1]-b[1])[0];
                const isLatest = termIndex === 0;
                const cardId = `term-body-${id}-${termIndex}`;

                return `<div class="term-card${isLatest ? " term-card--latest" : ""}">
                    <div class="term-card-header" ${!isLatest ? `onclick="var b=document.getElementById('${cardId}');b.style.display=b.style.display==='none'?'block':'none';this.querySelector('.term-toggle').textContent=b.style.display==='none'?'▼':'▲';" style="cursor:pointer;"` : ""}>
                        <span class="term-label">${UI.escapeHTML(term.cycleLabel || term.key)}</span>
                        ${isLatest ? '<span class="term-badge">Mới nhất</span>' : '<span class="term-toggle" style="margin-left:auto;font-size:0.8rem;color:#b2becd;">▼</span>'}
                    </div>
                    <div id="${cardId}" ${!isLatest ? 'style="display:none;"' : ""}>
                        <div class="profile-metrics">
                            <div class="profile-metric">Tổng<strong>${term.overall || 0}</strong></div>
                            <div class="profile-metric">CEFR<strong>${UI.escapeHTML(term.cefr || "-")}</strong></div>
                            <div class="profile-metric">Test<strong>${term.monthlyTest || 0}</strong></div>
                        </div>
                        ${isLatest ? this.renderMiniSkillChart(skills) : ""}
                        <div class="skill-bars">
                            ${skills.map(([label, score, skillColor]) => `<div class="skill-bar-row">
                                <span>${label}</span>
                                <div class="skill-bar-track"><div class="skill-bar-fill" style="width:${score}%;background:${skillColor}"></div></div>
                                <strong>${score}</strong>
                            </div>`).join("")}
                        </div>
                        <div class="profile-note"><strong>Mạnh nhất:</strong> ${strongest[0]} (${strongest[1]} điểm) · <strong>Cần tập trung:</strong> ${weakest[0]} (${weakest[1]} điểm)</div>
                        <div class="profile-note"><strong>Nhận xét:</strong><br>${UI.escapeHTML(term.comment || "Chưa có.").replace(/\n/g,"<br>")}</div>
                        <div class="profile-note"><strong>Lời khuyên:</strong><br>${UI.escapeHTML(term.advice || "Chưa có.").replace(/\n/g,"<br>")}</div>
                        ${term.nextFocus ? `<div class="profile-note"><strong>Trọng tâm tới:</strong> ${UI.escapeHTML(term.nextFocus)}</div>` : ""}
                    </div>
                </div>`;
            }).join("");

            return `<div class="learner-profile-card" style="border-top-color:${color}">
                <h3>Bé ${UI.escapeHTML(id)}</h3>
                ${termCards}
            </div>`;
        }).join("");
        container.innerHTML = html || '<p class="muted">Chưa có học sinh.</p>';
    },

    renderMiniSkillChart(skills) {
        const w=320, h=180, cx=160, cy=92, maxR=64;
        const axes = skills.map((_,i) => {
            const a = -Math.PI/2 + i*Math.PI*2/skills.length;
            return [cx+Math.cos(a)*maxR, cy+Math.sin(a)*maxR, a];
        });
        const poly = skills.map(([,score],i) => {
            const r = maxR * Number(score||0)/100, a = axes[i][2];
            return `${cx+Math.cos(a)*r},${cy+Math.sin(a)*r}`;
        }).join(" ");
        const grid = [.25,.5,.75,1].map(s => {
            const pts = axes.map(([,,a]) => `${cx+Math.cos(a)*maxR*s},${cy+Math.sin(a)*maxR*s}`).join(" ");
            return `<polygon points="${pts}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
        }).join("");
        const lines = axes.map(([x,y]) => `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e2e8f0"/>`).join("");
        const labels = skills.map(([label],i) => {
            const a=axes[i][2], x=cx+Math.cos(a)*(maxR+24), y=cy+Math.sin(a)*(maxR+20);
            return `<text x="${x}" y="${y}" text-anchor="middle" font-size="12" font-weight="700" fill="#636e72">${label}</text>`;
        }).join("");
        return `<svg class="mini-skill-chart" viewBox="0 0 ${w} ${h}">${grid}${lines}<polygon points="${poly}" fill="rgba(108,92,231,0.22)" stroke="#6c5ce7" stroke-width="3"/>${labels}</svg>`;
    },

    listenToBroadcast(code) {
        onValue(ref(db, `Families/${code}/broadcast`), snap => {
            const msg = snap.val();
            const banner = document.getElementById("broadcastDisplay");
            if (msg) {
                banner.style.display = "block";
                banner.innerText = "📢 " + msg;
                allParentNotifs = allParentNotifs.filter(n => n.type !== "general");
                allParentNotifs.push({ key: "general", type: "general", title: `${CONFIG.TEACHER_DISPLAY_NAME || "Giáo viên"} thông báo chung`, content: msg, time: "Mới nhất" });
                this.updateInboxUI();
            } else {
                banner.style.display = "none";
            }
        });
    },

    listenToInbox(studentsArray) {
        let initialLoadDone = false;
        studentsArray.forEach(id => {
            onValue(ref(db, `Students/${id}/notifications`), snap => {
                const n = snap.val(); if (!n) return;
                allParentNotifs = allParentNotifs.filter(item => item.student !== id);
                Object.keys(n).forEach(k => {
                    const item = { ...n[k], key: k, student: id };
                    allParentNotifs.push(item);
                    if (!notifiedKeys.includes(k)) {
                        notifiedKeys.push(k);
                        if (notifiedKeys.length > 50) notifiedKeys.shift();
                        localStorage.setItem("notifiedKeys", JSON.stringify(notifiedKeys));
                        if (initialLoadDone && "Notification" in window && Notification.permission === "granted") {
                            navigator.serviceWorker.ready.then(reg => {
                                reg.showNotification(item.title, { body: item.content, icon: "https://api.dicebear.com/7.x/bottts/png?seed=LearningReport&backgroundColor=6c5ce7", vibrate: [200,100,200] });
                            }).catch(() => new Notification(item.title, { body: item.content }));
                        }
                    }
                });
                this.updateInboxUI();
            });
        });
        setTimeout(() => initialLoadDone = true, 2500);
    },

    updateInboxUI() {
        allParentNotifs.sort((a,b) => (b.key > a.key) ? 1 : -1);
        document.getElementById("unreadBadge").innerText = allParentNotifs.length;
        document.getElementById("inbox-messages").innerHTML = allParentNotifs.map(n => {
            const borderColor = n.type === "reply" ? "#00b894" : (n.type === "material" ? "#f39c12" : "#0984e3");
            return `<div class="message-card" style="border-left-color:${borderColor}">
                <div style="font-weight:900;margin-bottom:4px;">${UI.escapeHTML(n.title)}</div>
                <div>${UI.escapeHTML(n.content)}</div>
                <div style="font-size:0.78rem;color:#b2bec3;margin-top:4px;">${UI.escapeHTML(n.time||"")}</div>
            </div>`;
        }).join("");
    },

    bindFeedbackButtons() {
        document.querySelectorAll("[data-target]").forEach(btn => {
            btn.onclick = (e) => {
                const target = e.currentTarget.getAttribute("data-target");
                document.getElementById("inboxModal").style.display = "none";
                document.getElementById("feedbackTarget").value = target;
                document.getElementById("modalTitle").innerText = target === "Chung" ? "Nhắn cô đổi lịch" : "Lời nhắn cho cô về bé " + target;
                document.getElementById("feedbackModal").style.display = "flex";
            };
        });
    }
};

document.getElementById("inboxBtn").onclick = () => document.getElementById("inboxModal").style.display = "flex";

document.querySelectorAll("[data-close]").forEach(btn => {
    btn.onclick = (e) => document.getElementById(e.currentTarget.getAttribute("data-close")).style.display = "none";
});

document.getElementById("btnSubmitFeedback").onclick = () => {
    const text = document.getElementById("feedbackText").value.trim();
    if (!text) return UI.showToast("Vui lòng nhập nội dung!", "error");
    const target = document.getElementById("feedbackTarget").value;
    const path = target === "Chung"
        ? `Families/${currentFamilyCode}/feedbacks/${Date.now()}`
        : `Students/${target}/feedbacks/${Date.now()}`;
    const btn = document.getElementById("btnSubmitFeedback");
    UI.setLoading(btn, "ĐANG GỬI...", true);
    push(ref(db, path), { content: UI.escapeHTML(text), date: new Date().toLocaleString("vi-VN"), familyCode: currentFamilyCode })
        .then(() => {
            UI.showToast("Đã gửi tin nhắn cho giáo viên!");
            document.getElementById("feedbackModal").style.display = "none";
            document.getElementById("feedbackText").value = "";
        })
        .finally(() => UI.setLoading(btn, "", false));
};

document.getElementById("btnConfirmPayment").onclick = function() {
    const amount = this.dataset.amount;
    const family = this.dataset.family;
    UI.setLoading(this, "ĐANG XÁC NHẬN...", true);
    push(ref(db, `Families/${currentFamilyCode}/feedbacks/${Date.now()}`), {
        content: `Gia đình bé ${family} báo đã chuyển khoản ${parseInt(amount).toLocaleString("vi-VN")} đ. Giáo viên kiểm tra nhé!`,
        date: new Date().toLocaleString("vi-VN"),
        type: "Thanh toán",
        familyCode: currentFamilyCode
    }).then(() => {
        UI.showToast("Đã gửi xác nhận cho giáo viên!");
        document.getElementById("paymentModal").style.display = "none";
    }).finally(() => UI.setLoading(this, "", false));
};

if (localStorage.getItem("theme") === "dark") document.documentElement.setAttribute("data-theme", "dark");
document.getElementById("themeToggle").onclick = () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
    localStorage.setItem("theme", isDark ? "light" : "dark");
    document.getElementById("themeToggle").textContent = isDark ? "☀️" : "🌙";
};
if (localStorage.getItem("theme") === "dark") document.getElementById("themeToggle").textContent = "🌙";

Tabs.init();
AuthManager.init();
