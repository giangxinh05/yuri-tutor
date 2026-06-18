import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, remove, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig, APP_CONFIG, PARENT_APP_URL, FALLBACK_PASSCODES, STUDENT_META, PAYMENT_CONFIG } from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const CONFIG = { FEE_PER_LESSON: 0, CYCLE_START_DAY: 16, LOGS_PER_PAGE: 5, ...APP_CONFIG };
const DEFAULT_SCHEDULE = [
    { day: 2, status: "fixed", start: "19:30", end: "21:30", fee: CONFIG.FEE_PER_LESSON, note: "Cố định" },
    { day: 3, status: "off", start: "", end: "", fee: CONFIG.FEE_PER_LESSON, note: "Nghỉ" },
    { day: 4, status: "off", start: "", end: "", fee: CONFIG.FEE_PER_LESSON, note: "Nghỉ" },
    { day: 5, status: "fixed", start: "19:30", end: "21:30", fee: CONFIG.FEE_PER_LESSON, note: "Cố định" },
    { day: 6, status: "off", start: "", end: "", fee: CONFIG.FEE_PER_LESSON, note: "Nghỉ" }
];
const RUBRIC = {
    listening: { label: "Listening", items: ["Nghe ý chính", "Nghe chi tiết", "Phản xạ với câu hỏi", "Nhận diện từ/cụm quen thuộc"] },
    speaking: { label: "Speaking", items: ["Phát âm", "Độ trôi chảy", "Từ vựng nói", "Ngữ pháp khi nói", "Sự tự tin"] },
    reading: { label: "Reading", items: ["Đọc hiểu ý chính", "Đọc hiểu chi tiết", "Từ vựng", "Tốc độ đọc"] },
    writing: { label: "Writing", items: ["Chính tả", "Cấu trúc câu", "Ngữ pháp", "Triển khai ý"] },
    learningHabits: { label: "Hành vi học tập", items: ["Tập trung", "Hoàn thành bài tập", "Chủ động phát biểu", "Ghi nhớ bài cũ", "Thái độ khi gặp bài khó"] }
};

let currentFetchedLogs = {};
let currentActiveFamilyCode = "";
let currentStudentsInFamily = [];
let filteredLogsArray = [];
let currentPage = 1;
let currentSchedule = [];
let currentAssessments = {};
let currentFamilySettings = {};
let familyAssessments = {};
let currentBillingSummary = { sessions: 0, expected: 0, amount: 0 };

const UI = {
    showToast(msg, isError = false) {
        const t = document.getElementById("toast");
        t.textContent = msg;
        t.style.background = isError ? "var(--danger)" : "var(--success)";
        t.className = "show";
        setTimeout(() => t.className = "", 3500);
    },
    escapeHTML(str) {
        return str ? String(str).replace(/[&<>'"]/g, tag => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[tag])) : "";
    },
    formatHomeworkText(text) {
        if (!text) return "Không có";
        return this.escapeHTML(text).replace(/(https?:\/\/[^\s]+)/g, url => `<br><a href="${url}" target="_blank" class="download-btn">Tải tài liệu</a>`).replace(/\n/g, "<br>");
    },
    switchScreen(screenId) {
        const actualScreen = ["admin-family-overview-screen", "admin-editor-screen"].includes(screenId) ? "admin-app-screen" : screenId;
        ["admin-login-screen", "admin-search-family-screen", "admin-app-screen", "admin-family-overview-screen", "admin-editor-screen"].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.style.display = id === actualScreen ? "block" : "none";
        });
    },
    setLoading(btn, text, loading) {
        if (!btn) return;
        if (loading) {
            btn.dataset.originalText = btn.textContent;
            btn.textContent = text;
            btn.disabled = true;
        } else {
            btn.textContent = btn.dataset.originalText || btn.textContent;
            btn.disabled = false;
        }
    }
};

function normalizeStudents(value) {
    if (Array.isArray(value)) return value;
    if (value?.students && Array.isArray(value.students)) return value.students;
    if (value && typeof value === "object") return Object.values(value);
    return [];
}

function parseLogDate(d) {
    return d.includes("-")
        ? new Date(d.split("-")[0], d.split("-")[1] - 1, d.split("-")[2])
        : new Date(d.split("/")[2], d.split("/")[1] - 1, d.split("/")[0]);
}

function getBillingCycle() {
    const now = new Date();
    let m = now.getMonth(), y = now.getFullYear();
    if (now.getDate() < CONFIG.CYCLE_START_DAY) { m--; if (m < 0) { m = 11; y--; } }
    return {
        start: new Date(y, m, CONFIG.CYCLE_START_DAY, 0, 0, 0),
        end: new Date(y, m + 1, CONFIG.CYCLE_START_DAY - 1, 23, 59, 59),
        displayStart: `${CONFIG.CYCLE_START_DAY}/${m + 1}`,
        displayEnd: `${CONFIG.CYCLE_START_DAY - 1}/${(m + 1) % 12 + 1}`
    };
}

function getCycleLabelForDate(dateValue) {
    const date = dateValue instanceof Date ? dateValue : parseLogDate(dateValue);
    let month = date.getMonth();
    let year = date.getFullYear();
    if (date.getDate() < CONFIG.CYCLE_START_DAY) {
        month--;
        if (month < 0) { month = 11; year--; }
    }
    const endMonth = (month + 1) % 12;
    const endYear = month === 11 ? year + 1 : year;
    return `${CONFIG.CYCLE_START_DAY}/${month + 1}/${year} - ${CONFIG.CYCLE_START_DAY - 1}/${endMonth + 1}/${endYear}`;
}

function calculateExpectedSessions(cycle, scheduleData) {
    const schedule = (scheduleData && scheduleData.length ? scheduleData : DEFAULT_SCHEDULE)
        .filter(item => item.status && item.status !== "off")
        .map(item => Number(item.day));
    let count = 0;
    const cursor = new Date(cycle.start);
    while (cursor <= cycle.end) {
        const jsDay = cursor.getDay();
        const appDay = jsDay === 0 ? 8 : jsDay + 1;
        if (schedule.includes(appDay)) count++;
        cursor.setDate(cursor.getDate() + 1);
    }
    return count || 8;
}

function getCefr(score) {
    const n = Number(score || 0);
    if (n < 20) return "Pre-A1";
    if (n < 40) return "A1";
    if (n < 60) return "A2";
    if (n < 75) return "B1";
    if (n < 90) return "B2";
    return "C1";
}

function rubricScore(group) {
    const inputs = [...document.querySelectorAll(`[data-rubric-group="${group}"]`)];
    if (!inputs.length) return 0;
    const sum = inputs.reduce((acc, input) => acc + clamp(Number(input.value || 0), 0, 5), 0);
    return Math.round(sum / (inputs.length * 5) * 100);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function cycleLabelFromMonth(monthValue) {
    const [y, m] = monthValue.split("-").map(Number);
    return `${CONFIG.CYCLE_START_DAY}/${m}/${y} - ${CONFIG.CYCLE_START_DAY - 1}/${m === 12 ? 1 : m + 1}/${m === 12 ? y + 1 : y}`;
}

function modalConfirm({ title, message, input = false, okText = "Đồng ý", danger = true }) {
    return new Promise(resolve => {
        const modal = document.getElementById("confirmModal");
        const inputEl = document.getElementById("confirmInput");
        document.getElementById("confirmTitle").textContent = title;
        document.getElementById("confirmMessage").textContent = message;
        document.getElementById("btnConfirmOk").textContent = okText;
        document.getElementById("btnConfirmOk").className = danger ? "btn-main danger" : "btn-main success";
        inputEl.style.display = input ? "block" : "none";
        inputEl.value = "";
        modal.style.display = "flex";
        const cleanup = value => {
            modal.style.display = "none";
            ok.onclick = null;
            cancel.onclick = null;
            resolve(value);
        };
        const ok = document.getElementById("btnConfirmOk");
        const cancel = document.getElementById("btnConfirmCancel");
        ok.onclick = () => cleanup(input ? inputEl.value.trim() : true);
        cancel.onclick = () => cleanup(false);
    });
}

onAuthStateChanged(auth, (user) => {
    UI.switchScreen(user ? "admin-search-family-screen" : "admin-login-screen");
});

document.getElementById("btnLoginAdmin").addEventListener("click", () => {
    const btn = document.getElementById("btnLoginAdmin");
    UI.setLoading(btn, "ĐANG VÀO...", true);
    signInWithEmailAndPassword(auth, document.getElementById("adminEmail").value, document.getElementById("adminPass").value)
        .catch(() => UI.showToast("Sai email hoặc mật khẩu!", true))
        .finally(() => UI.setLoading(btn, "", false));
});
document.getElementById("btnLogoutAdmin").addEventListener("click", () => signOut(auth));

document.getElementById("btnSearchFamily").addEventListener("click", async () => {
    const code = document.getElementById("searchFamilyCode").value.trim().toUpperCase();
    const btn = document.getElementById("btnSearchFamily");
    if (!code) return UI.showToast("Vui lòng nhập mã!", true);
    UI.setLoading(btn, "ĐANG TÌM...", true);
    try {
        const snap = await get(ref(db, `Passcodes/${code}`));
        const students = snap.exists() ? normalizeStudents(snap.val()) : (FALLBACK_PASSCODES[code] || []);
        if (!students.length) return UI.showToast("Mã gia đình không tồn tại trong hệ thống!", true);
        currentActiveFamilyCode = code;
        currentStudentsInFamily = students;
        document.getElementById("displayFamilyCode").textContent = code;
        document.getElementById("btnOpenAnalytics").href = `${PARENT_APP_URL}/analytics?code=${encodeURIComponent(code)}`;
        const qrContainer = document.getElementById("qrCodeContainer");
        qrContainer.innerHTML = "";
        const parentUrl = `${PARENT_APP_URL}/?code=${encodeURIComponent(code)}`;
        new QRCode(qrContainer, { text: parentUrl, width: 128, height: 128 });
        populateStudentSelect();
        document.getElementById("logDate").valueAsDate = new Date();
        document.getElementById("assessmentMonth").value = new Date().toISOString().slice(0, 7);
        generateBillingCycles();
        loadStudentLogs();
        listenToFeedbacksForFamily();
        loadBroadcast();
        loadSchedule();
        buildRubricForm();
        loadAssessmentsForCurrentStudent();
        loadBillingSettings();
        loadFamilyAnalytics();
        renderFamilyOverview(students);
        UI.switchScreen("admin-app-screen");
    } finally {
        UI.setLoading(btn, "", false);
    }
});

document.getElementById("btnBackToSearch").addEventListener("click", () => UI.switchScreen("admin-search-family-screen"));
document.getElementById("btnGoToWriteReport")?.addEventListener("click", () => {
    populateStudentSelect();
    document.getElementById("logDate").valueAsDate = new Date();
    document.getElementById("assessmentMonth").value = new Date().toISOString().slice(0, 7);
    generateBillingCycles();
    loadStudentLogs();
    listenToFeedbacksForFamily();
    loadBroadcast();
    loadSchedule();
    buildRubricForm();
    loadAssessmentsForCurrentStudent();
    UI.switchScreen("admin-editor-screen");
});
document.getElementById("btnBackToOverview")?.addEventListener("click", () => {
    renderFamilyOverview(currentStudentsInFamily);
    UI.switchScreen("admin-family-overview-screen");
});

function populateStudentSelect() {
    const select = document.getElementById("studentId");
    const options = currentStudentsInFamily.map(st => {
        const meta = STUDENT_META[st] || { fullName: `Bé ${st}` };
        return `<option value="${UI.escapeHTML(st)}">${UI.escapeHTML(meta.fullName)}</option>`;
    }).join("");
    select.innerHTML = options;
    const dataFilter = document.getElementById("dataStudentFilter");
    if (dataFilter) dataFilter.innerHTML = `<option value="all">Tất cả học sinh</option>` + options;
}

function renderFamilyOverview(studentsArray) {
    Promise.all(studentsArray.map(id => get(ref(db, `Students/${id}`)).then(snap => [id, snap.val() || {}]))).then(entries => {
        const all = Object.fromEntries(entries);
        const container = document.getElementById("admin-overview-container");
        const cycle = getBillingCycle();
        let uniqueDatesInCycle = new Set();
        let studentCardsHtml = "";
        let totalClassesExpected = 8;

        studentsArray.forEach((id, index) => {
            const s = all[id] || {};
            const meta = STUDENT_META[id] || { fullName: `Bé ${id}`, avatar: "https://via.placeholder.com/60" };
            const color = index % 2 === 0 ? "#6c5ce7" : "#00b894";
            const grad = index % 2 === 0 ? "linear-gradient(90deg, #6c5ce7, #a29bfe)" : "linear-gradient(90deg, #00b894, #55efc4)";
            let logsHtml = "";
            if (s.logs) {
                const sortedDates = Object.keys(s.logs).sort().reverse();
                sortedDates.forEach(d => {
                    const logDate = parseLogDate(d);
                    if (logDate >= cycle.start && logDate <= cycle.end) uniqueDatesInCycle.add(d);
                });
                sortedDates.forEach(d => {
                    const l = s.logs[d];
                    const ratingStar = l.parentRating ? `⭐ ${l.parentRating}/5` : "";
                    const cycleLabel = getCycleLabelForDate(d);
                    const searchText = `${id} ${d} ${l.date || ""} ${cycleLabel} ${l.content || ""} ${l.homework || ""}`.toLowerCase();
                    logsHtml += `<div class="overview-log-entry" data-overview-search="${UI.escapeHTML(searchText)}">
                        <div class="cycle-label">Kỳ ${cycleLabel}</div>
                        <div class="log-box">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                            <div style="font-weight:800; color:${color};">${l.date || d} <span style="color:#fdcb6e; font-size:0.8rem;">${ratingStar}</span></div>
                            <div style="font-size:0.85rem; font-weight:800;">${UI.escapeHTML(l.attitude).split(" ")[0]}</div>
                        </div>
                        <div style="margin-bottom:10px; line-height:1.5; font-size:0.9rem;">${UI.escapeHTML(l.content || "")}</div>
                        ${l.homework ? `<div class="muted-sm"><strong>Bài tập:</strong> ${UI.escapeHTML(l.homework)}</div>` : ""}
                    </div></div>`;
                });
            }
            studentCardsHtml += `<div class="student-card" style="border-top-color:${color}">
                <div class="student-header">
                    <img src="${meta.avatar}" class="student-avatar" style="border-color:${color}">
                    <div class="student-info"><h3>${UI.escapeHTML(meta.fullName)}</h3><p>ID: ${UI.escapeHTML(id)}</p></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-weight:800; margin-bottom:12px;"><span>Tiến độ</span><span style="color:${color}">${s.progress || 0}%</span></div>
                <div class="progress-bar"><div class="progress-fill" style="width:${s.progress || 0}%;background:${grad}"></div></div>
                <div class="logs-container">${logsHtml || "<p>Chưa có báo cáo nào.</p>"}</div>
            </div>`;
        });

        const totalSessions = uniqueDatesInCycle.size;
        const expectedSessions = calculateExpectedSessions(cycle, currentSchedule);
        const attendanceRate = expectedSessions ? Math.min(100, Math.round((totalSessions / expectedSessions) * 100)) : 0;
        document.getElementById("attendanceRate").innerText = attendanceRate;
        const feePerLesson = Number(currentFamilySettings.feePerLesson || CONFIG.FEE_PER_LESSON);
        currentBillingSummary = { sessions: totalSessions, expected: expectedSessions, amount: totalSessions * feePerLesson, cycle };
        const billingHtml = `<div style="width:100%; background:linear-gradient(135deg,#ebfbee,#d3f9d8); padding:30px; border-radius:24px; margin-top:10px; border:2px solid #b2f2bb; color:#2d3436;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;">
                <div><div style="font-size:1.1rem; font-weight:900; color:#2b8a3e; margin-bottom:5px;">Tổng học phí kỳ hiện tại</div><div>Từ ngày ${cycle.displayStart} đến ${cycle.displayEnd}</div></div>
                <div style="text-align:right;"><div style="font-size:2.2rem; font-weight:900; color:#2b8a3e">${currentBillingSummary.amount.toLocaleString("vi-VN")} đ</div><div style="font-size:1rem; color:#5c940d; font-weight:800; margin-top:5px;">Đã dạy: ${totalSessions}/${expectedSessions} buổi dự kiến</div></div>
            </div>
        </div>`;
        container.innerHTML = `<div class="family-students-grid">${studentCardsHtml}</div>` + billingHtml;
        bindOverviewSearch();
        renderBillingTab();
    });
}

function bindOverviewSearch() {
    const input = document.getElementById("overviewSearch");
    if (!input || input.dataset.bound === "true") return;
    input.dataset.bound = "true";
    input.addEventListener("input", () => {
        const keyword = input.value.trim().toLowerCase();
        document.querySelectorAll(".overview-log-entry").forEach(entry => {
            entry.style.display = !keyword || (entry.dataset.overviewSearch || "").includes(keyword) ? "block" : "none";
        });
    });
}

function generateBillingCycles() {
    const select = document.getElementById("cycleFilter");
    const now = new Date();
    let m = now.getMonth(), y = now.getFullYear();
    if (now.getDate() < 16) { m--; if (m < 0) { m = 11; y--; } }
    let html = '<option value="all">Xem tất cả thời gian</option>';
    for (let i = 0; i < 12; i++) {
        let sm = m - i, sy = y;
        while (sm < 0) { sm += 12; sy--; }
        const start = new Date(sy, sm, 16).getTime();
        const end = new Date(sy, sm + 1, 15, 23, 59, 59).getTime();
        html += `<option value="${start}_${end}" ${i===0 ? "selected" : ""}>Kỳ học: 16/${sm+1}/${sy} -> 15/${(sm+1)%12+1}/${sm===11?sy+1:sy} ${i===0 ? "(Kỳ này)" : ""}</option>`;
    }
    select.innerHTML = html;
}

document.getElementById("studentId").addEventListener("change", () => { loadStudentLogs(); loadAssessmentsForCurrentStudent(); });
document.getElementById("cycleFilter").addEventListener("change", () => { currentPage = 1; processLogs(); });
document.getElementById("logSearch").addEventListener("input", () => { currentPage = 1; processLogs(); });
document.getElementById("progressRange").addEventListener("input", function() { document.getElementById("progress").value = this.value; });
document.getElementById("progress").addEventListener("input", function() { document.getElementById("progressRange").value = this.value; });
document.getElementById("btnUpdateBroadcast").addEventListener("click", updateBroadcast);
document.getElementById("btnAttachMat").addEventListener("click", attachMaterial);
document.getElementById("btnSubmit").addEventListener("click", saveReport);
document.getElementById("btnCancel").addEventListener("click", cancelEdit);
document.getElementById("btnExportPDF").addEventListener("click", exportToPDF);
document.getElementById("btnPrevPage").addEventListener("click", () => { if(currentPage > 1) { currentPage--; renderPaginatedLogs(); } });
document.getElementById("btnNextPage").addEventListener("click", () => { if(currentPage * CONFIG.LOGS_PER_PAGE < filteredLogsArray.length) { currentPage++; renderPaginatedLogs(); } });
document.querySelectorAll(".quick-tag").forEach(btn => {
    btn.addEventListener("click", function() {
        const el = document.getElementById("content");
        el.value = el.value ? el.value + "\n" + this.getAttribute("data-insert") : this.getAttribute("data-insert");
    });
});

document.getElementById("themeToggleAdmin").addEventListener("click", () => {
    const root = document.documentElement;
    const newTheme = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", newTheme);
    localStorage.setItem("adminTheme", newTheme);
});
if (localStorage.getItem("adminTheme") === "dark") document.documentElement.setAttribute("data-theme", "dark");

function loadBroadcast() {
    onValue(ref(db, `Families/${currentActiveFamilyCode}/broadcast`), snap => {
        document.getElementById("broadcastMsg").value = snap.val() || "";
    });
}

function updateBroadcast() {
    const msg = document.getElementById("broadcastMsg").value;
    set(ref(db, `Families/${currentActiveFamilyCode}/broadcast`), msg).then(() => {
        const ts = Date.now().toString();
        let updates = {};
        currentStudentsInFamily.forEach(st => {
            updates[`Students/${st}/notifications/${ts}`] = { type: "general", title: `${CONFIG.TEACHER_DISPLAY_NAME || "Giáo viên"} thông báo chung`, content: msg, time: new Date().toLocaleString("vi-VN") };
        });
        update(ref(db), updates).then(() => UI.showToast("Đã phát thông báo tới gia đình này!"));
    });
}

function loadBillingSettings() {
    onValue(ref(db, `Families/${currentActiveFamilyCode}/settings`), snap => {
        currentFamilySettings = snap.val() || {};
        const payment = currentFamilySettings.payment || {};
        document.getElementById("billingFeePerLesson").value = currentFamilySettings.feePerLesson || CONFIG.FEE_PER_LESSON;
        document.getElementById("billingBankId").value = payment.bankId || PAYMENT_CONFIG.bankId || "";
        document.getElementById("billingAccountNo").value = payment.accountNo || PAYMENT_CONFIG.accountNo || "";
        document.getElementById("billingAccountName").value = payment.accountName || PAYMENT_CONFIG.accountName || "";
        document.getElementById("billingTransferContent").value = payment.content || `Hoc phi ${currentStudentsInFamily.join(" va ")}`;
        renderBillingTab();
        if (currentStudentsInFamily.length) renderFamilyOverview(currentStudentsInFamily);
    });
}

document.getElementById("btnSaveBillingSettings").addEventListener("click", () => {
    if (!currentActiveFamilyCode) return UI.showToast("Chọn gia đình trước khi lưu.", true);
    const payload = {
        feePerLesson: Math.max(0, Number(document.getElementById("billingFeePerLesson").value || CONFIG.FEE_PER_LESSON)),
        payment: {
            bankId: document.getElementById("billingBankId").value.trim().toUpperCase(),
            accountNo: document.getElementById("billingAccountNo").value.trim(),
            accountName: document.getElementById("billingAccountName").value.trim().toUpperCase(),
            content: document.getElementById("billingTransferContent").value.trim()
        }
    };
    update(ref(db, `Families/${currentActiveFamilyCode}/settings`), payload)
        .then(() => UI.showToast("Đã cập nhật học phí và thông tin QR."))
        .catch(error => UI.showToast(`Không thể lưu: ${error.message}`, true));
});

function renderBillingTab() {
    const container = document.getElementById("billing-admin-container");
    const qrContainer = document.getElementById("qrCodeContainer2");
    if (!container || !qrContainer) return;
    const fee = Number(currentFamilySettings.feePerLesson || CONFIG.FEE_PER_LESSON);
    const payment = currentFamilySettings.payment || {};
    const amount = Number(currentBillingSummary.sessions || 0) * fee;
    container.innerHTML = `<div class="billing-summary-grid">
        <div class="billing-stat">Số buổi đã học<strong>${currentBillingSummary.sessions || 0}</strong></div>
        <div class="billing-stat">Học phí / buổi<strong>${fee.toLocaleString("vi-VN")} đ</strong></div>
        <div class="billing-stat">Tổng học phí<strong>${amount.toLocaleString("vi-VN")} đ</strong></div>
    </div>
    <p class="muted-sm">Kỳ ${currentBillingSummary.cycle ? `${currentBillingSummary.cycle.displayStart} - ${currentBillingSummary.cycle.displayEnd}` : "hiện tại"}. Hai bé học chung nên tính theo số buổi chung.</p>`;

    const bankId = payment.bankId || PAYMENT_CONFIG.bankId || "";
    const accountNo = payment.accountNo || PAYMENT_CONFIG.accountNo || "";
    const accountName = payment.accountName || PAYMENT_CONFIG.accountName || "";
    const content = payment.content || PAYMENT_CONFIG.content || `Hoc phi ${currentStudentsInFamily.join(" va ")}`;
    if (!accountNo) {
        qrContainer.innerHTML = '<p class="muted-sm">Nhập số tài khoản rồi lưu để tạo QR.</p>';
        return;
    }
    const qrUrl = `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(accountNo)}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(accountName)}`;
    qrContainer.innerHTML = `<div style="text-align:center;width:100%;">
        <img class="payment-qr-image" src="${qrUrl}" alt="QR thanh toán học phí">
        <p style="font-weight:900;margin:10px 0 2px;">${UI.escapeHTML(accountName)} - ${UI.escapeHTML(accountNo)}</p>
        <p class="muted-sm">Nội dung: ${UI.escapeHTML(content)}</p>
    </div>`;
}

function loadSchedule() {
    onValue(ref(db, `Families/${currentActiveFamilyCode}/schedule`), snap => {
        const value = snap.val();
        currentSchedule = Array.isArray(value) ? value : (value ? Object.values(value) : DEFAULT_SCHEDULE);
        renderScheduleList();
        if (currentStudentsInFamily.length) renderFamilyOverview(currentStudentsInFamily);
    });
}

function renderScheduleList() {
    const days = {2:"Thứ 2",3:"Thứ 3",4:"Thứ 4",5:"Thứ 5",6:"Thứ 6",7:"Thứ 7",8:"Chủ nhật"};
    const labels = { fixed:"Cố định", changed:"Đổi lịch", makeup:"Học bù", off:"Nghỉ" };
    const normalized = DEFAULT_SCHEDULE.map(d => ({ ...d, ...(currentSchedule.find(x => Number(x.day) === d.day) || {}) }));
    currentSchedule = normalized;
    document.getElementById("scheduleList").innerHTML = normalized.map(item => `<div class="mini-item">
        <strong>${days[item.day]}</strong> - ${labels[item.status] || item.status} ${item.status !== "off" ? `${item.start || "--:--"} - ${item.end || "--:--"}` : ""}
        <br><span class="muted">${Number(item.fee || CONFIG.FEE_PER_LESSON).toLocaleString("vi-VN")}đ/buổi ${item.note ? "- " + UI.escapeHTML(item.note) : ""}</span>
    </div>`).join("");
}

document.getElementById("btnSaveSchedule").addEventListener("click", () => {
    const day = Number(document.getElementById("scheduleDay").value);
    const item = {
        day,
        status: document.getElementById("scheduleStatus").value,
        start: document.getElementById("scheduleStart").value,
        end: document.getElementById("scheduleEnd").value,
        fee: Number(document.getElementById("scheduleFee").value || CONFIG.FEE_PER_LESSON),
        note: document.getElementById("scheduleNote").value.trim()
    };
    currentSchedule = DEFAULT_SCHEDULE.map(d => ({ ...d, ...(currentSchedule.find(x => Number(x.day) === d.day) || {}) }));
    const idx = currentSchedule.findIndex(x => Number(x.day) === day);
    if (idx >= 0) currentSchedule[idx] = item;
    else currentSchedule.push(item);
    set(ref(db, `Families/${currentActiveFamilyCode}/schedule`), currentSchedule).then(() => UI.showToast("Đã lưu lịch học."));
});

function attachMaterial() {
    const name = document.getElementById("matName").value.trim();
    const url = document.getElementById("matUrl").value.trim();
    if(!url) return UI.showToast("Vui lòng dán link URL!", true);
    const formatString = name ? `${name}: ${url}` : url;
    const hw = document.getElementById("homework");
    hw.value = hw.value ? hw.value + "\n" + formatString : formatString;
    document.getElementById("matName").value = "";
    document.getElementById("matUrl").value = "";
    UI.showToast("Đã chèn liên kết học liệu.");
}

function listenToFeedbacksForFamily() {
    onValue(ref(db, `Families/${currentActiveFamilyCode}/feedbacks`), snap => {
        const familyFeedbacks = snap.val() || {};
        const fb = Object.keys(familyFeedbacks).map(k => ({ id: k, type: familyFeedbacks[k].type || "Lịch học chung", studentId: "General", path: `Families/${currentActiveFamilyCode}/feedbacks/${k}`, ...familyFeedbacks[k] }));
        const studentPromises = currentStudentsInFamily.map(st => get(ref(db, `Students/${st}/feedbacks`)).then(s => ({ st, val: s.val() || {} })));
        Promise.all(studentPromises).then(results => {
            results.forEach(({st, val}) => Object.keys(val).forEach(k => fb.push({ id: k, type: `Bé ${st}`, studentId: st, path: `Students/${st}/feedbacks/${k}`, ...val[k] })));
            fb.sort((a, b) => String(b.id).localeCompare(String(a.id)));
            renderFeedbacks(fb);
        });
    });
}

function renderFeedbacks(fb) {
    document.getElementById("unreadCount").innerText = fb.length;
    const listDiv = document.getElementById("admin-feedbacks-list");
    if (fb.length === 0) return listDiv.innerHTML = '<p class="muted" style="text-align:center;">Hòm thư trống.</p>';
    listDiv.innerHTML = fb.map(f => {
        const borderColor = f.type === "Thanh toán" ? "#00b894" : "#0984e3";
        return `<div class="feedback-card" style="border-left-color:${borderColor}">
            <div style="display:flex; justify-content:space-between; margin-bottom:5px; gap:8px;">
                <strong style="color:${borderColor}; font-size:0.85rem;">${UI.escapeHTML(f.type)}</strong>
                <span style="font-size:0.75rem; color:#636e72;">${UI.escapeHTML(f.date || "")}</span>
            </div>
            <div style="font-size:0.95rem;">${UI.escapeHTML(f.content).replace(/\n/g, "<br>")}</div>
            <div class="feedback-actions">
                <button class="btn-sm success" data-action="reply" data-studentid="${UI.escapeHTML(f.studentId)}">Phản hồi</button>
                <button class="btn-sm danger" data-action="delete" data-path="${UI.escapeHTML(f.path)}">Xóa</button>
            </div>
        </div>`;
    }).join("");
}

function loadStudentLogs() {
    const stId = document.getElementById("studentId").value;
    if (!stId) return;
    onValue(ref(db, "Students/" + stId), snap => {
        const data = snap.val();
        if (!data) {
            currentFetchedLogs = {};
            document.getElementById("admin-logs-list").innerHTML = "<p>Chưa có dữ liệu.</p>";
            return;
        }
        document.getElementById("progress").value = data.progress || 0;
        document.getElementById("progressRange").value = data.progress || 0;
        currentFetchedLogs = data.logs || {};
        processLogs();
    });
}

function processLogs() {
    const cycleVal = document.getElementById("cycleFilter").value;
    const kw = document.getElementById("logSearch").value.trim().toLowerCase();
    filteredLogsArray = [];
    Object.keys(currentFetchedLogs).sort().reverse().forEach(k => {
        const l = currentFetchedLogs[k];
        const t = parseLogDate(k).getTime();
        const passC = cycleVal === "all" || (t >= parseInt(cycleVal.split("_")[0]) && t <= parseInt(cycleVal.split("_")[1]));
        const passK = !kw || (l.content || "").toLowerCase().includes(kw) || (l.homework || "").toLowerCase().includes(kw) || k.includes(kw);
        if (passC && passK) filteredLogsArray.push({ key: k, data: l });
    });
    document.getElementById("totalLessons").innerText = filteredLogsArray.length;
    renderPaginatedLogs();
}

function renderPaginatedLogs() {
    let html = "";
    const start = (currentPage - 1) * CONFIG.LOGS_PER_PAGE;
    const paginatedItems = filteredLogsArray.slice(start, start + CONFIG.LOGS_PER_PAGE);
    paginatedItems.forEach(item => {
        const k = item.key, l = item.data;
        const editTag = l.editHistory ? `<button class="btn-sm neutral" data-action="history" data-key="${k}">Đã sửa</button>` : "";
        html += `<div class="log-item-card">
            <div>
                <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:10px; border-bottom:1px solid var(--border-color); padding-bottom:6px;">
                    <span style="font-weight:900; color:var(--primary)">${l.date || k} ${editTag}</span>
                    <span style="background:var(--bg); padding:2px 8px; border-radius:6px; font-size:0.75rem; font-weight:800;">${UI.escapeHTML(l.attitude).split(" ")[0]}</span>
                </div>
                <div style="font-size:0.9rem; margin-bottom:8px;"><strong>Nội dung:</strong><br>${UI.escapeHTML(l.content).replace(/\n/g, "<br>")}</div>
                ${l.homework ? `<div style="font-size:0.85rem; color:#636e72; background:var(--bg); padding:8px; border-radius:8px;"><strong>Link/Bài tập:</strong><br>${UI.escapeHTML(l.homework).replace(/\n/g, "<br>")}</div>` : ""}
            </div>
            <div style="text-align:right; margin-top:12px; border-top:1px dashed var(--border-color); padding-top:8px;">
                <button class="btn-sm warning" data-action="edit" data-key="${k}">Sửa</button>
                <button class="btn-sm danger" data-action="delete" data-key="${k}">Xóa</button>
            </div>
        </div>`;
    });
    document.getElementById("admin-logs-list").innerHTML = html || "<p>Trống.</p>";
    const totalPages = Math.ceil(filteredLogsArray.length / CONFIG.LOGS_PER_PAGE) || 1;
    document.getElementById("pageInfo").innerText = `${currentPage} / ${totalPages}`;
    document.getElementById("btnPrevPage").disabled = currentPage === 1;
    document.getElementById("btnNextPage").disabled = currentPage === totalPages;
}

document.getElementById("admin-logs-list").addEventListener("click", async function(e) {
    if (e.target.tagName !== "BUTTON") return;
    const action = e.target.getAttribute("data-action");
    const key = e.target.getAttribute("data-key");
    if (action === "edit") {
        const log = currentFetchedLogs[key];
        startEdit(key, log.attitude, log.content, log.homework);
    } else if (action === "delete") {
        const stId = document.getElementById("studentId").value;
        const ok = await modalConfirm({ title: "Xóa báo cáo", message: `Xóa báo cáo ngày ${key}?` });
        if (ok) remove(ref(db, `Students/${stId}/logs/${key}`));
    } else if (action === "history") {
        showHistory(key);
    }
});

document.getElementById("admin-feedbacks-list").addEventListener("click", async function(e) {
    if (e.target.tagName !== "BUTTON") return;
    const action = e.target.getAttribute("data-action");
    if (action === "reply") {
        const studentId = e.target.getAttribute("data-studentid");
        if(studentId === "General") return UI.showToast("Dùng loa thông báo để trả lời lịch học chung nhé!", true);
        const msg = await modalConfirm({ title: `Phản hồi bé ${studentId}`, message: "Nhập nội dung phản hồi cho phụ huynh:", input: true, okText: "Gửi", danger: false });
        if(!msg) return;
        const ts = Date.now();
        set(ref(db, `Students/${studentId}/notifications/${ts}`), { type: "reply", title: `${CONFIG.TEACHER_DISPLAY_NAME || "Giáo viên"} phản hồi`, content: msg, time: new Date().toLocaleString("vi-VN") })
            .then(() => UI.showToast("Đã gửi phản hồi lên app phụ huynh!"));
    } else if (action === "delete") {
        const path = e.target.getAttribute("data-path");
        const ok = await modalConfirm({ title: "Xóa tin nhắn", message: "Xóa tin nhắn này khỏi hòm thư?" });
        if(ok) remove(ref(db, path)).then(() => UI.showToast("Đã dọn tin nhắn."));
    }
});

function saveReport() {
    const id = document.getElementById("studentId").value;
    const date = document.getElementById("logDate").value;
    const p = document.getElementById("progress").value;
    const c = document.getElementById("content").value;
    const hw = document.getElementById("homework").value;
    const a = document.getElementById("attitude").value;
    const both = document.getElementById("saveForBoth").checked;
    if(!p || !c || !date) return UI.showToast("Nhập đủ ngày, tiến độ và nội dung!", true);
    const key = document.getElementById("editingDateKey").value || date;
    const logData = { date: date.split("-").reverse().join("/"), content: c, homework: hw, attitude: a, updatedAt: Date.now() };
    if (document.getElementById("editingDateKey").value && currentFetchedLogs[key]) {
        const oldData = currentFetchedLogs[key];
        logData.editHistory = oldData.editHistory || [];
        logData.editHistory.push({ content: oldData.content, updatedAt: oldData.updatedAt || Date.now() });
    }
    let updates = {};
    const ts = Date.now();
    const isMat = hw.includes("http");
    const notifPayload = { type: isMat ? "material" : "report", title: isMat ? "Bài tập / tài liệu mới" : "Cập nhật báo cáo học", content: `${CONFIG.TEACHER_DISPLAY_NAME || "Giáo viên"} cập nhật nội dung học ngày ${logData.date}`, time: new Date().toLocaleString("vi-VN") };
    const targetStudents = both ? currentStudentsInFamily : [id];
    targetStudents.forEach(st => {
        updates[`Students/${st}/progress`] = parseInt(p);
        updates[`Students/${st}/logs/${key}`] = logData;
        updates[`Students/${st}/notifications/${ts}`] = notifPayload;
    });
    update(ref(db), updates).then(() => { UI.showToast(both ? "Đã lưu cho tất cả bé!" : "Đã lưu báo cáo!"); cancelEdit(); });
}

function startEdit(k, a, c, h) {
    document.getElementById("logDate").value = k;
    document.getElementById("attitude").value = a;
    document.getElementById("content").value = c;
    document.getElementById("homework").value = h || "";
    document.getElementById("editingDateKey").value = k;
    document.getElementById("formTitle").innerText = "Sửa ngày: " + k;
    document.getElementById("btnSubmit").innerText = "Cập nhật";
    document.getElementById("btnSubmit").className = "btn-main warning";
    document.getElementById("btnCancel").style.display = "block";
    document.getElementById("saveForBoth").checked = false;
    window.scrollTo({top: 0, behavior: "smooth"});
}

function cancelEdit() {
    document.getElementById("logDate").valueAsDate = new Date();
    document.getElementById("content").value = "";
    document.getElementById("homework").value = "";
    document.getElementById("editingDateKey").value = "";
    document.getElementById("formTitle").innerText = "Soạn báo cáo mới";
    document.getElementById("btnSubmit").innerText = "Lưu báo cáo";
    document.getElementById("btnSubmit").className = "btn-main success";
    document.getElementById("btnCancel").style.display = "none";
    document.getElementById("saveForBoth").checked = false;
}

function showHistory(key) {
    const history = currentFetchedLogs[key].editHistory || [];
    document.getElementById("historyContent").innerHTML = history.map((h, idx) => `<div style="border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:10px;">
        <div style="font-size:0.8rem; color:#636e72;">Lần sửa ${idx + 1} - ${new Date(h.updatedAt).toLocaleString("vi-VN")}</div>
        <div style="font-size:0.9rem;">${UI.escapeHTML(h.content).replace(/\n/g, "<br>")}</div>
    </div>`).join("");
    document.getElementById("historyModal").style.display = "flex";
}

function buildRubricForm() {
    document.getElementById("rubricGrid").innerHTML = Object.entries(RUBRIC).map(([group, cfg]) => `<div class="rubric-card">
        <h4>${cfg.label}</h4>
        ${cfg.items.map((item, index) => `<label class="rubric-row"><span>${item}</span><input type="number" min="0" max="5" step="0.5" data-rubric-group="${group}" data-rubric-index="${index}" value="3"></label>`).join("")}
    </div>`).join("");
    document.querySelectorAll("[data-rubric-group], #monthlyTest").forEach(el => el.addEventListener("input", updateAssessmentPreview));
    updateAssessmentPreview();
}

function getRubricValues() {
    const values = {};
    Object.keys(RUBRIC).forEach(group => {
        values[group] = [...document.querySelectorAll(`[data-rubric-group="${group}"]`)].map(input => clamp(Number(input.value || 0), 0, 5));
    });
    return values;
}

function updateAssessmentPreview() {
    const listening = rubricScore("listening");
    const speaking = rubricScore("speaking");
    const reading = rubricScore("reading");
    const writing = rubricScore("writing");
    const monthlyTest = clamp(Number(document.getElementById("monthlyTest").value || 0), 0, 100);
    const skillAvg = Math.round((listening + speaking + reading + writing) / 4);
    const overall = Math.round(skillAvg * 0.7 + monthlyTest * 0.3);
    document.getElementById("assessmentPreview").innerHTML = `Nghe ${listening} | Nói ${speaking} | Đọc ${reading} | Viết ${writing} | Test ${monthlyTest} | Tổng ${overall} | CEFR ${getCefr(overall)}`;
}

document.getElementById("btnSaveAssessment").addEventListener("click", saveAssessment);
document.getElementById("btnExportCsv").addEventListener("click", () => exportAssessment("csv"));
document.getElementById("btnExportJson").addEventListener("click", () => exportAssessment("json"));
document.getElementById("assessmentMonth").addEventListener("change", loadAssessmentIntoForm);

function saveAssessment() {
    const stId = document.getElementById("studentId").value;
    const month = document.getElementById("assessmentMonth").value;
    if (!stId || !month) return UI.showToast("Chọn bé và tháng đánh giá.", true);
    const listening = rubricScore("listening");
    const speaking = rubricScore("speaking");
    const reading = rubricScore("reading");
    const writing = rubricScore("writing");
    const learningHabits = rubricScore("learningHabits");
    const monthlyTest = clamp(Number(document.getElementById("monthlyTest").value || 0), 0, 100);
    const skillAvg = Math.round((listening + speaking + reading + writing) / 4);
    const overall = Math.round(skillAvg * 0.7 + monthlyTest * 0.3);
    const payload = {
        cycle: month,
        cycleLabel: cycleLabelFromMonth(month),
        listening, speaking, reading, writing, learningHabits, monthlyTest, skillAvg, overall,
        cefr: getCefr(overall),
        rubric: getRubricValues(),
        materials: document.getElementById("learningMaterials").value.trim(),
        comment: document.getElementById("assessmentComment").value.trim(),
        advice: document.getElementById("assessmentAdvice").value.trim(),
        nextFocus: document.getElementById("nextFocus").value.trim(),
        updatedAt: Date.now()
    };
    set(ref(db, `Students/${stId}/assessments/${month}`), payload).then(() => {
        UI.showToast(`Đã lưu đánh giá kỳ ${month} cho bé ${stId}.`);
        renderSavedCyclesList(stId);
        loadFamilyAnalytics();
    });
}

let _assessmentUnsubscribe = null;
function loadAssessmentsForCurrentStudent() {
    const stId = document.getElementById("studentId").value;
    if (!stId) return;
    if (_assessmentUnsubscribe) { _assessmentUnsubscribe(); _assessmentUnsubscribe = null; }
    _assessmentUnsubscribe = onValue(ref(db, `Students/${stId}/assessments`), snap => {
        currentAssessments = snap.val() || {};
        renderSavedCyclesList(stId);
        if (!document.getElementById("assessmentComment").value && !document.getElementById("monthlyTest").value) {
            loadAssessmentIntoForm();
        }
    });
}

function renderSavedCyclesList(stId) {
    const keys = Object.keys(currentAssessments).sort().reverse();
    const container = document.getElementById("savedCyclesList");
    if (!container) return;
    if (!keys.length) {
        container.innerHTML = `<p style="color:#b2bec3;font-size:0.85rem;margin:0;">Chưa có kỳ nào được lưu.</p>`;
        return;
    }
    container.innerHTML = keys.map(k => {
        const d = currentAssessments[k];
        const isSelected = document.getElementById("assessmentMonth").value === k;
        return `<button type="button" data-assessment-cycle="${k}" style="display:flex;width:100%;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:10px;cursor:pointer;
            background:${isSelected ? "#e0e7ff" : "#f8fafc"};border:1.5px solid ${isSelected ? "#6c5ce7" : "#e2e8f0"};margin-bottom:6px;font-family:inherit;">
            <span style="font-weight:800;color:#6c5ce7;font-size:0.9rem;">${k}</span>
            <span style="font-size:0.82rem;color:#636e72;">${d.cycleLabel || ""}</span>
            <span style="font-size:0.82rem;font-weight:800;color:#2d3436;">Tổng: ${d.overall ?? "-"} | ${d.cefr || "-"}</span>
        </button>`;
    }).join("");
}

document.getElementById("savedCyclesList").addEventListener("click", event => {
    const button = event.target.closest("[data-assessment-cycle]");
    if (!button) return;
    document.getElementById("assessmentMonth").value = button.dataset.assessmentCycle;
    loadAssessmentIntoForm();
    renderSavedCyclesList(document.getElementById("studentId").value);
});

function loadAssessmentIntoForm() {
    const month = document.getElementById("assessmentMonth").value;
    const data = currentAssessments[month];
    if (!data) {
        document.getElementById("monthlyTest").value = "";
        document.getElementById("learningMaterials").value = "";
        document.getElementById("assessmentComment").value = "";
        document.getElementById("assessmentAdvice").value = "";
        document.getElementById("nextFocus").value = "";
        updateAssessmentPreview();
        return;
    }
    Object.keys(RUBRIC).forEach(group => {
        const values = data.rubric?.[group] || [];
        document.querySelectorAll(`[data-rubric-group="${group}"]`).forEach((input, idx) => input.value = values[idx] ?? 3);
    });
    document.getElementById("monthlyTest").value = data.monthlyTest ?? "";
    document.getElementById("learningMaterials").value = data.materials || "";
    document.getElementById("assessmentComment").value = data.comment || "";
    document.getElementById("assessmentAdvice").value = data.advice || "";
    document.getElementById("nextFocus").value = data.nextFocus || "";
    updateAssessmentPreview();
}

function loadFamilyAnalytics() {
    if (!currentStudentsInFamily.length) return;
    Promise.all(currentStudentsInFamily.map(studentId =>
        get(ref(db, `Students/${studentId}/assessments`)).then(snap => [studentId, snap.val() || {}])
    )).then(entries => {
        familyAssessments = Object.fromEntries(entries);
        renderDataTab();
    }).catch(error => {
        document.getElementById("data-chart-container").innerHTML = `<p class="muted-sm">Không tải được dữ liệu: ${UI.escapeHTML(error.message)}</p>`;
    });
}

document.getElementById("dataStudentFilter").addEventListener("change", renderDataTab);
document.getElementById("dataSearch").addEventListener("input", renderDataTab);

function getFamilyAssessmentRows() {
    return Object.entries(familyAssessments).flatMap(([studentId, assessments]) =>
        Object.keys(assessments || {}).map(cycle => ({ studentId, cycle, ...assessments[cycle] }))
    ).sort((a, b) => String(a.cycle).localeCompare(String(b.cycle)));
}

function renderDataTab() {
    const filter = document.getElementById("dataStudentFilter").value || "all";
    const keyword = document.getElementById("dataSearch").value.trim().toLowerCase();
    const allRows = getFamilyAssessmentRows();
    const rows = allRows.filter(row => {
        const matchesStudent = filter === "all" || row.studentId === filter;
        const haystack = `${row.studentId} ${row.cycle} ${row.cycleLabel || ""} ${row.cefr || ""} ${row.comment || ""} ${row.advice || ""} ${row.materials || ""}`.toLowerCase();
        return matchesStudent && (!keyword || haystack.includes(keyword));
    });
    renderDataChart(filter, allRows);
    renderDataTable(rows);
}

function renderDataChart(filter, allRows) {
    const container = document.getElementById("data-chart-container");
    const chartRows = filter === "all" ? allRows : allRows.filter(row => row.studentId === filter);
    if (!chartRows.length) {
        container.innerHTML = '<p class="muted-sm">Chưa có dữ liệu đánh giá để vẽ biểu đồ.</p>';
        return;
    }
    const cycles = [...new Set(chartRows.map(row => row.cycle))].sort();
    const colors = ["#6c5ce7", "#00b894", "#0984e3", "#ff7675", "#f39c12"];
    const series = filter === "all"
        ? currentStudentsInFamily.map((studentId, index) => ({
            label: `${studentId} - Tổng`, color: colors[index],
            values: cycles.map(cycle => allRows.find(row => row.studentId === studentId && row.cycle === cycle)?.overall ?? null)
        }))
        : [
            ["Nghe", "listening", colors[2]], ["Nói", "speaking", colors[1]],
            ["Đọc", "reading", colors[0]], ["Viết", "writing", colors[3]], ["Tổng", "overall", colors[4]]
        ].map(([label, key, color]) => ({ label, color, values: cycles.map(cycle => chartRows.find(row => row.cycle === cycle)?.[key] ?? null) }));

    const width = Math.max(760, cycles.length * 120);
    const height = 340, left = 50, right = 24, top = 42, bottom = 64;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const x = index => cycles.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (cycles.length - 1);
    const y = value => top + (100 - Number(value || 0)) / 100 * plotHeight;
    const grid = [0,20,40,60,80,100].map(value => `<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" stroke="#dfe6e9"/><text x="12" y="${y(value)+4}" font-size="11" fill="#636e72">${value}</text>`).join("");
    const labels = cycles.map((cycle, index) => `<text x="${x(index)}" y="${height-24}" text-anchor="middle" font-size="11" fill="#636e72">${UI.escapeHTML(cycle)}</text>`).join("");
    const lines = series.map((item, seriesIndex) => {
        const validPoints = item.values.map((value, index) => value == null ? null : `${x(index)},${y(value)}`).filter(Boolean).join(" ");
        const dots = item.values.map((value, index) => value == null ? "" : `<circle cx="${x(index)}" cy="${y(value)}" r="4" fill="${item.color}"><title>${UI.escapeHTML(item.label)} ${cycles[index]}: ${value}</title></circle>`).join("");
        return `<polyline points="${validPoints}" fill="none" stroke="${item.color}" stroke-width="3"/>${dots}<circle cx="${left + seriesIndex*125}" cy="18" r="5" fill="${item.color}"/><text x="${left+10+seriesIndex*125}" y="22" font-size="12" fill="currentColor">${UI.escapeHTML(item.label)}</text>`;
    }).join("");
    container.innerHTML = `<div class="data-chart-wrap"><svg class="data-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ tiến độ qua các kỳ">${grid}${lines}${labels}</svg></div>`;
}

function renderDataTable(rows) {
    const container = document.getElementById("data-scores-table");
    if (!rows.length) {
        container.innerHTML = '<p class="muted-sm">Không có dữ liệu phù hợp bộ lọc.</p>';
        return;
    }
    container.innerHTML = `<div class="data-table-wrap"><table class="data-table">
        <thead><tr><th>Học sinh</th><th>Kỳ</th><th>Nghe</th><th>Nói</th><th>Đọc</th><th>Viết</th><th>Test</th><th>Tổng</th><th>CEFR</th><th>Nhận xét / lời khuyên</th></tr></thead>
        <tbody>${[...rows].reverse().map(row => `<tr>
            <td><strong>${UI.escapeHTML(row.studentId)}</strong></td><td>${UI.escapeHTML(row.cycleLabel || row.cycle)}</td>
            <td>${row.listening ?? "-"}</td><td>${row.speaking ?? "-"}</td><td>${row.reading ?? "-"}</td><td>${row.writing ?? "-"}</td>
            <td>${row.monthlyTest ?? "-"}</td><td><strong>${row.overall ?? "-"}</strong></td><td>${UI.escapeHTML(row.cefr || "-")}</td>
            <td>${UI.escapeHTML(row.comment || "")}<br><span class="muted-sm">${UI.escapeHTML(row.advice || "")}</span></td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function exportAssessment(type) {
    const filter = document.getElementById("dataStudentFilter").value || "all";
    const rows = getFamilyAssessmentRows().filter(row => filter === "all" || row.studentId === filter);
    if (!rows.length) return UI.showToast("Chưa có dữ liệu để xuất.", true);
    const fileLabel = filter === "all" ? currentActiveFamilyCode : filter;
    if (type === "json") {
        download(`assessments_${fileLabel}.json`, JSON.stringify(rows, null, 2), "application/json");
        return;
    }
    const headers = ["studentId","cycle","cycleLabel","listening","speaking","reading","writing","learningHabits","monthlyTest","skillAvg","overall","cefr","materials","comment","advice","nextFocus"];
    const csv = [headers.join(",")].concat(rows.map(row => headers.map(h => csvCell(row[h])).join(","))).join("\n");
    download(`assessments_${fileLabel}.csv`, csv, "text/csv");
}

function csvCell(value) {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function exportToPDF() {
    const stId = document.getElementById("studentId").value;
    const meta = STUDENT_META[stId] || { fullName: `Bé ${stId}` };
    const printDiv = document.createElement("div");
    printDiv.style.padding = "20px";
    printDiv.style.fontFamily = "'Nunito', sans-serif";
    printDiv.style.color = "#2d3436";
    let htmlContent = `<div style="text-align:center; margin-bottom:30px; border-bottom:2px solid #6c5ce7; padding-bottom:15px;"><h2 style="color:#6c5ce7; font-size:24px; margin:0 0 10px;">BÁO CÁO HỌC TẬP</h2><h3 style="font-size:18px; margin:0;">Học sinh: ${UI.escapeHTML(meta.fullName)}</h3></div>`;
    if (filteredLogsArray.length === 0) htmlContent += '<p style="text-align:center;">Chưa có dữ liệu học tập trong kỳ này.</p>';
    filteredLogsArray.forEach(item => {
        const l = item.data;
        htmlContent += `<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:15px; margin-bottom:15px; page-break-inside:avoid;">
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed #cbd5e1; padding-bottom:8px; margin-bottom:10px;">
                <span style="font-weight:bold; color:#0984e3;">Ngày: ${l.date || item.key}</span>
                <span style="font-weight:bold; color:#00b894;">${UI.escapeHTML(l.attitude).split(" ")[0]}</span>
            </div>
            <div style="margin-bottom:8px; line-height:1.5;"><strong>Nội dung:</strong><br>${UI.escapeHTML(l.content).replace(/\n/g, "<br>")}</div>
            ${l.homework ? `<div style="font-size:0.9rem; color:#636e72; background:#fff; padding:8px; border-radius:8px;"><strong>Bài tập:</strong> ${UI.escapeHTML(l.homework).replace(/\n/g, "<br>")}</div>` : ""}
        </div>`;
    });
    printDiv.innerHTML = htmlContent;
    const opt = { margin: 10, filename: `Bao_Cao_${stId}_${new Date().toLocaleDateString("vi-VN").replace(/\//g, "-")}.pdf`, image: { type: "jpeg", quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } };
    UI.showToast("Đang tạo PDF...");
    html2pdf().set(opt).from(printDiv).save().then(() => UI.showToast("Đã xuất PDF thành công!")).catch(() => UI.showToast("Có lỗi khi tạo PDF", true));
}
