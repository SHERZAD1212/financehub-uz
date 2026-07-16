/* ============================================================
   FinanceHub UZ — Main Application Logic
   ============================================================ */

'use strict';

// ══════════════════════════════════════════
// SUPABASE CONNECTION
// ══════════════════════════════════════════

const SUPABASE_URL = 'https://akevycuxpvmdtjprerfr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZXZ5Y3V4cHZtZHRqcHJlcmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNDY2NzAsImV4cCI6MjA5OTYyMjY3MH0.ez7RubUUTDwzGqBNwfAEiNcdLmafhhegRUYObLQn1ew';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ══════════════════════════════════════════
// STATE & CONSTANTS
// ══════════════════════════════════════════

const STORAGE_KEY = 'financehub-uz-v2';
let state = null;
let activeFirmId = null;
let currentUser = null;     // { id, email }
let firmMemberships = [];   // [{ firm_id, role_in_firm }]

function roleForFirm(firmId) {
  const m = firmMemberships.find(m => m.firm_id === firmId);
  return m ? m.role_in_firm : null;
}

function canEdit() {
  return roleForFirm(activeFirmId) === 'buxgalter';
}
let cashflowChartInstance = null;
let categoryChartInstance = null;
let cashflowDetailChartInstance = null;

const CATEGORIES = {
  income: ['Mijoz to\'lovi', 'Obuna to\'lovi', 'Xizmat haqi', 'Savdo', 'Investitsiya daromadi', 'Boshqa kirim'],
  expense: ['Ijara', 'Ish haqi', 'Kommunal to\'lovlar', 'Transport', 'Marketing', 'Jihozlar', 'Soliqlar', 'Boshqa xarajat']
};

const REPORT_CATALOG = [
  { key: 'qqs', label: 'QQS hisoboti', freq: 'Oylik', rate: 0.12, tax: true },
  { key: 'foyda', label: 'Foyda solig\'i', freq: 'Choraklik', rate: 0.15, tax: true },
  { key: 'daromad', label: 'Jismoniy shaxslar daromad solig\'i (agent)', freq: 'Oylik', rate: 0.12, tax: true },
  { key: 'ijtimoiy', label: 'Ijtimoiy soliq', freq: 'Oylik', rate: 0.12, tax: true },
  { key: 'aylanma', label: 'Aylanmadan olinadigan soliq', freq: 'Oylik', rate: 0.04, tax: true },
  { key: 'molmulk', label: 'Yuridik shaxslar mol-mulk solig\'i', freq: 'Choraklik', rate: 0, tax: false },
  { key: 'yer', label: 'Yer solig\'i', freq: 'Yillik', rate: 0, tax: false },
  { key: 'suv', label: 'Suv resurslaridan foydalanganlik uchun soliq', freq: 'Oylik', rate: 0, tax: false },
  { key: 'statistika', label: 'Statistika hisoboti', freq: 'Choraklik', rate: 0, tax: false }
];

const PAGE_TITLES = {
  dashboard: 'Boshqaruv paneli',
  kassa: 'Kassa',
  debitor: 'Debitor / Kreditor',
  byudjet: 'Byudjet rejalashtirish',
  faktura: 'Fakturalar',
  kontragentlar: 'Kontragentlar',
  cashflow: 'Cash Flow',
  pl: 'P&L Hisobot',
  soliqlar: 'Soliqlar jadvali',
  hisobotlar: 'Mening hisobotlarim'
};

// ══════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmt(n) {
  if (isNaN(n)) return '0 so\'m';
  return Math.abs(Math.round(n)).toLocaleString('ru-RU') + ' so\'m';
}

function formatAmountInput(el) {
  const raw = el.value.replace(/\D/g, '');
  el.value = raw ? Number(raw).toLocaleString('ru-RU') : '';
}

function parseAmountInput(id) {
  const raw = (document.getElementById(id)?.value || '').replace(/\D/g, '');
  return raw ? Number(raw) : 0;
}

function fmtSign(n) {
  const abs = fmt(n);
  if (n > 0) return `<span class="amount-positive">+${abs}</span>`;
  if (n < 0) return `<span class="amount-negative">−${abs}</span>`;
  return `<span class="amount-neutral">${abs}</span>`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatDate(d) {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return d;
}

function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const months = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
  return `${months[parseInt(mo) - 1]} ${y}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════
// STORAGE
// ══════════════════════════════════════════

// ── DB row <-> app object mappers ──
const mapFirm = r => ({ id: r.id, name: r.name, stir: r.stir || '', phone: r.phone || '', address: r.address || '', regime: r.regime || '', reportKeys: r.report_keys || [] });
const mapKassa = r => ({ id: r.id, firmId: r.firm_id, date: r.date, amount: r.amount, type: r.type, category: r.category, month: r.month, method: r.method, contragentId: r.contragent_id || '', note: r.note || '' });
const mapCont = r => ({ id: r.id, firmId: r.firm_id, name: r.name, stir: r.stir || '', phone: r.phone || '', email: r.email || '', contractAmount: r.contract_amount || 0, status: r.status, documents: r.documents || [] });
const mapInvoice = r => ({ id: r.id, firmId: r.firm_id, number: r.number || '', contragentId: r.contragent_id || '', date: r.date || '', dueDate: r.due_date || '', amount: r.amount, status: r.status, description: r.description || '' });
const mapBudget = r => ({ id: r.id, firmId: r.firm_id, month: r.month, category: r.category, limit: r.amount });
const mapReport = r => ({ id: r.id, firmId: r.firm_id, type: r.type || r.report_key || '', dueDate: r.due_date || '', status: r.status });

async function loadState() {
  const { data: { user } } = await sb.auth.getUser();
  currentUser = user;

  const { data: members } = await sb.from('firm_members').select('firm_id, role_in_firm').eq('user_id', user.id);
  firmMemberships = members || [];

  const [firmsR, kassaR, contR, invR, budR, repR] = await Promise.all([
    sb.from('firms').select('*'),
    sb.from('kassa').select('*'),
    sb.from('contragents').select('*'),
    sb.from('invoices').select('*'),
    sb.from('budgets').select('*'),
    sb.from('reports').select('*')
  ]);

  state = {
    firms: (firmsR.data || []).map(mapFirm),
    kassa: (kassaR.data || []).map(mapKassa),
    contragents: (contR.data || []).map(mapCont),
    invoices: (invR.data || []).map(mapInvoice),
    budgets: (budR.data || []).map(mapBudget),
    reports: (repR.data || []).map(mapReport)
  };

  const stillExists = state.firms.some(f => f.id === activeFirmId);
  if (!stillExists) {
    activeFirmId = state.firms[0] ? state.firms[0].id : null;
  }
}

async function refreshAndRender() {
  await loadState();
  renderAll();
}

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + id);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === id);
  });

  document.getElementById('pageTitle').textContent = PAGE_TITLES[id] || id;
  renderAll();

  // Close notif panel if open
  document.getElementById('notifPanel').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

function setActiveFirm(id) {
  activeFirmId = id;
  renderAll();
}

// ══════════════════════════════════════════
// MODAL SYSTEM
// ══════════════════════════════════════════

function openModal(titleHtml, bodyHtml, actionsHtml) {
  document.getElementById('modalBody').innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${titleHtml}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-actions">${actionsHtml}</div>
  `;
  document.getElementById('overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('modalBody').innerHTML = '';
}

function overlayClick(e) {
  if (e.target === document.getElementById('overlay')) closeModal();
}

// ══════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════

function getNotifications() {
  const notifs = [];
  const todayStr = today();

  state.reports.filter(r => r.firmId === activeFirmId).forEach(r => {
    if (r.status === 'Topshirilgan') return;
    const days = daysUntil(r.dueDate);
    if (days !== null && days <= 5 && days >= 0) {
      notifs.push({ type: 'warning', icon: '⚠️', title: `${r.type} muddati yaqinlashmoqda`, sub: `${days} kun qoldi — ${formatDate(r.dueDate)}` });
    } else if (days !== null && days < 0) {
      notifs.push({ type: 'danger', icon: '🚨', title: `${r.type} muddati o'tdi!`, sub: `${Math.abs(days)} kun oldin o'tgan` });
    }
  });

  state.invoices.filter(i => i.firmId === activeFirmId).forEach(inv => {
    if (inv.status === 'To\'langan') return;
    const days = daysUntil(inv.dueDate);
    if (days !== null && days < 0) {
      const cName = contragentName(inv.contragentId);
      notifs.push({ type: 'danger', icon: '💸', title: `Faktura muddati o'tdi`, sub: `${inv.number} — ${cName} — ${fmt(inv.amount)}` });
    }
  });

  return notifs;
}

function renderNotifications() {
  const notifs = getNotifications();
  const dot = document.getElementById('notifDot');
  const badge = document.getElementById('reportsBadge');
  const listEl = document.getElementById('notifList');

  dot.classList.toggle('show', notifs.length > 0);
  badge.textContent = notifs.length > 0 ? notifs.length : '';

  if (!notifs.length) {
    listEl.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:13px;">Hozircha eslatma yo'q ✓</div>`;
    return;
  }

  listEl.innerHTML = notifs.map(n => `
    <div class="notif-item">
      <div class="notif-item-icon ${n.type}">${n.icon}</div>
      <div class="notif-item-text">
        <div class="notif-item-title">${escHtml(n.title)}</div>
        <div class="notif-item-sub">${escHtml(n.sub)}</div>
      </div>
    </div>
  `).join('');
}

function toggleNotifPanel() {
  document.getElementById('notifPanel').classList.toggle('open');
}

// ══════════════════════════════════════════
// FIRM MANAGEMENT
// ══════════════════════════════════════════

function renderFirmSelect() {
  const sel = document.getElementById('firmSelect');
  sel.innerHTML = state.firms.map(f =>
    `<option value="${escHtml(f.id)}" ${f.id === activeFirmId ? 'selected' : ''}>${escHtml(f.name)}</option>`
  ).join('');
}

function openFirmModal() {
  const body = `
    <div class="field-row">
      <div class="field">
        <label>Firma nomi *</label>
        <input id="f_name" placeholder="Masalan: Asr Tekstil MCHJ">
      </div>
      <div class="field">
        <label>STIR</label>
        <input id="f_stir" placeholder="123456789">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Telefon</label>
        <input id="f_phone" placeholder="+998 71 ...">
      </div>
      <div class="field">
        <label>Soliq rejimi</label>
        <select id="f_regime">
          <option>QQS to'lovchi</option>
          <option>Aylanma soliq</option>
          <option>Yagona soliq to'lovchi</option>
          <option>Oddiy deklaratsiya</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>Manzil</label>
      <input id="f_address" placeholder="Shahar, tuman">
    </div>
    <div class="field">
      <label>Hisobotlar (tanlang)</label>
      <div class="checkbox-group">
        ${REPORT_CATALOG.map(r => `
          <div class="checkbox-item">
            <input type="checkbox" id="rep_${r.key}" value="${r.key}">
            <label for="rep_${r.key}">${r.label} · ${r.freq}${r.tax ? ' · ' + (r.rate * 100).toFixed(0) + '%' : ''}</label>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  openModal(
    'Yangi firma qo\'shish',
    body,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor qilish</button>
     <button class="btn btn-primary" onclick="saveFirm(this)">Saqlash</button>`
  );
}

async function saveFirm(btn) {
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try {
    const name = document.getElementById('f_name').value.trim();
    if (!name) { alert('Firma nomini kiriting'); return; }

    const reportKeys = REPORT_CATALOG
      .filter(r => document.getElementById('rep_' + r.key).checked)
    .map(r => r.key);

  // Pre-generate the firm id so we don't need to SELECT it back
  // before the creator's firm_members row exists (RLS would block that read).
  const firmId = crypto.randomUUID();

  const { error: firmErr } = await sb.from('firms').insert({
    id: firmId,
    name,
    stir: document.getElementById('f_stir').value.trim(),
    phone: document.getElementById('f_phone').value.trim(),
    address: document.getElementById('f_address').value.trim(),
    regime: document.getElementById('f_regime').value,
    report_keys: reportKeys,
    created_by: currentUser.id
  });

  if (firmErr) { alert('Xatolik (firma): ' + firmErr.message); return; }

  // Creator becomes buxgalter of the new firm
  const { error: memberErr } = await sb.from('firm_members').insert({
    firm_id: firmId, user_id: currentUser.id, role_in_firm: 'buxgalter'
  });
  if (memberErr) { alert('Xatolik (a\'zolik): ' + memberErr.message); return; }

  // Auto-create reports for selected keys
  const now = currentMonth();
  const reportRows = reportKeys.map(key => {
    const catalog = REPORT_CATALOG.find(r => r.key === key);
    return catalog ? { firm_id: firmId, type: catalog.label, due_date: now + '-20', status: 'Kutilmoqda' } : null;
  }).filter(Boolean);
  if (reportRows.length) await sb.from('reports').insert(reportRows);

  activeFirmId = firmId;
  closeModal();
  await refreshAndRender();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ══════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════

function renderDashboard() {
  const kassa = state.kassa.filter(k => k.firmId === activeFirmId);
  const conts = state.contragents.filter(c => c.firmId === activeFirmId);
  const invoices = state.invoices.filter(i => i.firmId === activeFirmId);
  const now = currentMonth();

  const totalIn = kassa.filter(k => k.type === 'Kirim').reduce((s, k) => s + k.amount, 0);
  const totalOut = kassa.filter(k => k.type === 'Chiqim').reduce((s, k) => s + k.amount, 0);
  const balance = totalIn - totalOut;

  const monthIn = kassa.filter(k => k.type === 'Kirim' && k.month === now).reduce((s, k) => s + k.amount, 0);
  const monthOut = kassa.filter(k => k.type === 'Chiqim' && k.month === now).reduce((s, k) => s + k.amount, 0);

  const debitorTotal = conts.reduce((s, c) => {
    const paid = kassa.filter(k => k.contragentId === c.id && k.type === 'Kirim').reduce((a, k) => a + k.amount, 0);
    return s + Math.max(c.contractAmount - paid, 0);
  }, 0);

  const pendingInvoices = invoices.filter(i => i.status !== 'To\'langan').reduce((s, i) => s + i.amount, 0);

  document.getElementById('dashboardCards').innerHTML = `
    <div class="stat-card accent">
      <div class="stat-icon accent">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
      </div>
      <div class="stat-label">Kassa qoldig'i</div>
      <div class="stat-value">${fmt(balance)}</div>
    </div>
    <div class="stat-card success">
      <div class="stat-icon success">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
      </div>
      <div class="stat-label">Shu oy kirim</div>
      <div class="stat-value">${fmt(monthIn)}</div>
      <div class="stat-change up">↑ Faol davr</div>
    </div>
    <div class="stat-card danger">
      <div class="stat-icon danger">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
      </div>
      <div class="stat-label">Shu oy chiqim</div>
      <div class="stat-value">${fmt(monthOut)}</div>
    </div>
    <div class="stat-card warning">
      <div class="stat-icon warning">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
      </div>
      <div class="stat-label">Debitor qarzi</div>
      <div class="stat-value">${fmt(debitorTotal)}</div>
    </div>
  `;

  // Recent transactions
  const recent = [...kassa].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  if (!recent.length) {
    document.getElementById('recentTransactions').innerHTML = emptyState('💳', 'Tranzaksiya yo\'q', 'Kassa bo\'limidan tranzaksiya qo\'shing');
    return;
  }
  document.getElementById('recentTransactions').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Sana</th><th>Kategoriya</th><th>Usul</th><th>Summa</th></tr></thead>
        <tbody>
          ${recent.map(k => `
            <tr>
              <td>${formatDate(k.date)}</td>
              <td>${escHtml(k.category)}</td>
              <td>${escHtml(k.method)}</td>
              <td>${fmtSign(k.type === 'Kirim' ? k.amount : -k.amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  updateChart();
  updateCategoryChart();
}

// ══════════════════════════════════════════
// CHARTS
// ══════════════════════════════════════════

function getLastNMonths(n) {
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

function updateChart() {
  const n = parseInt(document.getElementById('chartMonthFilter')?.value || '6');
  const months = getLastNMonths(n);
  const kassa = state.kassa.filter(k => k.firmId === activeFirmId);

  const incomeData = months.map(m => kassa.filter(k => k.month === m && k.type === 'Kirim').reduce((s, k) => s + k.amount, 0) / 1000000);
  const expenseData = months.map(m => kassa.filter(k => k.month === m && k.type === 'Chiqim').reduce((s, k) => s + k.amount, 0) / 1000000);

  const ctx = document.getElementById('cashflowChart');
  if (!ctx) return;

  if (cashflowChartInstance) cashflowChartInstance.destroy();

  cashflowChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(monthLabel),
      datasets: [
        {
          label: 'Kirim',
          data: incomeData,
          backgroundColor: 'rgba(16,185,129,0.7)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'Chiqim',
          data: expenseData,
          backgroundColor: 'rgba(239,68,68,0.7)',
          borderColor: '#ef4444',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)} mln so'm`
          }
        }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#64748b', font: { family: 'Inter', size: 11 }, callback: v => v + ' mln' }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

function updateCategoryChart() {
  const kassa = state.kassa.filter(k => k.firmId === activeFirmId && k.type === 'Chiqim');
  const catMap = {};
  kassa.forEach(k => {
    catMap[k.category] = (catMap[k.category] || 0) + k.amount;
  });

  const labels = Object.keys(catMap);
  const data = Object.values(catMap).map(v => v / 1000000);

  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;
  if (categoryChartInstance) categoryChartInstance.destroy();

  if (!labels.length) {
    ctx.parentElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:220px;color:var(--text-muted);font-size:13px;">Ma'lumot yo'q</div>`;
    return;
  }

  const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#06b6d4'];

  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, padding: 12, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw.toFixed(1)} mln so'm`
          }
        }
      }
    }
  });
}

// ══════════════════════════════════════════
// KASSA
// ══════════════════════════════════════════

function renderKassa() {
  const q = (document.getElementById('kassaSearch')?.value || '').toLowerCase();
  const typeF = document.getElementById('kassaTypeFilter')?.value || '';
  const monthF = document.getElementById('kassaMonthFilter')?.value || '';

  let list = state.kassa.filter(k => k.firmId === activeFirmId);
  if (typeF) list = list.filter(k => k.type === typeF);
  if (monthF) list = list.filter(k => k.month === monthF);
  if (q) list = list.filter(k =>
    (k.category || '').toLowerCase().includes(q) ||
    (k.note || '').toLowerCase().includes(q) ||
    (contragentName(k.contragentId)).toLowerCase().includes(q)
  );

  list.sort((a, b) => b.date.localeCompare(a.date));

  const fullList = state.kassa.filter(k => k.firmId === activeFirmId);
  const totalIn = fullList.filter(k => k.type === 'Kirim').reduce((s, k) => s + k.amount, 0);
  const totalOut = fullList.filter(k => k.type === 'Chiqim').reduce((s, k) => s + k.amount, 0);
  const balance = totalIn - totalOut;

  const byMethod = (method) => fullList.filter(k => k.method === method).reduce((s, k) => s + (k.type === 'Kirim' ? k.amount : -k.amount), 0);

  document.getElementById('kassaCards').innerHTML = `
    <div class="stat-card accent">
      <div class="stat-icon accent">💰</div>
      <div class="stat-label">Umumiy balans</div>
      <div class="stat-value">${fmt(balance)}</div>
    </div>
    <div class="stat-card success">
      <div class="stat-icon success">↑</div>
      <div class="stat-label">Jami kirim</div>
      <div class="stat-value">${fmt(totalIn)}</div>
    </div>
    <div class="stat-card danger">
      <div class="stat-icon danger">↓</div>
      <div class="stat-label">Jami chiqim</div>
      <div class="stat-value">${fmt(totalOut)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon info">🏦</div>
      <div class="stat-label">Bank</div>
      <div class="stat-value">${fmt(byMethod('Bank orqali'))}</div>
    </div>
  `;

  if (!list.length) {
    document.getElementById('kassaWrap').innerHTML = emptyState('💵', 'Tranzaksiya topilmadi', 'Yangi tranzaksiya qo\'shish uchun yuqoridagi tugmani bosing');
    return;
  }

  document.getElementById('kassaWrap').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Sana</th><th>Turi</th><th>Kategoriya</th><th>Kontragent</th><th>Usul</th><th style="text-align:right">Summa</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${list.map(k => `
            <tr>
              <td>${formatDate(k.date)}</td>
              <td><span class="badge ${k.type === 'Kirim' ? 'success' : 'danger'}">${k.type}</span></td>
              <td>${escHtml(k.category)}</td>
              <td>${escHtml(contragentName(k.contragentId)) || '—'}</td>
              <td>${escHtml(k.method)}</td>
              <td style="text-align:right">${fmtSign(k.type === 'Kirim' ? k.amount : -k.amount)}</td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-sm btn-secondary buxgalter-only" onclick="openKassaEditModal('${k.id}')">✏️</button>
                  <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteKassa('${k.id}')">🗑</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function kassaModalBody(k) {
  const conts = state.contragents.filter(c => c.firmId === activeFirmId);
  const type = k ? k.type : 'Kirim';
  const incomeOpts = CATEGORIES.income.map(c => `<option ${k && k.category === c ? 'selected' : ''}>${c}</option>`).join('');
  const expenseOpts = CATEGORIES.expense.map(c => `<option ${k && k.category === c ? 'selected' : ''}>${c}</option>`).join('');

  return `
    <div class="field-row">
      <div class="field">
        <label>Sana *</label>
        <input id="k_date" type="date" value="${k ? k.date : today()}">
      </div>
      <div class="field">
        <label>Turi *</label>
        <select id="k_type" onchange="updateKassaCategories()">
          <option ${type === 'Kirim' ? 'selected' : ''}>Kirim</option>
          <option ${type === 'Chiqim' ? 'selected' : ''}>Chiqim</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>Kategoriya</label>
      <select id="k_category">
        ${type === 'Kirim' ? incomeOpts : expenseOpts}
      </select>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Summa (so'm) *</label>
        <input id="k_amount" type="text" inputmode="numeric" placeholder="0" oninput="formatAmountInput(this)" value="${k ? k.amount.toLocaleString('ru-RU') : ''}">
      </div>
      <div class="field">
        <label>To'lov usuli</label>
        <select id="k_method">
          ${['Naqd', 'Bank orqali', 'Karta orqali', 'Pul o\'tkazma'].map(m =>
    `<option ${k && k.method === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Kontragent</label>
        <select id="k_cont">
          <option value="">— Tanlanmagan —</option>
          ${conts.map(c => `<option value="${c.id}" ${k && k.contragentId === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Qaysi oy</label>
        <input id="k_month" type="month" value="${k ? k.month : currentMonth()}">
      </div>
    </div>
    <div class="field">
      <label>Izoh</label>
      <input id="k_note" placeholder="Qo'shimcha ma'lumot..." value="${k ? escHtml(k.note || '') : ''}">
    </div>
  `;
}

function updateKassaCategories() {
  const type = document.getElementById('k_type').value;
  const opts = (type === 'Kirim' ? CATEGORIES.income : CATEGORIES.expense).map(c => `<option>${c}</option>`).join('');
  document.getElementById('k_category').innerHTML = opts;
}

function openKassaModal() {
  openModal(
    'Tranzaksiya qo\'shish',
    kassaModalBody(null),
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveKassa('', this)">Saqlash</button>`
  );
}

function openKassaEditModal(id) {
  const k = state.kassa.find(x => x.id === id);
  if (!k) return;
  openModal(
    'Tranzaksiyani tahrirlash',
    kassaModalBody(k),
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveKassa('${id}', this)">Saqlash</button>`
  );
}

async function saveKassa(editId, btn) {
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try {
  const amount = parseAmountInput('k_amount');
  if (!amount || amount <= 0) { alert('To\'g\'ri summa kiriting'); return; }

  const row = {
    firm_id: activeFirmId,
    date: document.getElementById('k_date').value,
    amount,
    type: document.getElementById('k_type').value,
    category: document.getElementById('k_category').value,
    method: document.getElementById('k_method').value,
    contragent_id: document.getElementById('k_cont').value || null,
    month: document.getElementById('k_month').value,
    note: document.getElementById('k_note').value.trim()
  };

  const { error } = editId
    ? await sb.from('kassa').update(row).eq('id', editId)
    : await sb.from('kassa').insert(row);

  if (error) { alert('Xatolik: ' + error.message); return; }
  closeModal();
  await refreshAndRender();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteKassa(id) {
  if (!confirm('Tranzaksiyani o\'chirasizmi?')) return;
  const { error } = await sb.from('kassa').delete().eq('id', id);
  if (error) { alert('Xatolik: ' + error.message); return; }
  await refreshAndRender();
}

function exportKassaCSV() {
  const list = state.kassa.filter(k => k.firmId === activeFirmId);
  const rows = [['Sana', 'Turi', 'Kategoriya', 'Kontragent', 'Usul', 'Summa', 'Izoh']];
  list.forEach(k => {
    rows.push([k.date, k.type, k.category, contragentName(k.contragentId) || '', k.method, k.amount, k.note || '']);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kassa_${currentMonth()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════
// KONTRAGENTLAR
// ══════════════════════════════════════════

function contragentName(id) {
  const c = state.contragents.find(x => x.id === id);
  return c ? c.name : '';
}

function renderKontragentlar() {
  const q = (document.getElementById('contSearch')?.value || '').toLowerCase();
  const statusF = document.getElementById('contStatusFilter')?.value || '';

  let list = state.contragents.filter(c => c.firmId === activeFirmId);
  if (statusF) list = list.filter(c => c.status === statusF);
  if (q) list = list.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.stir || '').includes(q) ||
    (c.email || '').toLowerCase().includes(q)
  );

  if (!list.length) {
    document.getElementById('kontragentlarWrap').innerHTML = emptyState('👥', 'Kontragent topilmadi', 'Yangi kontragent qo\'shish uchun tugmani bosing');
    return;
  }

  document.getElementById('kontragentlarWrap').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Nomi</th><th>STIR</th><th>Telefon</th><th>Shartnoma summasi</th><th>Holati</th><th>Hujjatlar</th><th></th></tr>
        </thead>
        <tbody>
          ${list.map(c => `
            <tr>
              <td><strong>${escHtml(c.name)}</strong></td>
              <td>${escHtml(c.stir) || '—'}</td>
              <td>${escHtml(c.phone) || '—'}</td>
              <td>${fmt(c.contractAmount)}</td>
              <td><span class="badge ${c.status === 'Faol' ? 'success' : 'muted'}">${c.status}</span></td>
              <td><span class="badge info">${(c.documents || []).length} fayl</span></td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-sm btn-secondary buxgalter-only" onclick="openContragentModal('${c.id}')">✏️ Tahrirlash</button>
                  <button class="btn btn-sm btn-secondary" onclick="openDocsModal('${c.id}')">📎 Hujjat</button>
                  <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteContragent('${c.id}')">🗑</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openContragentModal(editId) {
  const c = editId ? state.contragents.find(x => x.id === editId) : null;
  const body = `
    <div class="field-row">
      <div class="field">
        <label>Nomi *</label>
        <input id="c_name" value="${c ? escHtml(c.name) : ''}" placeholder="MCHJ / LLC / FIO">
      </div>
      <div class="field">
        <label>STIR / JSHIR</label>
        <input id="c_stir" value="${c ? escHtml(c.stir || '') : ''}" placeholder="123456789">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Telefon</label>
        <input id="c_phone" value="${c ? escHtml(c.phone || '') : ''}" placeholder="+998 90 ...">
      </div>
      <div class="field">
        <label>Email</label>
        <input id="c_email" type="email" value="${c ? escHtml(c.email || '') : ''}" placeholder="info@example.uz">
      </div>
    </div>
    <div class="field">
      <label>Shartnoma summasi</label>
      <input id="c_amount" type="text" inputmode="numeric" value="${c ? c.contractAmount.toLocaleString('ru-RU') : ''}" placeholder="0" oninput="formatAmountInput(this)">
    </div>
    <div class="field">
      <label>Holat</label>
      <select id="c_status">
        <option ${!c || c.status === 'Faol' ? 'selected' : ''}>Faol</option>
        <option ${c && c.status === 'Tugagan' ? 'selected' : ''}>Tugagan</option>
        <option ${c && c.status === 'Kutish' ? 'selected' : ''}>Kutish</option>
      </select>
    </div>
  `;

  openModal(
    c ? 'Kontragentni tahrirlash' : 'Kontragent qo\'shish',
    body,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveContragent('${editId || ''}', this)">Saqlash</button>`
  );
}

async function saveContragent(editId, btn) {
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try {
  const name = document.getElementById('c_name').value.trim();
  if (!name) { alert('Nomni kiriting'); return; }
  const row = {
    name, stir: document.getElementById('c_stir').value.trim(),
    phone: document.getElementById('c_phone').value.trim(),
    email: document.getElementById('c_email').value.trim(),
    contract_amount: parseAmountInput('c_amount'),
    status: document.getElementById('c_status').value
  };
  const { error } = editId
    ? await sb.from('contragents').update(row).eq('id', editId)
    : await sb.from('contragents').insert({ firm_id: activeFirmId, documents: [], ...row });

  if (error) { alert('Xatolik: ' + error.message); return; }
  closeModal();
  await refreshAndRender();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteContragent(id) {
  if (!confirm('Kontragentni o\'chirasizmi?')) return;
  const { error } = await sb.from('contragents').delete().eq('id', id);
  if (error) { alert('Xatolik: ' + error.message); return; }
  await refreshAndRender();
}

function openDocsModal(contId) {
  const c = state.contragents.find(x => x.id === contId);
  if (!c.documents) c.documents = [];
  const renderDocs = () => {
    if (!c.documents.length) return `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">Hali fayl yo'q</div>`;
    return `<div class="table-wrap"><table>
      <thead><tr><th>Fayl nomi</th><th>Sana</th><th></th></tr></thead>
      <tbody>${c.documents.map(d => `
        <tr>
          <td>📄 ${escHtml(d.name)}</td>
          <td>${formatDate(d.date)}</td>
          <td><button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteDocument('${contId}','${d.id}')">🗑 O'chirish</button></td>
        </tr>
      `).join('')}</tbody>
    </table></div>`;
  };

  openModal(
    `${escHtml(c.name)} — hujjatlar`,
    `<div class="field">
      <label>Fayl yuklash</label>
      <input type="file" id="doc_file" multiple style="background:var(--bg-3);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);">
    </div>
    <div id="docsList">${renderDocs()}</div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Yopish</button>
     <button class="btn btn-primary" onclick="addDocument('${contId}')">📎 Fayl qo'shish</button>`
  );
  // Store renderDocs for updates
  window._renderDocs = { contId, fn: renderDocs };
}

async function addDocument(contId) {
  const input = document.getElementById('doc_file');
  if (!input || !input.files.length) { alert('Fayl tanlang'); return; }
  const c = state.contragents.find(x => x.id === contId);
  Array.from(input.files).forEach(file => {
    c.documents.push({ id: uid(), name: file.name, date: today(), size: file.size });
  });
  const { error } = await sb.from('contragents').update({ documents: c.documents }).eq('id', contId);
  if (error) { alert('Xatolik: ' + error.message); return; }
  const container = document.getElementById('docsList');
  if (container) container.innerHTML = window._renderDocs.fn();
  await refreshAndRender();
}

async function deleteDocument(contId, docId) {
  const c = state.contragents.find(x => x.id === contId);
  c.documents = c.documents.filter(d => d.id !== docId);
  const { error } = await sb.from('contragents').update({ documents: c.documents }).eq('id', contId);
  if (error) { alert('Xatolik: ' + error.message); return; }
  const container = document.getElementById('docsList');
  if (container) container.innerHTML = window._renderDocs.fn();
  await refreshAndRender();
}

// ══════════════════════════════════════════
// DEBITOR / KREDITOR
// ══════════════════════════════════════════

function renderDebitor() {
  const conts = state.contragents.filter(c => c.firmId === activeFirmId);
  const kassa = state.kassa.filter(k => k.firmId === activeFirmId);

  const rows = conts.map(c => {
    const paid = kassa.filter(k => k.contragentId === c.id && k.type === 'Kirim').reduce((s, k) => s + k.amount, 0);
    const remainder = c.contractAmount - paid;
    return { ...c, paid, remainder };
  });

  const totalDebitor = rows.filter(r => r.remainder > 0).reduce((s, r) => s + r.remainder, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);

  document.getElementById('debitorCards').innerHTML = `
    <div class="stat-card warning">
      <div class="stat-icon warning">⚠️</div>
      <div class="stat-label">Jami debitor qarzi</div>
      <div class="stat-value">${fmt(totalDebitor)}</div>
    </div>
    <div class="stat-card success">
      <div class="stat-icon success">✅</div>
      <div class="stat-label">Jami to'langan</div>
      <div class="stat-value">${fmt(totalPaid)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon info">👥</div>
      <div class="stat-label">Kontragentlar</div>
      <div class="stat-value">${conts.length} ta</div>
    </div>
  `;

  if (!rows.length) {
    document.getElementById('debitorWrap').innerHTML = emptyState('🔁', 'Kontragent yo\'q', 'Kontragentlar bo\'limidan qo\'shing');
    return;
  }

  document.getElementById('debitorWrap').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Kontragent</th><th>Shartnoma</th><th>To'langan</th><th>Qoldiq</th><th>Holat</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
    const pct = r.contractAmount > 0 ? Math.min((r.paid / r.contractAmount) * 100, 100) : 0;
    return `
            <tr>
              <td><strong>${escHtml(r.name)}</strong></td>
              <td>${fmt(r.contractAmount)}</td>
              <td>
                ${fmt(r.paid)}
                <div class="progress-bar" style="margin-top:6px">
                  <div class="progress-fill ${pct >= 100 ? 'ok' : pct >= 60 ? 'warn' : 'over'}" style="width:${pct}%"></div>
                </div>
              </td>
              <td>${fmt(Math.max(r.remainder, 0))}</td>
              <td><span class="badge ${r.remainder <= 0 ? 'success' : 'warning'}">${r.remainder <= 0 ? 'To\'liq to\'langan' : 'Qarzdor'}</span></td>
            </tr>
          `;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ══════════════════════════════════════════
// BYUDJET
// ══════════════════════════════════════════

function renderByudjet() {
  const monthEl = document.getElementById('byudjetMonth');
  const selectedMonth = monthEl?.value || currentMonth();

  const budgets = state.budgets.filter(b => b.firmId === activeFirmId && b.month === selectedMonth);
  const kassa = state.kassa.filter(k => k.firmId === activeFirmId && k.month === selectedMonth && k.type === 'Chiqim');

  if (!budgets.length) {
    document.getElementById('byudjetWrap').innerHTML = emptyState('📅', 'Byudjet belgilanmagan', `${monthLabel(selectedMonth)} uchun byudjet chegaralarini belgilang`);
    return;
  }

  const items = budgets.map(b => {
    const spent = kassa.filter(k => k.category === b.category).reduce((s, k) => s + k.amount, 0);
    const pct = b.limit > 0 ? Math.min((spent / b.limit) * 100, 150) : 0;
    const fillClass = pct >= 100 ? 'over' : pct >= 75 ? 'warn' : 'ok';
    return `
      <div class="budget-item">
        <div class="budget-item-header">
          <div class="budget-item-name">📌 ${escHtml(b.category)}</div>
          <div style="display:flex;gap:10px;align-items:center">
            <span class="budget-item-amounts">${fmt(spent)} / ${fmt(b.limit)}</span>
            <span class="badge ${pct >= 100 ? 'danger' : pct >= 75 ? 'warning' : 'success'}">${Math.round(pct)}%</span>
            <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteBudget('${b.id}')">🗑</button>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${fillClass}" style="width:${Math.min(pct, 100)}%"></div>
        </div>
        ${pct >= 100 ? `<div style="color:var(--danger-light);font-size:12px;margin-top:6px">⚠️ Byudjet oshib ketdi! ${fmt(spent - b.limit)} ortiqcha sarflandi</div>` : ''}
      </div>
    `;
  });

  document.getElementById('byudjetWrap').innerHTML = `<div class="budget-section">${items.join('')}</div>`;
}

function openByudjetModal() {
  const allCats = [...CATEGORIES.income, ...CATEGORIES.expense];
  const body = `
    <div class="field">
      <label>Oy</label>
      <input id="b_month" type="month" value="${currentMonth()}">
    </div>
    <div class="field">
      <label>Kategoriya</label>
      <select id="b_category">
        ${CATEGORIES.expense.map(c => `<option>${c}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Byudjet chegarasi (so'm)</label>
      <input id="b_limit" type="text" inputmode="numeric" placeholder="0" oninput="formatAmountInput(this)">
    </div>
  `;
  openModal(
    'Byudjet belgilash',
    body,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveBudget(this)">Saqlash</button>`
  );
}

async function saveBudget(btn) {
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try {
  const limit = parseAmountInput('b_limit');
  if (!limit) { alert('Summani kiriting'); return; }
  const month = document.getElementById('b_month').value;
  const category = document.getElementById('b_category').value;
  const existing = state.budgets.find(b => b.firmId === activeFirmId && b.month === month && b.category === category);

  const { error } = existing
    ? await sb.from('budgets').update({ amount: limit }).eq('id', existing.id)
    : await sb.from('budgets').insert({ firm_id: activeFirmId, month, category, amount: limit });

  if (error) { alert('Xatolik: ' + error.message); return; }
  closeModal();
  await refreshAndRender();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteBudget(id) {
  const { error } = await sb.from('budgets').delete().eq('id', id);
  if (error) { alert('Xatolik: ' + error.message); return; }
  await refreshAndRender();
}

// ══════════════════════════════════════════
// FAKTURA
// ══════════════════════════════════════════

function renderFaktura() {
  const q = (document.getElementById('fakturaSearch')?.value || '').toLowerCase();
  const statusF = document.getElementById('fakturaFilter')?.value || '';
  const todayStr = today();

  let list = state.invoices.filter(i => i.firmId === activeFirmId);

  // Auto-update status
  list.forEach(inv => {
    if (inv.status === 'Kutilmoqda' && inv.dueDate && inv.dueDate < todayStr) {
      inv.status = 'Muddati o\'tgan';
    }
  });

  if (statusF) list = list.filter(i => i.status === statusF);
  if (q) list = list.filter(i =>
    (i.number || '').toLowerCase().includes(q) ||
    contragentName(i.contragentId).toLowerCase().includes(q) ||
    (i.description || '').toLowerCase().includes(q)
  );

  list.sort((a, b) => b.date.localeCompare(a.date));

  if (!list.length) {
    document.getElementById('fakturaWrap').innerHTML = emptyState('🧾', 'Faktura topilmadi', 'Yangi faktura yaratish uchun tugmani bosing');
    return;
  }

  document.getElementById('fakturaWrap').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Raqam</th><th>Kontragent</th><th>Sana</th><th>Muddat</th><th>Holat</th><th style="text-align:right">Summa</th><th></th></tr>
        </thead>
        <tbody>
          ${list.map(inv => {
    const cls = inv.status === 'To\'langan' ? 'success' : inv.status === 'Muddati o\'tgan' ? 'danger' : 'warning';
    return `
            <tr>
              <td><strong>${escHtml(inv.number)}</strong></td>
              <td>${escHtml(contragentName(inv.contragentId)) || '—'}</td>
              <td>${formatDate(inv.date)}</td>
              <td>${formatDate(inv.dueDate)}</td>
              <td><span class="badge ${cls}">${escHtml(inv.status)}</span></td>
              <td style="text-align:right;font-weight:600">${fmt(inv.amount)}</td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-sm btn-success buxgalter-only" onclick="markInvoicePaid('${inv.id}')">✓ To'landi</button>
                  <button class="btn btn-sm btn-secondary" onclick="printInvoice('${inv.id}')">🖨 Chop</button>
                  <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteInvoice('${inv.id}')">🗑</button>
                </div>
              </td>
            </tr>
          `;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openFakturaModal() {
  const conts = state.contragents.filter(c => c.firmId === activeFirmId);
  const nextNum = 'INV-' + String(state.invoices.filter(i => i.firmId === activeFirmId).length + 1).padStart(3, '0');
  const body = `
    <div class="field-row">
      <div class="field">
        <label>Faktura raqami</label>
        <input id="inv_number" value="${nextNum}">
      </div>
      <div class="field">
        <label>Sana</label>
        <input id="inv_date" type="date" value="${today()}">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Kontragent</label>
        <select id="inv_cont">
          <option value="">— Tanlanmagan —</option>
          ${conts.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>To'lov muddati</label>
        <input id="inv_due" type="date">
      </div>
    </div>
    <div class="field">
      <label>Summa (so'm)</label>
      <input id="inv_amount" type="text" inputmode="numeric" placeholder="0" oninput="formatAmountInput(this)">
    </div>
    <div class="field">
      <label>Tavsif</label>
      <textarea id="inv_desc" placeholder="Mahsulot/xizmat tavsifi..."></textarea>
    </div>
  `;
  openModal(
    'Faktura yaratish',
    body,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveInvoice(this)">Yaratish</button>`
  );
}

async function saveInvoice(btn) {
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try {
  const amount = parseAmountInput('inv_amount');
  if (!amount) { alert('Summani kiriting'); return; }
  const { error } = await sb.from('invoices').insert({
    firm_id: activeFirmId,
    number: document.getElementById('inv_number').value.trim(),
    contragent_id: document.getElementById('inv_cont').value || null,
    date: document.getElementById('inv_date').value,
    due_date: document.getElementById('inv_due').value,
    amount,
    description: document.getElementById('inv_desc').value.trim(),
    status: 'Kutilmoqda'
  });
  if (error) { alert('Xatolik: ' + error.message); return; }
  closeModal();
  await refreshAndRender();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function markInvoicePaid(id) {
  const { error } = await sb.from('invoices').update({ status: 'To\'langan' }).eq('id', id);
  if (error) { alert('Xatolik: ' + error.message); return; }
  await refreshAndRender();
}

async function deleteInvoice(id) {
  if (!confirm('Fakturani o\'chirasizmi?')) return;
  const { error } = await sb.from('invoices').delete().eq('id', id);
  if (error) { alert('Xatolik: ' + error.message); return; }
  await refreshAndRender();
}

function printInvoice(id) {
  const inv = state.invoices.find(x => x.id === id);
  if (!inv) return;
  const firm = state.firms.find(f => f.id === activeFirmId) || {};
  const cont = state.contragents.find(c => c.id === inv.contragentId) || {};
  const printHtml = `
    <div class="invoice-print">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:40px;border-bottom:2px solid #e3e5ea;padding-bottom:24px">
        <div>
          <h1 style="font-size:28px;font-weight:800;color:#6366f1;margin-bottom:4px">FAKTURA</h1>
          <div style="font-size:14px;color:#6b7280">${inv.number}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:700">${escHtml(firm.name)}</div>
          <div style="color:#6b7280;font-size:13px">STIR: ${escHtml(firm.stir || '—')}</div>
          <div style="color:#6b7280;font-size:13px">${escHtml(firm.address || '')}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:32px">
        <div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Kim uchun</div>
          <div style="font-size:16px;font-weight:600">${escHtml(cont.name || '—')}</div>
          <div style="color:#6b7280;font-size:13px">STIR: ${escHtml(cont.stir || '—')}</div>
          <div style="color:#6b7280;font-size:13px">${escHtml(cont.phone || '')}</div>
        </div>
        <div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Tafsilotlar</div>
          <div><strong>Sana:</strong> ${formatDate(inv.date)}</div>
          <div><strong>Muddat:</strong> ${formatDate(inv.dueDate)}</div>
          <div><strong>Holat:</strong> ${escHtml(inv.status)}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:32px">
        <thead>
          <tr style="background:#f5f6f8">
            <th style="padding:12px;text-align:left;border-bottom:2px solid #e3e5ea">Tavsif</th>
            <th style="padding:12px;text-align:right;border-bottom:2px solid #e3e5ea">Summa</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:16px 12px;border-bottom:1px solid #e3e5ea">${escHtml(inv.description || 'Xizmat haqi')}</td>
            <td style="padding:16px 12px;text-align:right;border-bottom:1px solid #e3e5ea;font-weight:600">${fmt(inv.amount)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr style="background:#f5f6f8">
            <td style="padding:16px 12px;font-weight:700;font-size:16px">JAMI TO'LOV</td>
            <td style="padding:16px 12px;text-align:right;font-weight:800;font-size:20px;color:#6366f1">${fmt(inv.amount)}</td>
          </tr>
        </tfoot>
      </table>
      <div style="color:#6b7280;font-size:12px;text-align:center">Ushbu faktura FinanceHub UZ tizimi orqali yaratilgan</div>
    </div>
  `;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${inv.number}</title><style>body{font-family:Arial,sans-serif;color:#1f2430;}</style></head><body>${printHtml}</body></html>`);
  win.document.close();
  win.print();
}

// ══════════════════════════════════════════
// CASHFLOW
// ══════════════════════════════════════════

function renderCashflow() {
  const kassa = state.kassa.filter(k => k.firmId === activeFirmId);

  if (!kassa.length) {
    document.getElementById('cashflowWrap').innerHTML = emptyState('📈', 'Ma\'lumot yo\'q', 'Kassa bo\'limidan yozuv qo\'shing');
    return;
  }

  const months = {};
  kassa.forEach(k => {
    if (!months[k.month]) months[k.month] = { in: 0, out: 0 };
    if (k.type === 'Kirim') months[k.month].in += k.amount;
    else months[k.month].out += k.amount;
  });

  const sorted = Object.keys(months).sort();

  // Chart
  const ctx = document.getElementById('cashflowDetailChart');
  if (ctx) {
    if (cashflowDetailChartInstance) cashflowDetailChartInstance.destroy();
    cashflowDetailChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sorted.map(monthLabel),
        datasets: [
          {
            label: 'Kirim',
            data: sorted.map(m => months[m].in / 1000000),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.1)',
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#10b981',
            pointRadius: 5
          },
          {
            label: 'Chiqim',
            data: sorted.map(m => months[m].out / 1000000),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.1)',
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#ef4444',
            pointRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } } }
        },
        scales: {
          x: { ticks: { color: '#64748b', font: { family: 'Inter' } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#64748b', font: { family: 'Inter' }, callback: v => v + ' mln' }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }

  document.getElementById('cashflowWrap').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Oy</th><th>Kirim</th><th>Chiqim</th><th>Sof oqim</th><th>Jamg'arma</th></tr></thead>
        <tbody>
          ${(() => {
    let cumulative = 0;
    return sorted.map(m => {
      const net = months[m].in - months[m].out;
      cumulative += net;
      return `
                <tr>
                  <td><strong>${monthLabel(m)}</strong></td>
                  <td class="amount-positive">+${fmt(months[m].in)}</td>
                  <td class="amount-negative">−${fmt(months[m].out)}</td>
                  <td>${fmtSign(net)}</td>
                  <td style="font-weight:600">${fmt(cumulative)}</td>
                </tr>`;
    }).join('');
  })()}
        </tbody>
      </table>
    </div>
  `;
}

// ══════════════════════════════════════════
// P&L
// ══════════════════════════════════════════

function renderPL() {
  const monthF = document.getElementById('plMonth')?.value || '';
  let kassa = state.kassa.filter(k => k.firmId === activeFirmId);
  if (monthF) kassa = kassa.filter(k => k.month === monthF);

  if (!kassa.length) {
    document.getElementById('plCards').innerHTML = '';
    document.getElementById('plWrap').innerHTML = emptyState('📑', 'Ma\'lumot yo\'q', 'Kassa yozuvlari asosida hisobot shakllanadi');
    return;
  }

  const income = kassa.filter(k => k.type === 'Kirim');
  const expense = kassa.filter(k => k.type === 'Chiqim');

  const incomeByCategory = {};
  income.forEach(k => { incomeByCategory[k.category] = (incomeByCategory[k.category] || 0) + k.amount; });

  const expenseByCategory = {};
  expense.forEach(k => { expenseByCategory[k.category] = (expenseByCategory[k.category] || 0) + k.amount; });

  const totalIncome = income.reduce((s, k) => s + k.amount, 0);
  const taxExpense = expenseByCategory['Soliqlar'] || 0;
  const totalExpense = expense.reduce((s, k) => s + k.amount, 0);
  const opexTotal = totalExpense - taxExpense;
  const operatingProfit = totalIncome - opexTotal;
  const netProfit = operatingProfit - taxExpense;
  const operatingMargin = totalIncome > 0 ? (operatingProfit / totalIncome) * 100 : null;
  const netMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : null;

  document.getElementById('plCards').innerHTML = `
    <div class="stat-card success">
      <div class="stat-icon success">💰</div>
      <div class="stat-label">Jami daromad</div>
      <div class="stat-value">${fmt(totalIncome)}</div>
    </div>
    <div class="stat-card danger">
      <div class="stat-icon danger">💸</div>
      <div class="stat-label">Operatsion xarajatlar</div>
      <div class="stat-value">${fmt(opexTotal)}</div>
    </div>
    <div class="stat-card ${operatingProfit >= 0 ? 'success' : 'danger'}">
      <div class="stat-icon ${operatingProfit >= 0 ? 'success' : 'danger'}">${operatingProfit >= 0 ? '📈' : '📉'}</div>
      <div class="stat-label">Operativ foyda</div>
      <div class="stat-value">${fmt(operatingProfit)}</div>
      <div class="stat-change ${operatingProfit >= 0 ? 'up' : 'down'}">${operatingMargin !== null ? operatingMargin.toFixed(1) + '% marja' : '—'}</div>
    </div>
    <div class="stat-card warning">
      <div class="stat-icon warning">🧾</div>
      <div class="stat-label">Soliqlar</div>
      <div class="stat-value">${fmt(taxExpense)}</div>
    </div>
    <div class="stat-card ${netProfit >= 0 ? 'success' : 'danger'}">
      <div class="stat-icon ${netProfit >= 0 ? 'success' : 'danger'}">${netProfit >= 0 ? '📈' : '📉'}</div>
      <div class="stat-label">Sof foyda / zarar</div>
      <div class="stat-value">${fmt(netProfit)}</div>
      <div class="stat-change ${netProfit >= 0 ? 'up' : 'down'}">${netMargin !== null ? netMargin.toFixed(1) + '% marja' : '—'}</div>
    </div>
  `;

  const pct = n => totalIncome > 0 ? (n / totalIncome * 100).toFixed(1) + '%' : '—';
  const sectionRow = label => `<tr style="background:var(--bg-3)"><td colspan="3" style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;padding-top:14px;padding-bottom:8px">${label}</td></tr>`;
  const totalRow = (label, amount) => `
    <tr style="border-top:1px solid var(--border)">
      <td><strong>${label}</strong></td>
      <td><strong>${fmtSign(amount)}</strong></td>
      <td><strong>${pct(amount)}</strong></td>
    </tr>`;

  const incomeRows = Object.entries(incomeByCategory).sort((a, b) => b[1] - a[1]);
  const expenseRows = Object.entries(expenseByCategory).filter(([cat]) => cat !== 'Soliqlar').sort((a, b) => b[1] - a[1]);

  document.getElementById('plWrap').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Bo'lim</th><th>Summa</th><th>Daromaddan ulushi</th></tr></thead>
        <tbody>
          ${sectionRow('Daromadlar')}
          ${incomeRows.map(([cat, amt]) => `
            <tr>
              <td>${escHtml(cat)}</td>
              <td class="amount-positive">+${fmt(amt)}</td>
              <td>${pct(amt)}</td>
            </tr>`).join('')}
          ${totalRow('Jami daromad', totalIncome)}

          ${sectionRow('Operatsion xarajatlar (tannarx)')}
          ${expenseRows.length ? expenseRows.map(([cat, amt]) => `
            <tr>
              <td>${escHtml(cat)}</td>
              <td class="amount-negative">−${fmt(amt)}</td>
              <td>${pct(amt)}</td>
            </tr>`).join('') : `<tr><td colspan="3" style="color:var(--text-muted)">Xarajat yo'q</td></tr>`}
          ${totalRow('Jami operatsion xarajat', -opexTotal)}

          ${totalRow('Operativ foyda (EBIT)', operatingProfit)}

          ${sectionRow('Soliqlar')}
          <tr>
            <td>Soliqlar bo'yicha xarajat</td>
            <td class="amount-negative">${taxExpense ? '−' + fmt(taxExpense) : fmt(0)}</td>
            <td>${pct(taxExpense)}</td>
          </tr>

          <tr style="border-top:2px solid var(--border);background:var(--bg-3)">
            <td style="font-size:14px"><strong>SOF FOYDA / ZARAR</strong></td>
            <td style="font-size:14px"><strong>${fmtSign(netProfit)}</strong></td>
            <td style="font-size:14px"><strong>${pct(netProfit)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// ══════════════════════════════════════════
// SOLIQLAR
// ══════════════════════════════════════════

function renderSoliqlar() {
  const firm = state.firms.find(f => f.id === activeFirmId);
  if (!firm) return;

  const kassa = state.kassa.filter(k => k.firmId === activeFirmId);
  const now = currentMonth();
  const monthIncome = kassa.filter(k => k.type === 'Kirim' && k.month === now).reduce((s, k) => s + k.amount, 0);
  const quarterIncome = (() => {
    const d = new Date();
    const qStart = Math.floor((d.getMonth()) / 3) * 3;
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      const dd = new Date(d.getFullYear(), qStart + i, 1);
      const mk = dd.toISOString().slice(0, 7);
      sum += kassa.filter(k => k.type === 'Kirim' && k.month === mk).reduce((s, k) => s + k.amount, 0);
    }
    return sum;
  })();

  const keys = firm.reportKeys || [];
  const rows = REPORT_CATALOG.filter(r => keys.includes(r.key));

  if (!rows.length) {
    document.getElementById('soliqlarWrap').innerHTML = emptyState('🧾', 'Soliq turlari belgilanmagan', 'Firma sozlamalarida soliq turlarini belgilang');
    return;
  }

  document.getElementById('soliqlarWrap').innerHTML = `
    <div class="chart-card" style="margin-bottom:16px">
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Soliq rejimi</div><div style="font-size:15px;font-weight:600;margin-top:4px">${escHtml(firm.regime)}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Oylik kirim bazasi</div><div style="font-size:15px;font-weight:600;margin-top:4px;color:var(--success-light)">${fmt(monthIncome)}</div></div>
        <div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Choraklik kirim</div><div style="font-size:15px;font-weight:600;margin-top:4px;color:var(--accent-light)">${fmt(quarterIncome)}</div></div>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Soliq turi</th><th>Davriyligi</th><th>Stavka</th><th>Taxminiy summa</th><th>Izoh</th></tr></thead>
        <tbody>
          ${rows.map(r => {
    const base = r.freq === 'Choraklik' ? quarterIncome : monthIncome;
    const amount = r.tax ? base * r.rate : 0;
    return `
              <tr>
                <td><strong>${escHtml(r.label)}</strong></td>
                <td><span class="badge info">${r.freq}</span></td>
                <td>${r.tax ? (r.rate * 100).toFixed(0) + '%' : '—'}</td>
                <td style="font-weight:600;color:var(--warning-light)">${r.tax ? fmt(amount) : '—'}</td>
                <td style="font-size:12px;color:var(--text-muted)">Taxminiy hisob</td>
              </tr>
            `;
  }).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:12px;padding:12px 16px;background:var(--warning-bg);border-radius:var(--radius-md);font-size:12.5px;color:var(--warning-light)">
      ⚠️ Soliq summalar taxminiy hisoblangan. Rasmiy hisob-kitob uchun buxgalter maslahati tavsiya etiladi.
    </div>
  `;
}

// ══════════════════════════════════════════
// HISOBOTLAR
// ══════════════════════════════════════════

function renderReports() {
  const todayStr = today();
  const list = state.reports.filter(r => r.firmId === activeFirmId);

  if (!list.length) {
    document.getElementById('reportsWrap').innerHTML = emptyState('📄', 'Hisobot yo\'q', 'Yangi hisobot qo\'shish uchun tugmani bosing');
    return;
  }

  const byMonth = {};
  list.forEach(r => {
    const m = r.dueDate ? r.dueDate.slice(0, 7) : 'Boshqa';
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(r);
  });

  const months = Object.keys(byMonth).sort();

  const row = r => {
    const days = daysUntil(r.dueDate);
    const overdue = r.status !== 'Topshirilgan' && r.dueDate && r.dueDate < todayStr;
    const cls = r.status === 'Topshirilgan' ? 'success' : overdue ? 'danger' : days !== null && days <= 5 ? 'warning' : 'info';
    const label = r.status === 'Topshirilgan' ? 'Topshirilgan' : overdue ? 'Muddati o\'tgan' : 'Kutilmoqda';
    const daysLabel = r.status === 'Topshirilgan' ? '—' : days === null ? '—' : days < 0 ? `${Math.abs(days)} kun o'tdi` : `${days} kun`;
    return `
              <tr>
                <td><strong>${escHtml(r.type)}</strong></td>
                <td>${formatDate(r.dueDate)}</td>
                <td style="color:${overdue ? 'var(--danger-light)' : days !== null && days <= 5 ? 'var(--warning-light)' : 'var(--text-muted)'}">${daysLabel}</td>
                <td><span class="badge ${cls}">${label}</span></td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-sm buxgalter-only btn-${r.status === 'Topshirilgan' ? 'secondary' : 'success'}" onclick="toggleReport('${r.id}')">
                      ${r.status === 'Topshirilgan' ? '↩ Bekor' : '✓ Topshirildi'}
                    </button>
                    <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteReport('${r.id}')">🗑</button>
                  </div>
                </td>
              </tr>
            `;
  };

  document.getElementById('reportsWrap').innerHTML = months.map(m => {
    const rows = byMonth[m].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    const pending = rows.filter(r => r.status !== 'Topshirilgan').length;
    return `
      <div class="chart-card" style="margin-bottom:16px;padding:0;overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:var(--bg-3)">
          <strong style="font-size:14px">${m === 'Boshqa' ? 'Muddati belgilanmagan' : monthLabel(m)}</strong>
          <span class="badge ${pending ? 'warning' : 'success'}">${pending ? pending + ' ta kutilmoqda' : 'Barchasi topshirilgan'}</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Hisobot turi</th><th>Topshirish muddati</th><th>Qolgan kun</th><th>Holat</th><th></th></tr></thead>
            <tbody>${rows.map(row).join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

function openReportModal() {
  const body = `
    <div class="field">
      <label>Firma</label>
      <select id="r_firm">
        ${state.firms.map(f => `<option value="${f.id}" ${f.id === activeFirmId ? 'selected' : ''}>${escHtml(f.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Hisobot turi</label>
      <input id="r_type" placeholder="Masalan: QQS hisoboti">
    </div>
    <div class="field">
      <label>Topshirish muddati</label>
      <input id="r_due" type="date">
    </div>
  `;
  openModal(
    'Hisobot qo\'shish',
    body,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveReport(this)">Saqlash</button>`
  );
}

async function saveReport(btn) {
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try {
  const type = document.getElementById('r_type').value.trim();
  if (!type) { alert('Hisobot turini kiriting'); return; }
  const { error } = await sb.from('reports').insert({
    firm_id: document.getElementById('r_firm').value,
    type, due_date: document.getElementById('r_due').value, status: 'Kutilmoqda'
  });
  if (error) { alert('Xatolik: ' + error.message); return; }
  closeModal();
  await refreshAndRender();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleReport(id) {
  const r = state.reports.find(x => x.id === id);
  const newStatus = r.status === 'Topshirilgan' ? 'Kutilmoqda' : 'Topshirilgan';
  const { error } = await sb.from('reports').update({ status: newStatus }).eq('id', id);
  if (error) { alert('Xatolik: ' + error.message); return; }
  await refreshAndRender();
}

async function deleteReport(id) {
  if (!confirm('Hisobotni o\'chirasizmi?')) return;
  const { error } = await sb.from('reports').delete().eq('id', id);
  if (error) { alert('Xatolik: ' + error.message); return; }
  await refreshAndRender();
}

// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════

function emptyState(icon, title, text) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <h4>${title}</h4>
      <p>${text}</p>
    </div>
  `;
}

// ══════════════════════════════════════════
// CLOCK & DATE
// ══════════════════════════════════════════

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  const dateEl = document.getElementById('topbarDate');
  const timeEl = document.getElementById('sidebarTime');
  const dateStr = now.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' });

  if (dateEl) dateEl.textContent = `${dateStr} · ${timeStr}`;
  if (timeEl) timeEl.textContent = timeStr;
}

// ══════════════════════════════════════════
// RENDER ALL
// ══════════════════════════════════════════

function renderAll() {
  applyRolePermissions();
  renderFirmSelect();
  renderNotifications();

  // Get active view
  const activeView = document.querySelector('.view.active');
  if (!activeView) return;
  const viewId = activeView.id.replace('view-', '');

  // Init month filters
  const byudjetMonthEl = document.getElementById('byudjetMonth');
  if (byudjetMonthEl && !byudjetMonthEl.value) byudjetMonthEl.value = currentMonth();

  switch (viewId) {
    case 'dashboard': renderDashboard(); break;
    case 'kassa': renderKassa(); break;
    case 'debitor': renderDebitor(); break;
    case 'byudjet': renderByudjet(); break;
    case 'faktura': renderFaktura(); break;
    case 'kontragentlar': renderKontragentlar(); break;
    case 'cashflow': renderCashflow(); break;
    case 'pl': renderPL(); break;
    case 'soliqlar': renderSoliqlar(); break;
    case 'hisobotlar': renderReports(); break;
  }
}

function applyRolePermissions() {
  const editAllowed = canEdit();
  document.body.classList.toggle('role-direktor', !editAllowed);
  document.body.classList.toggle('role-buxgalter', editAllowed);
  const badge = document.getElementById('roleBadge');
  if (badge) badge.textContent = editAllowed ? 'Buxgalter' : 'Direktor (faqat ko\'rish)';
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login_email').value.trim();
  const password = document.getElementById('login_password').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { errEl.textContent = 'Email yoki parol noto\'g\'ri.'; return; }
  await startApp();
}

async function handleLogout() {
  await sb.auth.signOut();
  location.reload();
}

async function startApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = '';
  await loadState();
  if (!state.firms.length) {
    document.getElementById('app').innerHTML =
      '<div style="padding:60px;text-align:center;color:var(--text-muted)">Sizga hali birorta firma biriktirilmagan. Buxgalteringiz bilan bog\'laning.</div>';
    return;
  }
  showView('dashboard');
  renderAll();
}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  updateClock();
  setInterval(updateClock, 60000);

  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await startApp();
  } else {
    document.getElementById('loginScreen').style.display = '';
    document.getElementById('app').style.display = 'none';
  }

  // Close notif panel on outside click
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notifPanel');
    const bell = document.getElementById('notifBell');
    if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
      panel.classList.remove('open');
    }
  });
});
