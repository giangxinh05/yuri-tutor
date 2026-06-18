import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig, FALLBACK_PASSCODES } from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const params = new URLSearchParams(location.search);
const familyCode = (params.get("code") || localStorage.getItem("familyCode") || sessionStorage.getItem("familyCode") || "").toUpperCase();
let students = [];
let currentData = [];

const SKILLS = [
    ["listening", "Nghe", "#6c5ce7"],
    ["speaking", "Nói", "#00b894"],
    ["reading", "Đọc", "#0984e3"],
    ["writing", "Viết", "#ff7675"]
];

function escapeHTML(str) {
    return str ? String(str).replace(/[&<>'"]/g, tag => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[tag])) : "";
}

function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "show";
    setTimeout(() => t.className = "", 2500);
}

async function resolveStudents() {
    const snap = await get(ref(db, `Passcodes/${familyCode}`)).catch(() => null);
    if (snap?.exists()) {
        const val = snap.val();
        if (Array.isArray(val)) return val;
        if (Array.isArray(val.students)) return val.students;
        return Object.values(val);
    }
    return FALLBACK_PASSCODES[familyCode] || [];
}

async function loadAssessments(studentId) {
    document.getElementById("skillChart").innerHTML = `<p style="color:var(--muted);padding:20px;">Đang tải dữ liệu...</p>`;
    const snap = await get(ref(db, `Students/${studentId}/assessments`));
    const raw = snap.exists() ? snap.val() : {};
    currentData = Object.keys(raw).sort().map(key => ({ key, ...raw[key] }));
    render(studentId);
}

function render(studentId) {
    renderSummary(studentId);
    renderChart();
    renderTable();
}

function renderSummary(studentId) {
    const grid = document.getElementById("summaryGrid");
    if (!currentData.length) {
        grid.innerHTML = `<p style="color:var(--muted)">Chưa có dữ liệu đánh giá cho bé ${escapeHTML(studentId)}.</p>`;
        return;
    }
    const latest = currentData[currentData.length - 1];
    const prev = currentData.length > 1 ? currentData[currentData.length - 2] : null;

    function delta(key) {
        if (!prev) return "";
        const diff = Number(latest[key] || 0) - Number(prev[key] || 0);
        if (diff === 0) return `<span style="color:#b2bec3;font-size:0.8rem;font-weight:700;">= giữ nguyên</span>`;
        const color = diff > 0 ? "#00b894" : "#ff7675";
        const arrow = diff > 0 ? "▲" : "▼";
        return `<span style="color:${color};font-size:0.8rem;font-weight:700;">${arrow} ${Math.abs(diff)} so với kỳ trước</span>`;
    }

    const strongSkill = [...SKILLS].sort((a, b) => Number(latest[b[0]] || 0) - Number(latest[a[0]] || 0))[0];
    const weakSkill  = [...SKILLS].sort((a, b) => Number(latest[a[0]] || 0) - Number(latest[b[0]] || 0))[0];

    grid.innerHTML = `
        <div class="score-tile">
            <span style="font-size:0.85rem;color:var(--muted);font-weight:700;">Điểm tổng kỳ mới nhất</span>
            <strong style="font-size:2rem;color:var(--primary);">${latest.overall ?? 0}</strong>
            ${delta("overall")}
        </div>
        <div class="score-tile">
            <span style="font-size:0.85rem;color:var(--muted);font-weight:700;">CEFR</span>
            <strong style="font-size:2rem;color:var(--primary);">${escapeHTML(latest.cefr || "-")}</strong>
            <span style="font-size:0.8rem;color:var(--muted);font-weight:700;">Kỳ: ${escapeHTML(latest.cycleLabel || latest.key)}</span>
        </div>
        <div class="score-tile">
            <span style="font-size:0.85rem;color:var(--muted);font-weight:700;">Kỹ năng mạnh nhất</span>
            <strong style="font-size:1.5rem;color:${strongSkill[2]};">${strongSkill[1]}</strong>
            <span style="font-size:0.8rem;color:var(--muted);font-weight:700;">${latest[strongSkill[0]] ?? 0} điểm</span>
        </div>
        <div class="score-tile">
            <span style="font-size:0.85rem;color:var(--muted);font-weight:700;">Cần tập trung</span>
            <strong style="font-size:1.5rem;color:#ff7675;">${weakSkill[1]}</strong>
            <span style="font-size:0.8rem;color:var(--muted);font-weight:700;">${latest[weakSkill[0]] ?? 0} điểm</span>
        </div>
        <div class="score-tile" style="grid-column:1/-1;">
            <span style="font-size:0.85rem;color:var(--muted);font-weight:700;">Tổng số kỳ đã học</span>
            <strong style="font-size:2rem;color:var(--primary);">${currentData.length} kỳ</strong>
            <span style="font-size:0.8rem;color:var(--muted);font-weight:700;">
                Từ ${escapeHTML(currentData[0]?.cycleLabel || currentData[0]?.key || "")} đến ${escapeHTML(latest.cycleLabel || latest.key)}
            </span>
        </div>
    `;
}

function renderChart() {
    const container = document.getElementById("skillChart");
    if (!currentData.length) {
        container.innerHTML = `<p style="color:var(--muted);padding:20px;">Chưa có dữ liệu biểu đồ.</p>`;
        return;
    }

    const W = 760, H = 340;
    const pad = { top: 40, right: 30, bottom: 80, left: 52 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const n = currentData.length;

    const plotData = n === 1
        ? [{ key: "", listening: 0, speaking: 0, reading: 0, writing: 0, overall: 0, _ghost: true }, ...currentData]
        : currentData;
    const pn = plotData.length;

    const xPos = i => pad.left + (i / (pn - 1)) * chartW;
    const yPos = v => pad.top + (1 - Number(v || 0) / 100) * chartH;

    let svg = "";
    [0, 20, 40, 60, 80, 100].forEach(v => {
        const yy = yPos(v);
        svg += `<line x1="${pad.left}" y1="${yy}" x2="${W - pad.right}" y2="${yy}" stroke="#e8ecf4" stroke-width="1"/>`;
        svg += `<text x="${pad.left - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#b2bec3" font-weight="700">${v}</text>`;
    });

    plotData.forEach((d, i) => {
        if (d._ghost) return;
        const xx = xPos(i);
        svg += `<line x1="${xx}" y1="${pad.top}" x2="${xx}" y2="${pad.top + chartH}" stroke="#f1f3f8" stroke-width="1" stroke-dasharray="4,3"/>`;
    });

    SKILLS.forEach(([key, label, color]) => {
        const pts = plotData.map((d, i) => ({ x: xPos(i), y: yPos(d[key]) }));
        let path = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
            const cpx = (pts[i-1].x + pts[i].x) / 2;
            path += ` C ${cpx} ${pts[i-1].y}, ${cpx} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`;
        }
        const areaPath = path + ` L ${pts[pts.length-1].x} ${pad.top + chartH} L ${pts[0].x} ${pad.top + chartH} Z`;
        svg += `<path d="${areaPath}" fill="${color}" fill-opacity="0.07"/>`;
        svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

        plotData.forEach((d, i) => {
            if (d._ghost) return;
            const xx = xPos(i), yy = yPos(d[key]);
            svg += `<circle cx="${xx}" cy="${yy}" r="5" fill="white" stroke="${color}" stroke-width="2.5"/>`;
            const val = d[key] ?? 0;
            svg += `<text x="${xx}" y="${yy - 9}" text-anchor="middle" font-size="10" fill="${color}" font-weight="800">${val}</text>`;
        });
    });

    plotData.forEach((d, i) => {
        if (d._ghost) return;
        const xx = xPos(i);
        const label = (d.cycleLabel || d.key || "").slice(0, 12);
        svg += `<text x="${xx}" y="${H - pad.bottom + 18}" text-anchor="middle" font-size="11" fill="#636e72" font-weight="700">${escapeHTML(label)}</text>`;
    });

    SKILLS.forEach(([key, label, color], i) => {
        const lx = pad.left + i * 175;
        svg += `<rect x="${lx}" y="12" width="16" height="4" rx="2" fill="${color}"/>`;
        svg += `<circle cx="${lx + 8}" cy="14" r="4" fill="white" stroke="${color}" stroke-width="2"/>`;
        svg += `<text x="${lx + 22}" y="18" font-size="12" fill="#2d3436" font-weight="700">${label}</text>`;
    });

    container.innerHTML = `
        <div style="overflow-x:auto;">
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:480px;display:block;" role="img" aria-label="Biểu đồ xu hướng kỹ năng">
                ${svg}
            </svg>
        </div>
        ${n === 1 ? `<p style="text-align:center;font-size:0.85rem;color:var(--muted);margin-top:8px;">Cần từ 2 kỳ trở lên để thấy xu hướng thay đổi.</p>` : ""}
    `;
}

function renderTable() {
    document.getElementById("assessmentRows").innerHTML = [...currentData].reverse().map((row, i) => {
        const isLatest = i === 0;
        const prev = currentData[currentData.length - 2 - i];

        function cell(key) {
            const val = row[key] ?? "";
            if (!prev || val === "") return `<td style="text-align:center;">${val}</td>`;
            const diff = Number(val) - Number(prev[key] || 0);
            if (diff === 0) return `<td style="text-align:center;">${val}</td>`;
            const color = diff > 0 ? "#00b894" : "#ff7675";
            const arrow = diff > 0 ? "▲" : "▼";
            return `<td style="text-align:center;">${val} <span style="color:${color};font-size:0.75rem;font-weight:800;">${arrow}${Math.abs(diff)}</span></td>`;
        }

        return `<tr style="${isLatest ? "background:#f5f3ff;" : ""}">
            <td style="font-weight:${isLatest ? "900" : "700"};color:var(--primary);">
                ${escapeHTML(row.cycleLabel || row.key)}
                ${isLatest ? `<span style="background:#6c5ce7;color:white;font-size:0.7rem;padding:2px 7px;border-radius:6px;margin-left:6px;font-weight:800;">Mới nhất</span>` : ""}
            </td>
            ${cell("listening")}
            ${cell("speaking")}
            ${cell("reading")}
            ${cell("writing")}
            ${cell("monthlyTest")}
            ${cell("overall")}
            <td style="text-align:center;font-weight:800;">${escapeHTML(row.cefr || "")}</td>
            <td style="font-size:0.88rem;line-height:1.5;">
                ${row.comment ? `<div><strong>Nhận xét:</strong> ${escapeHTML(row.comment)}</div>` : ""}
                ${row.advice ? `<div style="margin-top:4px;"><strong>Lời khuyên:</strong> ${escapeHTML(row.advice)}</div>` : ""}
                ${row.nextFocus ? `<div style="margin-top:4px;color:var(--primary);"><strong>Trọng tâm tới:</strong> ${escapeHTML(row.nextFocus)}</div>` : ""}
            </td>
        </tr>`;
    }).join("");
}

function exportRows(type) {
    const studentId = document.getElementById("studentSelect").value;
    const rows = currentData.map(row => ({ studentId, ...row }));
    if (type === "json") {
        download(`assessments_${studentId}.json`, JSON.stringify(rows, null, 2), "application/json");
    } else {
        const headers = ["studentId","cycle","cycleLabel","listening","speaking","reading","writing","monthlyTest","overall","cefr","comment","advice","nextFocus"];
        const csv = [headers.join(",")].concat(rows.map(row => headers.map(h => csvCell(h === "cycle" ? row.key : row[h])).join(","))).join("\n");
        download(`assessments_${studentId}.csv`, csv, "text/csv");
    }
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
    toast("Đã xuất dữ liệu.");
}

document.getElementById("studentSelect").addEventListener("change", e => loadAssessments(e.target.value));
document.getElementById("btnExportCsv").addEventListener("click", () => exportRows("csv"));
document.getElementById("btnExportJson").addEventListener("click", () => exportRows("json"));

async function init() {
    students = await resolveStudents();
    const select = document.getElementById("studentSelect");
    select.innerHTML = students.map(st => `<option value="${escapeHTML(st)}">${escapeHTML(st)}</option>`).join("");
    if (students.length) loadAssessments(students[0]);
    else document.getElementById("summaryGrid").innerHTML = "<p>Không tìm thấy mã gia đình.</p>";
}

function waitForAuth() {
    return new Promise(resolve => {
        const unsubscribe = onAuthStateChanged(auth, user => {
            unsubscribe();
            resolve(user);
        });
    });
}

function waitForAuthWithRetry() {
    return new Promise(resolve => {
        let settled = false;
        const unsubscribe = onAuthStateChanged(auth, user => {
            if (settled) return;
            if (user) { settled = true; unsubscribe(); resolve(user); }
        });
        setTimeout(() => {
            if (!settled) { settled = true; unsubscribe(); resolve(null); }
        }, 3000);
    });
}

waitForAuthWithRetry().then(user => {
    if (!user) location.href = "index.html";
    else init();
});
