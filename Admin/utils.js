export const CONFIG = {
    FEE_PER_LESSON: 300000,
    CYCLE_START_DAY: 16,
    LOGS_PER_PAGE: 15
};

export function normalizeDateKey(d) {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
        const [dd, mm, yyyy] = d.split('/');
        return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
    }
    return d;
}

export function dateKeyToDate(d) {
    const iso = normalizeDateKey(d);
    const parts = iso.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return new Date(0);
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function formatDateDisplay(d) {
    const iso = normalizeDateKey(d);
    const [y, m, day] = iso.split('-');
    if (!y || !m || !day) return d;
    return `${day}/${m}/${y}`;
}

export const UI = {
    showToast(msg, isError = false) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.innerHTML = msg;
        t.style.background = isError ? 'var(--danger)' : 'var(--success)';
        t.className = 'show';
        setTimeout(() => t.className = '', 3500);
    },

    escapeHTML(str) {
        return str
            ? str.replace(/[&<>'"]/g, tag => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;',
                "'": '&#39;', '"': '&quot;'
              }[tag]))
            : '';
    },

    formatHomeworkText(text) {
        if (!text) return 'Không có';
        const escaped = this.escapeHTML(text);
        return escaped
            .replace(/(https?:\/\/[^\s&]+)/g, url =>
                `<br><a href="${url}" target="_blank" class="download-btn">📥 Tải Tài Liệu / Bài Tập</a>`)
            .replace(/\n/g, '<br>');
    }
};

export function getBillingCycle() {
    const now = new Date();
    let m = now.getMonth(), y = now.getFullYear();
    if (now.getDate() < CONFIG.CYCLE_START_DAY) {
        m--;
        if (m < 0) { m = 11; y--; }
    }
    const nextM = (m + 1) % 12;
    const nextY = m === 11 ? y + 1 : y;
    return {
        start: new Date(y, m, CONFIG.CYCLE_START_DAY, 0, 0, 0),
        end:   new Date(nextY, nextM, CONFIG.CYCLE_START_DAY - 1, 23, 59, 59),
        displayStart: `${CONFIG.CYCLE_START_DAY}/${m + 1}/${y}`,
        displayEnd:   `${CONFIG.CYCLE_START_DAY - 1}/${nextM + 1}/${nextY}`
    };
}
