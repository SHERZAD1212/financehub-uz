/* ============================================================
   FinanceHub UZ — v2 (kategoriya asosidagi moliyaviy model)

   Asosiy tamoyil: daromad/xarajat turlari bazadagi `categories`
   jadvalida yashaydi. Kategoriyaning ikki maydoni butun
   integratsiyani boshqaradi:
     • pnl_section  → P/L ning qaysi qatoriga tushishi
     • cf_activity  → Cash Flow ning qaysi faoliyatiga tushishi
   Yangi tur qo'shilganda P/L, Kassa va Cash Flow o'zi yangilanadi.
   ============================================================ */

'use strict';

// ══════════════════════════════════════════
// SUPABASE
// ══════════════════════════════════════════

const SUPABASE_URL = 'https://akevycuxpvmdtjprerfr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZXZ5Y3V4cHZtZHRqcHJlcmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNDY2NzAsImV4cCI6MjA5OTYyMjY3MH0.ez7RubUUTDwzGqBNwfAEiNcdLmafhhegRUYObLQn1ew';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════

let state = null;
let activeFirmId = null;
let currentUser = null;
let firmMemberships = [];

let cashflowChartInstance = null;
let categoryChartInstance = null;
let cashflowDetailChartInstance = null;

const PNL_SECTIONS = [
  { key: 'revenue',  label: 'Daromad' },
  { key: 'cogs',     label: 'Tannarx (COGS)' },
  { key: 'opex',     label: 'Operatsion xarajat (OPEX)' },
  { key: 'interest', label: 'Foiz xarajatlari' },
  { key: 'tax',      label: 'Soliqlar' }
];

const CF_ACTIVITIES = [
  { key: 'operating', label: 'Joriy (operatsion) faoliyat' },
  { key: 'investing', label: 'Investitsion faoliyat' },
  { key: 'financing', label: 'Moliyaviy faoliyat' }
];

const ACCOUNT_TYPES = [
  { key: 'naqd',             label: 'Naqd' },
  { key: 'bank',             label: 'Bank hisobi' },
  { key: 'karta',            label: 'Karta' },
  { key: 'elektron_hamyon',  label: 'Elektron hamyon' },
  { key: 'yoldagi_pul',      label: "Yo'ldagi pul" }
];

const PAYMENT_METHODS = ['naqd', 'bank', 'karta', 'elektron_hamyon'];

const PAGE_TITLES = {
  dashboard: 'Boshqaruv paneli',
  kassa: 'Kassa — to\'lovlar',
  operatsiyalar: 'Operatsiyalar',
  debitor: 'Debitor / Kreditor',
  byudjet: 'Byudjet rejalashtirish',
  cashflow: 'Cash Flow',
  pl: 'P&L Hisobot',
  balans: 'Balans',
  soliqlar: 'Soliqlar',
  hisobotlar: 'Hisobot muddatlari',
  kategoriyalar: 'Kategoriyalar',
  hisoblar: 'Hisoblar / Bank',
  kontragentlar: 'Kontragentlar',
  admin: 'Admin panel'
};

// Topshiriladigan davlat hisobotlari ro'yxati (muddat kuzatuvi uchun)
const REPORT_CATALOG = [
  { key: 'qqs',        label: 'QQS hisoboti',                                   freq: 'Oylik' },
  { key: 'foyda',      label: 'Foyda solig\'i',                                 freq: 'Choraklik' },
  { key: 'daromad',    label: 'Jismoniy shaxslar daromad solig\'i (agent)',     freq: 'Oylik' },
  { key: 'ijtimoiy',   label: 'Ijtimoiy soliq',                                 freq: 'Oylik' },
  { key: 'aylanma',    label: 'Aylanmadan olinadigan soliq',                    freq: 'Oylik' },
  { key: 'molmulk',    label: 'Yuridik shaxslar mol-mulk solig\'i',             freq: 'Choraklik' },
  { key: 'yer',        label: 'Yer solig\'i',                                   freq: 'Yillik' },
  { key: 'suv',        label: 'Suv resurslaridan foydalanganlik uchun soliq',   freq: 'Oylik' },
  { key: 'statistika', label: 'Statistika hisoboti',                            freq: 'Choraklik' }
];

// ══════════════════════════════════════════
// ROLLAR
// ══════════════════════════════════════════

function roleForFirm(firmId) {
  const m = firmMemberships.find(m => m.firm_id === firmId);
  return m ? m.role_in_firm : null;
}
function canEdit() {
  return roleForFirm(activeFirmId) === 'buxgalter';
}

// ══════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '0 so\'m';
  return Math.abs(Math.round(n)).toLocaleString('ru-RU') + ' so\'m';
}

function fmtSign(n) {
  const abs = fmt(n);
  if (n > 0) return `<span class="amount-positive">+${abs}</span>`;
  if (n < 0) return `<span class="amount-negative">−${abs}</span>`;
  return `<span class="amount-neutral">${abs}</span>`;
}

function formatAmountInput(el) {
  const raw = el.value.replace(/\D/g, '');
  el.value = raw ? Number(raw).toLocaleString('ru-RU') : '';
}

function parseAmountInput(id) {
  const raw = (document.getElementById(id)?.value || '').replace(/\D/g, '');
  return raw ? Number(raw) : 0;
}

function today() { return new Date().toISOString().slice(0, 10); }
function currentMonth() { return new Date().toISOString().slice(0, 7); }

function formatDate(d) {
  if (!d) return '—';
  const p = String(d).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
}

function monthOf(dateStr) { return String(dateStr || '').slice(0, 7); }

function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const months = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
  return `${months[parseInt(mo) - 1]} ${y}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function monthsBetween(from, to) {
  const out = [];
  if (!from || !to) return out;
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// ══════════════════════════════════════════
// UI HELPERS (toast / confirm / loader / modal)
// ══════════════════════════════════════════

function toast(message, type = 'info', timeout = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'i'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, timeout);
}

function confirmDialog(message, { okText = 'Ha, o\'chirish', danger = true } = {}) {
  return new Promise(resolve => {
    let overlay = document.getElementById('confirmOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'confirmOverlay';
      overlay.className = 'overlay';
      overlay.innerHTML = '<div class="modal confirm-modal"></div>';
      document.body.appendChild(overlay);
    }
    const modal = overlay.querySelector('.modal');
    modal.innerHTML = `
      <div class="modal-body" style="padding-top:24px;text-align:center">
        <div style="font-size:38px;margin-bottom:12px">${danger ? '🗑️' : '❓'}</div>
        <div style="font-size:14.5px;color:var(--text);line-height:1.5">${escHtml(message)}</div>
      </div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-secondary" data-act="cancel">Bekor</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escHtml(okText)}</button>
      </div>`;
    overlay.classList.add('open');
    const finish = v => { overlay.classList.remove('open'); resolve(v); };
    modal.querySelector('[data-act="cancel"]').onclick = () => finish(false);
    modal.querySelector('[data-act="ok"]').onclick = () => finish(true);
    overlay.onclick = e => { if (e.target === overlay) finish(false); };
  });
}

function setBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) { btn.classList.add('is-loading'); btn.disabled = true; }
  else { btn.classList.remove('is-loading'); btn.disabled = false; }
}

function showLoader(text = 'Yuklanmoqda...') {
  let el = document.getElementById('appLoader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'appLoader';
    el.className = 'app-loader';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="spinner"></div><div>${escHtml(text)}</div>`;
  el.style.display = 'flex';
}
function hideLoader() {
  const el = document.getElementById('appLoader');
  if (el) el.style.display = 'none';
}

// Stat kartalardagi raqamlarni 0 dan sanab chiqadi (faqat bir marta, bo'lim ochilganda)
function animateCounts(root) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const scope = root || document;
  scope.querySelectorAll('.stat-value').forEach(el => {
    if (el.dataset.animated) return;
    if (el.children.length) { el.dataset.animated = '1'; return; } // ichida span bo'lsa — tegmaymiz
    const text = el.textContent;
    const match = text.match(/\d[\d\s]*/);
    if (!match) { el.dataset.animated = '1'; return; }
    const target = parseInt(match[0].replace(/\s/g, ''), 10);
    if (isNaN(target) || target < 1) { el.dataset.animated = '1'; return; }
    const prefix = text.slice(0, match.index);
    const suffix = text.slice(match.index + match[0].length);
    el.dataset.animated = '1';
    const dur = 650, startT = performance.now();
    const step = now => {
      const t = Math.min((now - startT) / dur, 1);
      const val = Math.round(target * (1 - Math.pow(1 - t, 3)));
      el.textContent = prefix + val.toLocaleString('ru-RU') + suffix;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = text;
    };
    requestAnimationFrame(step);
  });
}

function skeletonGrid(cards = 4) {
  return `<div class="skeleton-grid">${Array(cards).fill('<div class="skeleton skeleton-card"></div>').join('')}</div>`;
}
function skeletonRows(n = 5) {
  return Array(n).fill('<div class="skeleton skeleton-row"></div>').join('');
}

// Mini trend chizig'i (sparkline) — kartalar uchun
function sparklineSVG(values, color) {
  const w = 78, h = 30, pad = 4;
  const vals = (values && values.length) ? values : [0, 0];
  const max = Math.max(...vals), min = Math.min(...vals);
  const range = (max - min) || 1;
  const n = vals.length;
  const pts = vals.map((v, i) => {
    const x = pad + (w - 2 * pad) * (n > 1 ? i / (n - 1) : 0.5);
    const y = pad + (h - 2 * pad) * (1 - (v - min) / range);
    return [x, y];
  });
  const poly = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" fill="none" preserveAspectRatio="none">
    <polyline points="${poly}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
}

// ── Tema (light / dark) ──
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#EEF2F1' : '#0A1312');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem('raqamx-theme', next); } catch (_) {}
  if (state) renderAll(); // grafiklar yangi ranglar bilan qayta chiziladi
}

// Grafik ranglari — joriy temadan o'qiladi (light/dark ga moslashadi)
function chartColors() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const cs = getComputedStyle(document.documentElement);
  return {
    tick: (cs.getPropertyValue('--text-muted').trim() || '#8AA19C'),
    legend: (cs.getPropertyValue('--text-secondary').trim() || '#8AA19C'),
    grid: isLight ? 'rgba(12,90,82,0.10)' : 'rgba(255,255,255,0.05)',
    cardBg: (cs.getPropertyValue('--bg-card').trim() || '#101B1A')
  };
}

// Ism/nomdan avatar harflari
function avatarInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  const ini = (parts[0][0] || '') + (parts[1] ? parts[1][0] : '');
  return ini.toUpperCase();
}

function openModal(titleHtml, bodyHtml, actionsHtml, wide) {
  const m = document.getElementById('modalBody');
  m.style.width = wide ? '640px' : '';
  m.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${titleHtml}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-actions">${actionsHtml}</div>`;
  document.getElementById('overlay').classList.add('open');
}
function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('modalBody').innerHTML = '';
}
function overlayClick(e) {
  if (e.target === document.getElementById('overlay')) closeModal();
}

function emptyState(icon, title, text) {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <h4>${escHtml(title)}</h4>
    <p>${escHtml(text)}</p>
  </div>`;
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════
// DATA LAYER
// ══════════════════════════════════════════

const mapCategory = r => ({
  id: r.id, firmId: r.firm_id, name: r.name, type: r.type,
  pnlSection: r.pnl_section, cfActivity: r.cf_activity,
  direction: r.direction || '', isArchived: !!r.is_archived, sortOrder: r.sort_order || 0
});
const mapAccount = r => ({
  id: r.id, firmId: r.firm_id, name: r.name, accountType: r.account_type,
  openingBalance: Number(r.opening_balance) || 0, openingBalanceDate: r.opening_balance_date,
  isActive: r.is_active !== false, sortOrder: r.sort_order || 0
});
const mapOperation = r => ({
  id: r.id, firmId: r.firm_id, categoryId: r.category_id, contragentId: r.contragent_id || '',
  amount: Number(r.amount) || 0, accrualDate: r.accrual_date, dueDate: r.due_date || '',
  isInvoice: !!r.is_invoice, status: r.status, paidAmount: Number(r.paid_amount) || 0,
  number: r.number || '', description: r.description || ''
});
const mapPayment = r => ({
  id: r.id, operationId: r.operation_id, accountId: r.account_id || '',
  amount: Number(r.amount) || 0, paymentDate: r.payment_date,
  paymentMethod: r.payment_method || 'naqd', note: r.note || ''
});
const mapTransfer = r => ({
  id: r.id, firmId: r.firm_id, fromAccountId: r.from_account_id || '', toAccountId: r.to_account_id || '',
  amount: Number(r.amount) || 0, sentDate: r.sent_date, receivedDate: r.received_date || '',
  status: r.status, note: r.note || ''
});
const mapFirm = r => ({
  id: r.id, name: r.name, stir: r.stir || '', phone: r.phone || '',
  address: r.address || '', regime: r.regime || '', reportKeys: r.report_keys || []
});
const mapReport = r => ({
  id: r.id, firmId: r.firm_id, type: r.type || '', dueDate: r.due_date || '', status: r.status
});
const mapCont = r => ({
  id: r.id, firmId: r.firm_id, name: r.name, stir: r.stir || '',
  phone: r.phone || '', email: r.email || '', status: r.status || 'Faol'
});
const mapAsset = r => ({
  id: r.id, firmId: r.firm_id, name: r.name,
  purchaseValue: Number(r.purchase_value) || 0, purchaseDate: r.purchase_date,
  usefulLifeMonths: Number(r.useful_life_months) || 1,
  disposalDate: r.disposal_date || '', disposalAmount: Number(r.disposal_amount) || 0
});
const mapBudget = r => ({ id: r.id, firmId: r.firm_id, month: r.month, category: r.category, limit: Number(r.amount) || 0 });

async function loadState() {
  const { data: { user } } = await sb.auth.getUser();
  currentUser = user;

  const { data: members } = await sb.from('firm_members')
    .select('firm_id, role_in_firm').eq('user_id', user.id);
  firmMemberships = members || [];

  const [firmsR, catR, accR, opR, payR, trR, contR, faR, budR, repR] = await Promise.all([
    sb.from('firms').select('*'),
    sb.from('categories').select('*'),
    sb.from('cash_accounts').select('*'),
    sb.from('financial_operations').select('*'),
    sb.from('payments').select('*'),
    sb.from('account_transfers').select('*'),
    sb.from('contragents').select('*'),
    sb.from('fixed_assets').select('*'),
    sb.from('budgets').select('*'),
    sb.from('reports').select('*')
  ]);

  const firstErr = [firmsR, catR, accR, opR, payR, trR, contR].find(r => r.error);
  if (firstErr) throw new Error(firstErr.error.message);

  state = {
    firms: (firmsR.data || []).map(mapFirm),
    categories: (catR.data || []).map(mapCategory),
    accounts: (accR.data || []).map(mapAccount),
    operations: (opR.data || []).map(mapOperation),
    payments: (payR.data || []).map(mapPayment),
    transfers: (trR.data || []).map(mapTransfer),
    contragents: (contR.data || []).map(mapCont),
    assets: (faR.data || []).map(mapAsset),
    budgets: (budR.data || []).map(mapBudget),
    reports: (repR.data || []).map(mapReport)
  };

  if (!state.firms.some(f => f.id === activeFirmId)) {
    activeFirmId = state.firms[0] ? state.firms[0].id : null;
  }
}

async function refreshAndRender() {
  await loadState();
  renderAll();
}

// ── Lookups & firm-scoped selectors ──
function catById(id) { return state.categories.find(c => c.id === id) || null; }
function accById(id) { return state.accounts.find(a => a.id === id) || null; }
function opById(id) { return state.operations.find(o => o.id === id) || null; }
function contragentName(id) { const c = state.contragents.find(x => x.id === id); return c ? c.name : ''; }

function firmCategories(includeArchived) {
  return state.categories
    .filter(c => c.firmId === activeFirmId && (includeArchived || !c.isArchived))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
function firmAccounts(includeInactive) {
  return state.accounts
    .filter(a => a.firmId === activeFirmId && (includeInactive || a.isActive))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
function firmOperations() { return state.operations.filter(o => o.firmId === activeFirmId); }
function firmPayments() {
  const ids = new Set(firmOperations().map(o => o.id));
  return state.payments.filter(p => ids.has(p.operationId));
}
function firmTransfers() { return state.transfers.filter(t => t.firmId === activeFirmId); }
function firmContragents() { return state.contragents.filter(c => c.firmId === activeFirmId); }

function paymentSigned(p) {
  const op = opById(p.operationId);
  const cat = op ? catById(op.categoryId) : null;
  if (!cat) return 0;
  return cat.type === 'revenue' ? p.amount : -p.amount;
}
function paymentCategory(p) {
  const op = opById(p.operationId);
  return op ? catById(op.categoryId) : null;
}

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active', 'anim-enter'));
  const target = document.getElementById('view-' + id);
  if (target) target.classList.add('active', 'anim-enter');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === id));
  document.getElementById('pageTitle').textContent = PAGE_TITLES[id] || id;
  renderAll();
  document.getElementById('notifPanel').classList.remove('open');
  closeMobileSidebar();
  setTimeout(() => animateCounts(), 40);
  if (target) setTimeout(() => target.classList.remove('anim-enter'), 850);
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('collapsed'); }
function openMobileSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebarBackdrop').classList.add('show');
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}
function setActiveFirm(id) { activeFirmId = id; renderAll(); }
function toggleNotifPanel() { document.getElementById('notifPanel').classList.toggle('open'); }

// ══════════════════════════════════════════
// FIRMA
// ══════════════════════════════════════════

function renderFirmSelect() {
  const sel = document.getElementById('firmSelect');
  sel.innerHTML = state.firms.map(f =>
    `<option value="${escHtml(f.id)}" ${f.id === activeFirmId ? 'selected' : ''}>${escHtml(f.name)}</option>`
  ).join('');
}

function openFirmModal() {
  openModal('Yangi firma qo\'shish', `
    <div class="field-row">
      <div class="field"><label>Firma nomi *</label><input id="f_name" placeholder="Asr Tekstil MCHJ"></div>
      <div class="field"><label>STIR</label><input id="f_stir" placeholder="123456789"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Telefon</label><input id="f_phone" placeholder="+998 71 ..."></div>
      <div class="field"><label>Soliq rejimi</label><select id="f_regime">
        <option>QQS to'lovchi</option><option>Aylanma soliq</option>
        <option>Yagona soliq to'lovchi</option><option>Oddiy deklaratsiya</option>
      </select></div>
    </div>
    <div class="field"><label>Manzil</label><input id="f_address" placeholder="Shahar, tuman"></div>
    <div class="field-hint">Firma yaratilgach standart kategoriyalar va hisoblar avtomatik qo'shiladi.</div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveFirm(this)">Saqlash</button>`);
}

async function saveFirm(btn) {
  const name = document.getElementById('f_name').value.trim();
  if (!name) { toast('Firma nomini kiriting', 'warning'); return; }
  setBtnLoading(btn, true);
  try {
    const firmId = crypto.randomUUID();
    const { error: firmErr } = await sb.from('firms').insert({
      id: firmId, name,
      stir: document.getElementById('f_stir').value.trim(),
      phone: document.getElementById('f_phone').value.trim(),
      address: document.getElementById('f_address').value.trim(),
      regime: document.getElementById('f_regime').value,
      created_by: currentUser.id
    });
    if (firmErr) { toast('Xatolik (firma): ' + firmErr.message, 'error'); return; }

    const { error: memberErr } = await sb.from('firm_members')
      .insert({ firm_id: firmId, user_id: currentUser.id, role_in_firm: 'buxgalter' });
    if (memberErr) { toast('Xatolik (a\'zolik): ' + memberErr.message, 'error'); return; }

    // Standart hisoblar (kategoriyalar DB triggeri orqali avtomat qo'shiladi).
    // Xatolik bo'lsa ham firma yaratilgan — hisobni qo'lda qo'shish mumkin.
    try { await sb.rpc('seed_default_accounts', { f: firmId }); } catch (_) { /* ixtiyoriy */ }

    activeFirmId = firmId;
    closeModal();
    toast('Firma qo\'shildi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

// ══════════════════════════════════════════
// KATEGORIYALAR  (yangi tur → avtomat P/L + Kassa)
// ══════════════════════════════════════════

function sectionLabel(key) { return (PNL_SECTIONS.find(s => s.key === key) || {}).label || key; }
function activityLabel(key) { return (CF_ACTIVITIES.find(a => a.key === key) || {}).label || key; }

function renderKategoriyalar() {
  const q = (document.getElementById('catSearch')?.value || '').toLowerCase();
  const typeF = document.getElementById('catTypeFilter')?.value || '';

  let list = firmCategories(true);
  if (typeF) list = list.filter(c => c.type === typeF);
  if (q) list = list.filter(c =>
    c.name.toLowerCase().includes(q) || (c.direction || '').toLowerCase().includes(q));

  const wrap = document.getElementById('kategoriyalarWrap');
  if (!list.length) {
    wrap.innerHTML = emptyState('🏷️', 'Kategoriya topilmadi',
      'Yangi daromad yoki xarajat turini qo\'shing — u avtomat P/L va Kassaga ulanadi');
    return;
  }

  const usage = {};
  firmOperations().forEach(o => { usage[o.categoryId] = (usage[o.categoryId] || 0) + 1; });

  wrap.innerHTML = `
    <div style="margin-bottom:14px;padding:12px 16px;background:var(--info-bg);border-radius:var(--radius-md);font-size:12.5px;color:var(--accent)">
      ℹ️ Bu yerga qo'shilgan har bir tur avtomat ravishda Kassa, P/L va Cash Flow hisobotlariga ulanadi.
      <b>P/L bo'limi</b> — hisobotning qaysi qatoriga tushishini, <b>Faoliyat turi</b> — Cash Flow qaysi qismiga tushishini belgilaydi.
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Nomi</th><th>Turi</th><th>P/L bo'limi</th><th>Faoliyat</th>
        <th>Yo'nalish</th><th>Ishlatilgan</th><th></th>
      </tr></thead>
      <tbody>${list.map(c => `
        <tr${c.isArchived ? ' style="opacity:.5"' : ''}>
          <td><strong>${escHtml(c.name)}</strong>${c.isArchived ? ' <span class="badge muted">arxiv</span>' : ''}</td>
          <td><span class="badge ${c.type === 'revenue' ? 'success' : 'danger'}">${c.type === 'revenue' ? 'Daromad' : 'Xarajat'}</span></td>
          <td>${escHtml(sectionLabel(c.pnlSection))}</td>
          <td><span class="badge info">${escHtml(activityLabel(c.cfActivity).split(' ')[0])}</span></td>
          <td>${escHtml(c.direction) || '—'}</td>
          <td style="color:var(--text-muted)">${usage[c.id] || 0} ta</td>
          <td><div class="row-actions">
            <button class="btn btn-sm btn-secondary buxgalter-only" onclick="openCategoryModal('${c.id}')">✏️</button>
            <button class="btn btn-sm btn-secondary buxgalter-only" onclick="toggleCategoryArchive('${c.id}')">${c.isArchived ? '↩' : '📦'}</button>
            <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteCategory('${c.id}')">🗑</button>
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function openCategoryModal(editId) {
  const c = editId ? catById(editId) : null;
  const opt = (arr, sel) => arr.map(x =>
    `<option value="${x.key}" ${sel === x.key ? 'selected' : ''}>${escHtml(x.label)}</option>`).join('');

  openModal(c ? 'Kategoriyani tahrirlash' : 'Kategoriya qo\'shish', `
    <div class="field">
      <label>Nomi *</label>
      <input id="cat_name" value="${c ? escHtml(c.name) : ''}" placeholder="Masalan: IT kurslardan tushum">
    </div>
    <div class="field-row">
      <div class="field">
        <label>Turi *</label>
        <select id="cat_type" onchange="syncCategoryDefaults()">
          <option value="revenue" ${c && c.type === 'revenue' ? 'selected' : ''}>Daromad</option>
          <option value="expense" ${!c || c.type === 'expense' ? 'selected' : ''}>Xarajat</option>
        </select>
      </div>
      <div class="field">
        <label>P/L bo'limi *</label>
        <select id="cat_section">${opt(PNL_SECTIONS, c ? c.pnlSection : 'opex')}</select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Cash Flow faoliyati *</label>
        <select id="cat_activity">${opt(CF_ACTIVITIES, c ? c.cfActivity : 'operating')}</select>
      </div>
      <div class="field">
        <label>Yo'nalish / bo'lim</label>
        <input id="cat_direction" value="${c ? escHtml(c.direction) : ''}" placeholder="IT, Marketing...">
      </div>
    </div>
    <div class="field-hint">
      <b>Maslahat:</b> daromad → "Daromad"; tovar/xizmat tannarxi → "Tannarx"; ijara, ish haqi → "OPEX";
      soliqlar → "Soliqlar"; kredit foizi → "Foiz xarajatlari".<br>
      Mijozga qaytarilgan to'lov: turi <b>Xarajat</b>, bo'limi <b>Daromad</b> (daromaddan ayiriladi).
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveCategory('${editId || ''}', this)">Saqlash</button>`);
}

function syncCategoryDefaults() {
  const type = document.getElementById('cat_type').value;
  const sec = document.getElementById('cat_section');
  if (sec) sec.value = type === 'revenue' ? 'revenue' : 'opex';
}

async function saveCategory(editId, btn) {
  const name = document.getElementById('cat_name').value.trim();
  if (!name) { toast('Kategoriya nomini kiriting', 'warning'); return; }
  const row = {
    name,
    type: document.getElementById('cat_type').value,
    pnl_section: document.getElementById('cat_section').value,
    cf_activity: document.getElementById('cat_activity').value,
    direction: document.getElementById('cat_direction').value.trim() || null
  };
  setBtnLoading(btn, true);
  try {
    const { error } = editId
      ? await sb.from('categories').update(row).eq('id', editId)
      : await sb.from('categories').insert({ firm_id: activeFirmId, ...row });
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast(editId ? 'Kategoriya yangilandi' : 'Kategoriya qo\'shildi — hisobotlarga ulandi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

async function toggleCategoryArchive(id) {
  const c = catById(id);
  if (!c) return;
  const { error } = await sb.from('categories').update({ is_archived: !c.isArchived }).eq('id', id);
  if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
  toast(c.isArchived ? 'Arxivdan chiqarildi' : 'Arxivga olindi', 'success');
  await refreshAndRender();
}

async function deleteCategory(id) {
  const used = firmOperations().some(o => o.categoryId === id);
  if (used) {
    toast('Bu kategoriya operatsiyalarda ishlatilgan — uni o\'chirib bo\'lmaydi. Arxivga oling.', 'warning', 5500);
    return;
  }
  if (!(await confirmDialog('Ushbu kategoriyani o\'chirasizmi?'))) return;
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
  toast('Kategoriya o\'chirildi', 'success');
  await refreshAndRender();
}

// ══════════════════════════════════════════
// HISOBLAR / BANK
// ══════════════════════════════════════════

function accountBalance(accId, asOf) {
  const acc = accById(accId);
  if (!acc) return 0;
  const limit = asOf || '9999-12-31';
  let bal = acc.openingBalanceDate <= limit ? acc.openingBalance : 0;

  firmPayments().forEach(p => {
    if (p.accountId === accId && p.paymentDate <= limit) bal += paymentSigned(p);
  });
  firmTransfers().forEach(t => {
    if (t.fromAccountId === accId && t.sentDate <= limit) bal -= t.amount;
    if (t.toAccountId === accId && t.receivedDate && t.receivedDate <= limit) bal += t.amount;
  });
  return bal;
}

function inTransitTotal(asOf) {
  const limit = asOf || '9999-12-31';
  return firmTransfers()
    .filter(t => t.sentDate <= limit && (!t.receivedDate || t.receivedDate > limit))
    .reduce((s, t) => s + t.amount, 0);
}

function totalCash(asOf) {
  return firmAccounts(true).reduce((s, a) => s + accountBalance(a.id, asOf), 0) + inTransitTotal(asOf);
}

function accountTypeLabel(k) { return (ACCOUNT_TYPES.find(t => t.key === k) || {}).label || k; }

function renderHisoblar() {
  const accounts = firmAccounts(true);
  const transit = inTransitTotal();

  document.getElementById('hisoblarCards').innerHTML = `
    <div class="stat-card accent">
      <div class="stat-icon accent">💰</div>
      <div class="stat-label">Jami pul mablag'lari</div>
      <div class="stat-value">${fmt(totalCash())}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon info">🏦</div>
      <div class="stat-label">Hisoblar soni</div>
      <div class="stat-value">${accounts.length} ta</div>
    </div>
    <div class="stat-card warning">
      <div class="stat-icon warning">🚚</div>
      <div class="stat-label">Yo'ldagi pul</div>
      <div class="stat-value">${fmt(transit)}</div>
    </div>`;

  const wrap = document.getElementById('hisoblarWrap');
  if (!accounts.length) {
    wrap.innerHTML = emptyState('🏦', 'Hisob yo\'q', 'Naqd, bank yoki karta hisobini qo\'shing');
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Nomi</th><th>Turi</th><th>Boshlang'ich qoldiq</th><th style="text-align:right">Joriy qoldiq</th><th>Holat</th><th></th></tr></thead>
      <tbody>${accounts.map(a => {
        const bal = accountBalance(a.id);
        return `<tr>
          <td><strong>${escHtml(a.name)}</strong></td>
          <td><span class="badge info">${escHtml(accountTypeLabel(a.accountType))}</span></td>
          <td style="color:var(--text-muted)">${fmt(a.openingBalance)} <span style="font-size:11px">(${formatDate(a.openingBalanceDate)})</span></td>
          <td style="text-align:right;font-weight:600">${fmtSign(bal)}</td>
          <td><span class="badge ${a.isActive ? 'success' : 'muted'}">${a.isActive ? 'Faol' : 'Nofaol'}</span></td>
          <td><div class="row-actions">
            <button class="btn btn-sm btn-secondary buxgalter-only" onclick="openAccountModal('${a.id}')">✏️</button>
            <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteAccount('${a.id}')">🗑</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function openAccountModal(editId) {
  const a = editId ? accById(editId) : null;
  openModal(a ? 'Hisobni tahrirlash' : 'Hisob qo\'shish', `
    <div class="field-row">
      <div class="field"><label>Nomi *</label>
        <input id="acc_name" value="${a ? escHtml(a.name) : ''}" placeholder="Hamkor bank / Click / Naqd"></div>
      <div class="field"><label>Turi *</label>
        <select id="acc_type">${ACCOUNT_TYPES.map(t =>
          `<option value="${t.key}" ${a && a.accountType === t.key ? 'selected' : ''}>${escHtml(t.label)}</option>`).join('')}
        </select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Boshlang'ich qoldiq</label>
        <input id="acc_opening" type="text" inputmode="numeric" oninput="formatAmountInput(this)"
               value="${a ? a.openingBalance.toLocaleString('ru-RU') : ''}" placeholder="0"></div>
      <div class="field"><label>Qoldiq sanasi</label>
        <input id="acc_date" type="date" value="${a ? a.openingBalanceDate : today()}"></div>
    </div>
    <div class="field"><label>Holat</label>
      <select id="acc_active">
        <option value="1" ${!a || a.isActive ? 'selected' : ''}>Faol</option>
        <option value="0" ${a && !a.isActive ? 'selected' : ''}>Nofaol</option>
      </select></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveAccount('${editId || ''}', this)">Saqlash</button>`);
}

async function saveAccount(editId, btn) {
  const name = document.getElementById('acc_name').value.trim();
  if (!name) { toast('Hisob nomini kiriting', 'warning'); return; }
  const row = {
    name,
    account_type: document.getElementById('acc_type').value,
    opening_balance: parseAmountInput('acc_opening'),
    opening_balance_date: document.getElementById('acc_date').value || today(),
    is_active: document.getElementById('acc_active').value === '1'
  };
  setBtnLoading(btn, true);
  try {
    const { error } = editId
      ? await sb.from('cash_accounts').update(row).eq('id', editId)
      : await sb.from('cash_accounts').insert({ firm_id: activeFirmId, ...row });
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast(editId ? 'Hisob yangilandi' : 'Hisob qo\'shildi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

async function deleteAccount(id) {
  const used = firmPayments().some(p => p.accountId === id) ||
               firmTransfers().some(t => t.fromAccountId === id || t.toAccountId === id);
  if (used) { toast('Bu hisobda to\'lovlar bor — o\'chirib bo\'lmaydi. Nofaol qiling.', 'warning', 5000); return; }
  if (!(await confirmDialog('Ushbu hisobni o\'chirasizmi?'))) return;
  const { error } = await sb.from('cash_accounts').delete().eq('id', id);
  if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
  toast('Hisob o\'chirildi', 'success');
  await refreshAndRender();
}

// ══════════════════════════════════════════
// OPERATSIYALAR (hisoblangan)
// ══════════════════════════════════════════

const STATUS_LABEL = { unpaid: 'To\'lanmagan', partial: 'Qisman', paid: 'To\'langan' };
const STATUS_CLASS = { unpaid: 'warning', partial: 'info', paid: 'success' };

function renderOperatsiyalar() {
  const q = (document.getElementById('opSearch')?.value || '').toLowerCase();
  const statusF = document.getElementById('opStatusFilter')?.value || '';
  const typeF = document.getElementById('opTypeFilter')?.value || '';

  let list = firmOperations();
  if (statusF) list = list.filter(o => o.status === statusF);
  if (typeF === 'invoice') list = list.filter(o => o.isInvoice);
  else if (typeF) list = list.filter(o => (catById(o.categoryId) || {}).type === typeF);
  if (q) list = list.filter(o =>
    (o.number || '').toLowerCase().includes(q) ||
    (o.description || '').toLowerCase().includes(q) ||
    ((catById(o.categoryId) || {}).name || '').toLowerCase().includes(q) ||
    contragentName(o.contragentId).toLowerCase().includes(q));

  list.sort((a, b) => (b.accrualDate || '').localeCompare(a.accrualDate || ''));

  const wrap = document.getElementById('operatsiyalarWrap');
  if (!list.length) {
    wrap.innerHTML = emptyState('📄', 'Operatsiya topilmadi',
      'Hisoblangan daromad yoki xarajat (faktura) qo\'shing');
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Sana</th><th>Kategoriya</th><th>Kontragent</th><th>Muddat</th>
        <th style="text-align:right">Summa</th><th style="text-align:right">To'langan</th>
        <th>Holat</th><th></th>
      </tr></thead>
      <tbody>${list.map(o => {
        const cat = catById(o.categoryId);
        const remain = o.amount - o.paidAmount;
        return `<tr>
          <td>${formatDate(o.accrualDate)}${o.isInvoice ? `<div style="font-size:11px;color:var(--text-muted)">${escHtml(o.number || 'faktura')}</div>` : ''}</td>
          <td><strong>${escHtml(cat ? cat.name : '—')}</strong>
              <div style="font-size:11px;color:var(--text-muted)">${escHtml(cat ? sectionLabel(cat.pnlSection) : '')}</div></td>
          <td>${escHtml(contragentName(o.contragentId)) || '—'}</td>
          <td>${formatDate(o.dueDate)}</td>
          <td style="text-align:right;font-weight:600">${fmt(o.amount)}</td>
          <td style="text-align:right;color:var(--text-muted)">${fmt(o.paidAmount)}</td>
          <td><span class="badge ${STATUS_CLASS[o.status]}">${STATUS_LABEL[o.status]}</span></td>
          <td><div class="row-actions">
            ${remain > 0 ? `<button class="btn btn-sm btn-success buxgalter-only" onclick="openPaymentModal('${o.id}')">+ To'lov</button>` : ''}
            <button class="btn btn-sm btn-secondary buxgalter-only" onclick="openOperationModal('${o.id}')">✏️</button>
            <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteOperation('${o.id}')">🗑</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function categoryOptions(selectedId, typeFilter) {
  let cats = firmCategories();
  if (typeFilter) cats = cats.filter(c => c.type === typeFilter);
  if (!cats.length) return '<option value="">— Kategoriya yo\'q —</option>';
  return cats.map(c =>
    `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${escHtml(c.name)} · ${escHtml(sectionLabel(c.pnlSection))}</option>`
  ).join('');
}

function accountOptions(selectedId) {
  const accs = firmAccounts();
  if (!accs.length) return '<option value="">— Hisob yo\'q —</option>';
  return accs.map(a =>
    `<option value="${a.id}" ${selectedId === a.id ? 'selected' : ''}>${escHtml(a.name)}</option>`).join('');
}

function contragentOptions(selectedId) {
  return '<option value="">— Tanlanmagan —</option>' + firmContragents().map(c =>
    `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('');
}

function openOperationModal(editId) {
  if (!firmCategories().length) {
    toast('Avval kategoriya qo\'shing (Sozlamalar → Kategoriyalar)', 'warning', 5000); return;
  }
  const o = editId ? opById(editId) : null;
  openModal(o ? 'Operatsiyani tahrirlash' : 'Operatsiya qo\'shish', `
    <div class="field">
      <label>Kategoriya *</label>
      <select id="op_cat">${categoryOptions(o ? o.categoryId : null)}</select>
    </div>
    <div class="field-row">
      <div class="field"><label>Hisoblangan sana *</label>
        <input id="op_date" type="date" value="${o ? o.accrualDate : today()}"></div>
      <div class="field"><label>To'lov muddati</label>
        <input id="op_due" type="date" value="${o ? o.dueDate : ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Summa (so'm) *</label>
        <input id="op_amount" type="text" inputmode="numeric" oninput="formatAmountInput(this)"
               value="${o ? o.amount.toLocaleString('ru-RU') : ''}" placeholder="0"></div>
      <div class="field"><label>Kontragent</label>
        <select id="op_cont">${contragentOptions(o ? o.contragentId : null)}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Faktura raqami</label>
        <input id="op_number" value="${o ? escHtml(o.number) : ''}" placeholder="INV-001"></div>
      <div class="field"><label>Faktura sifatida</label>
        <select id="op_isinv">
          <option value="0" ${!o || !o.isInvoice ? 'selected' : ''}>Yo'q</option>
          <option value="1" ${o && o.isInvoice ? 'selected' : ''}>Ha</option>
        </select></div>
    </div>
    <div class="field"><label>Tavsif</label>
      <textarea id="op_desc" placeholder="Izoh...">${o ? escHtml(o.description) : ''}</textarea></div>
    <div class="field-hint">Bu — <b>hisoblangan</b> operatsiya (P/L shu sana bo'yicha oladi).
      Pul kelgach "+ To'lov" tugmasi orqali to'lov qo'shasiz.</div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveOperation('${editId || ''}', this)">Saqlash</button>`);
}

async function saveOperation(editId, btn) {
  const amount = parseAmountInput('op_amount');
  const categoryId = document.getElementById('op_cat').value;
  if (!categoryId) { toast('Kategoriya tanlang', 'warning'); return; }
  if (!amount || amount <= 0) { toast('To\'g\'ri summa kiriting', 'warning'); return; }

  const row = {
    category_id: categoryId,
    contragent_id: document.getElementById('op_cont').value || null,
    amount,
    accrual_date: document.getElementById('op_date').value,
    due_date: document.getElementById('op_due').value || null,
    is_invoice: document.getElementById('op_isinv').value === '1',
    number: document.getElementById('op_number').value.trim() || null,
    description: document.getElementById('op_desc').value.trim() || null
  };
  setBtnLoading(btn, true);
  try {
    const { error } = editId
      ? await sb.from('financial_operations').update(row).eq('id', editId)
      : await sb.from('financial_operations').insert({ firm_id: activeFirmId, created_by: currentUser.id, ...row });
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast(editId ? 'Operatsiya yangilandi' : 'Operatsiya qo\'shildi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

async function deleteOperation(id) {
  if (!(await confirmDialog('Operatsiya va unga bog\'liq barcha to\'lovlar o\'chiriladi. Davom etasizmi?'))) return;
  const { error } = await sb.from('financial_operations').delete().eq('id', id);
  if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
  toast('Operatsiya o\'chirildi', 'success');
  await refreshAndRender();
}

function openPaymentModal(opId) {
  const o = opById(opId);
  if (!o) return;
  const remain = o.amount - o.paidAmount;
  const cat = catById(o.categoryId);
  openModal('To\'lov qo\'shish', `
    <div class="field-hint" style="margin-bottom:12px">
      ${escHtml(cat ? cat.name : '')} · Jami: <b>${fmt(o.amount)}</b> ·
      To'langan: <b>${fmt(o.paidAmount)}</b> · Qoldiq: <b>${fmt(remain)}</b>
    </div>
    <div class="field-row">
      <div class="field"><label>Summa (so'm) *</label>
        <input id="pay_amount" type="text" inputmode="numeric" oninput="formatAmountInput(this)"
               value="${Math.round(remain).toLocaleString('ru-RU')}"></div>
      <div class="field"><label>Sana *</label>
        <input id="pay_date" type="date" value="${today()}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Hisob *</label><select id="pay_account">${accountOptions()}</select></div>
      <div class="field"><label>Usul</label><select id="pay_method">
        ${PAYMENT_METHODS.map(m => `<option value="${m}">${escHtml(accountTypeLabel(m))}</option>`).join('')}
      </select></div>
    </div>
    <div class="field"><label>Izoh</label><input id="pay_note" placeholder="Ixtiyoriy"></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="savePayment('${opId}', this)">Saqlash</button>`);
}

async function savePayment(opId, btn) {
  const amount = parseAmountInput('pay_amount');
  if (!amount || amount <= 0) { toast('To\'g\'ri summa kiriting', 'warning'); return; }
  const accountId = document.getElementById('pay_account').value;
  if (!accountId) { toast('Hisob tanlang (Sozlamalar → Hisoblar)', 'warning', 5000); return; }

  setBtnLoading(btn, true);
  try {
    const { error } = await sb.from('payments').insert({
      operation_id: opId,
      account_id: accountId,
      amount,
      payment_date: document.getElementById('pay_date').value,
      payment_method: document.getElementById('pay_method').value,
      note: document.getElementById('pay_note').value.trim() || null
    });
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast('To\'lov qo\'shildi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

// ══════════════════════════════════════════
// KASSA — to'lovlar ro'yxati + tezkor kirim/chiqim
// ══════════════════════════════════════════

function openQuickEntryModal() {
  if (!firmCategories().length) {
    toast('Avval kategoriya qo\'shing (Sozlamalar → Kategoriyalar)', 'warning', 5000); return;
  }
  if (!firmAccounts().length) {
    toast('Avval hisob qo\'shing (Sozlamalar → Hisoblar)', 'warning', 5000); return;
  }
  openModal('Tezkor kirim / chiqim', `
    <div class="field">
      <label>Turi *</label>
      <select id="qe_type" onchange="qeReloadCategories()">
        <option value="revenue">Kirim (daromad)</option>
        <option value="expense" selected>Chiqim (xarajat)</option>
      </select>
    </div>
    <div class="field">
      <label>Kategoriya *</label>
      <select id="qe_cat">${categoryOptions(null, 'expense')}</select>
    </div>
    <div class="field-row">
      <div class="field"><label>Summa (so'm) *</label>
        <input id="qe_amount" type="text" inputmode="numeric" oninput="formatAmountInput(this)" placeholder="0"></div>
      <div class="field"><label>Sana *</label>
        <input id="qe_date" type="date" value="${today()}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Hisob *</label><select id="qe_account">${accountOptions()}</select></div>
      <div class="field"><label>Kontragent</label><select id="qe_cont">${contragentOptions()}</select></div>
    </div>
    <div class="field"><label>Izoh</label><input id="qe_note" placeholder="Ixtiyoriy"></div>
    <div class="field-hint">Bu darhol to'langan operatsiya sifatida yoziladi
      (hisoblangan yozuv + to'lov bir vaqtda yaratiladi).</div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveQuickEntry(this)">Saqlash</button>`);
}

function qeReloadCategories() {
  const type = document.getElementById('qe_type').value;
  document.getElementById('qe_cat').innerHTML = categoryOptions(null, type);
}

async function saveQuickEntry(btn) {
  const amount = parseAmountInput('qe_amount');
  const categoryId = document.getElementById('qe_cat').value;
  const accountId = document.getElementById('qe_account').value;
  if (!categoryId) { toast('Kategoriya tanlang', 'warning'); return; }
  if (!amount || amount <= 0) { toast('To\'g\'ri summa kiriting', 'warning'); return; }
  if (!accountId) { toast('Hisob tanlang', 'warning'); return; }

  const date = document.getElementById('qe_date').value || today();
  const note = document.getElementById('qe_note').value.trim() || null;
  setBtnLoading(btn, true);
  try {
    const opId = crypto.randomUUID();
    const { error: opErr } = await sb.from('financial_operations').insert({
      id: opId, firm_id: activeFirmId, category_id: categoryId,
      contragent_id: document.getElementById('qe_cont').value || null,
      amount, accrual_date: date, description: note,
      created_by: currentUser.id
    });
    if (opErr) { toast('Xatolik: ' + opErr.message, 'error'); return; }

    const { error: payErr } = await sb.from('payments').insert({
      operation_id: opId, account_id: accountId, amount,
      payment_date: date, payment_method: 'naqd', note
    });
    if (payErr) { toast('Operatsiya yaratildi, lekin to\'lovda xatolik: ' + payErr.message, 'error', 6000); return; }

    closeModal();
    toast('Yozuv qo\'shildi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

function openTransferModal() {
  const accs = firmAccounts();
  if (accs.length < 2) { toast('Ko\'chirma uchun kamida 2 ta hisob kerak', 'warning'); return; }
  openModal('Hisoblar aro ko\'chirma', `
    <div class="field-row">
      <div class="field"><label>Qaysi hisobdan *</label><select id="tr_from">${accountOptions()}</select></div>
      <div class="field"><label>Qaysi hisobga *</label><select id="tr_to">${accountOptions()}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Summa (so'm) *</label>
        <input id="tr_amount" type="text" inputmode="numeric" oninput="formatAmountInput(this)" placeholder="0"></div>
      <div class="field"><label>Jo'natilgan sana *</label>
        <input id="tr_sent" type="date" value="${today()}"></div>
    </div>
    <div class="field"><label>Yetib borgan sana</label>
      <input id="tr_received" type="date">
      <div class="field-hint">Bo'sh qoldirsangiz — pul "yo'lda" hisoblanadi.</div></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveTransfer(this)">Saqlash</button>`);
}

async function saveTransfer(btn) {
  const from = document.getElementById('tr_from').value;
  const to = document.getElementById('tr_to').value;
  const amount = parseAmountInput('tr_amount');
  if (!from || !to) { toast('Hisoblarni tanlang', 'warning'); return; }
  if (from === to) { toast('Bir xil hisob tanlangan', 'warning'); return; }
  if (!amount || amount <= 0) { toast('To\'g\'ri summa kiriting', 'warning'); return; }

  const received = document.getElementById('tr_received').value || null;
  setBtnLoading(btn, true);
  try {
    const { error } = await sb.from('account_transfers').insert({
      firm_id: activeFirmId, from_account_id: from, to_account_id: to, amount,
      sent_date: document.getElementById('tr_sent').value,
      received_date: received,
      status: received ? 'completed' : 'in_transit'
    });
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast('Ko\'chirma saqlandi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

function renderKassa() {
  const accFilter = document.getElementById('kassaAccountFilter');
  if (accFilter) {
    const cur = accFilter.value;
    accFilter.innerHTML = '<option value="">Barcha hisoblar</option>' +
      firmAccounts(true).map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`).join('');
    accFilter.value = cur;
  }

  const q = (document.getElementById('kassaSearch')?.value || '').toLowerCase();
  const accF = document.getElementById('kassaAccountFilter')?.value || '';
  const monthF = document.getElementById('kassaMonthFilter')?.value || '';

  let list = firmPayments();
  if (accF) list = list.filter(p => p.accountId === accF);
  if (monthF) list = list.filter(p => monthOf(p.paymentDate) === monthF);
  if (q) list = list.filter(p => {
    const cat = paymentCategory(p);
    const op = opById(p.operationId);
    return (cat && cat.name.toLowerCase().includes(q)) ||
           (p.note || '').toLowerCase().includes(q) ||
           (op && contragentName(op.contragentId).toLowerCase().includes(q));
  });
  list.sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));

  const all = firmPayments();
  const totalIn = all.reduce((s, p) => s + Math.max(paymentSigned(p), 0), 0);
  const totalOut = all.reduce((s, p) => s + Math.max(-paymentSigned(p), 0), 0);
  const monthNow = currentMonth();
  const monthIn = all.filter(p => monthOf(p.paymentDate) === monthNow)
    .reduce((s, p) => s + Math.max(paymentSigned(p), 0), 0);

  document.getElementById('kassaCards').innerHTML = `
    <div class="stat-card accent"><div class="stat-icon accent">💰</div>
      <div class="stat-label">Jami pul mablag'lari</div><div class="stat-value">${fmt(totalCash())}</div></div>
    <div class="stat-card success"><div class="stat-icon success">↑</div>
      <div class="stat-label">Jami kirim</div><div class="stat-value">${fmt(totalIn)}</div></div>
    <div class="stat-card danger"><div class="stat-icon danger">↓</div>
      <div class="stat-label">Jami chiqim</div><div class="stat-value">${fmt(totalOut)}</div></div>
    <div class="stat-card warning"><div class="stat-icon warning">📅</div>
      <div class="stat-label">Shu oy kirim</div><div class="stat-value">${fmt(monthIn)}</div></div>`;

  const accs = firmAccounts(true);
  document.getElementById('accountBalancesWrap').innerHTML = accs.length ? `
    <div class="table-wrap" style="margin-bottom:16px"><table>
      <thead><tr><th>Hisob</th><th>Turi</th><th style="text-align:right">Joriy qoldiq</th></tr></thead>
      <tbody>
        ${accs.map(a => `<tr>
          <td><strong>${escHtml(a.name)}</strong></td>
          <td><span class="badge info">${escHtml(accountTypeLabel(a.accountType))}</span></td>
          <td style="text-align:right;font-weight:600">${fmtSign(accountBalance(a.id))}</td>
        </tr>`).join('')}
        ${inTransitTotal() ? `<tr><td colspan="2" style="color:var(--warning-light)">🚚 Yo'ldagi pul</td>
          <td style="text-align:right;font-weight:600">${fmt(inTransitTotal())}</td></tr>` : ''}
        <tr style="border-top:2px solid var(--border);background:var(--bg-3)">
          <td colspan="2"><strong>JAMI</strong></td>
          <td style="text-align:right"><strong>${fmt(totalCash())}</strong></td></tr>
      </tbody></table></div>` : '';

  const wrap = document.getElementById('kassaWrap');
  if (!list.length) {
    wrap.innerHTML = emptyState('💵', 'To\'lov topilmadi', '"Kirim / Chiqim" tugmasi orqali yozuv qo\'shing');
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Sana</th><th>Kategoriya</th><th>Kontragent</th><th>Hisob</th>
        <th style="text-align:right">Summa</th><th></th></tr></thead>
      <tbody>${list.map(p => {
        const cat = paymentCategory(p);
        const op = opById(p.operationId);
        const acc = accById(p.accountId);
        return `<tr>
          <td>${formatDate(p.paymentDate)}</td>
          <td><div class="tx-party"><div class="tx-av">${escHtml(avatarInitials(cat ? cat.name : '?'))}</div>
            <div class="tx-nm">${escHtml(cat ? cat.name : '—')}</div></div></td>
          <td>${escHtml(op ? contragentName(op.contragentId) : '') || '—'}</td>
          <td>${escHtml(acc ? acc.name : '—')}</td>
          <td style="text-align:right">${fmtSign(paymentSigned(p))}</td>
          <td><div class="row-actions">
            <button class="btn btn-sm btn-danger buxgalter-only" onclick="deletePayment('${p.id}')">🗑</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

async function deletePayment(id) {
  if (!(await confirmDialog('Ushbu to\'lovni o\'chirasizmi?'))) return;
  const { error } = await sb.from('payments').delete().eq('id', id);
  if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
  toast('To\'lov o\'chirildi', 'success');
  await refreshAndRender();
}

function exportKassaCSV() {
  const list = firmPayments().sort((a, b) => (a.paymentDate || '').localeCompare(b.paymentDate || ''));
  if (!list.length) { toast('Eksport uchun ma\'lumot yo\'q', 'warning'); return; }
  const rows = [['Sana', 'Kategoriya', 'P/L bo\'limi', 'Kontragent', 'Hisob', 'Usul', 'Summa', 'Izoh']];
  list.forEach(p => {
    const cat = paymentCategory(p);
    const op = opById(p.operationId);
    rows.push([
      p.paymentDate, cat ? cat.name : '', cat ? sectionLabel(cat.pnlSection) : '',
      op ? contragentName(op.contragentId) : '', (accById(p.accountId) || {}).name || '',
      p.paymentMethod, paymentSigned(p), p.note
    ]);
  });
  downloadCSV(rows, `kassa_${today()}.csv`);
  toast('CSV yuklab olindi', 'success');
}

// ══════════════════════════════════════════
// DEBITOR / KREDITOR
// ══════════════════════════════════════════

function renderDebitor() {
  const open = firmOperations().filter(o => o.status !== 'paid');
  const debitor = open.filter(o => (catById(o.categoryId) || {}).type === 'revenue');
  const kreditor = open.filter(o => (catById(o.categoryId) || {}).type === 'expense');

  const sumRemain = arr => arr.reduce((s, o) => s + (o.amount - o.paidAmount), 0);
  const totalDeb = sumRemain(debitor);
  const totalKred = sumRemain(kreditor);

  document.getElementById('debitorCards').innerHTML = `
    <div class="stat-card warning"><div class="stat-icon warning">📥</div>
      <div class="stat-label">Debitor (bizga qarz)</div><div class="stat-value">${fmt(totalDeb)}</div></div>
    <div class="stat-card danger"><div class="stat-icon danger">📤</div>
      <div class="stat-label">Kreditor (biz qarzdormiz)</div><div class="stat-value">${fmt(totalKred)}</div></div>
    <div class="stat-card ${totalDeb - totalKred >= 0 ? 'success' : 'danger'}">
      <div class="stat-icon ${totalDeb - totalKred >= 0 ? 'success' : 'danger'}">⚖️</div>
      <div class="stat-label">Sof pozitsiya</div><div class="stat-value">${fmtSign(totalDeb - totalKred)}</div></div>`;

  const table = (title, arr) => {
    if (!arr.length) return `<div class="chart-card" style="margin-bottom:16px">
      <div class="chart-card-header"><h3>${title}</h3></div>
      <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Yozuv yo'q</div></div>`;
    return `<div class="chart-card" style="margin-bottom:16px;padding:0;overflow:hidden">
      <div style="padding:14px 20px;background:var(--bg-3)"><strong style="font-size:14px">${title}</strong></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Kontragent</th><th>Kategoriya</th><th>Muddat</th>
          <th style="text-align:right">Summa</th><th style="text-align:right">Qoldiq</th><th>Holat</th></tr></thead>
        <tbody>${arr.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).map(o => {
          const days = daysUntil(o.dueDate);
          const overdue = o.dueDate && days !== null && days < 0;
          return `<tr>
            <td><strong>${escHtml(contragentName(o.contragentId)) || '—'}</strong></td>
            <td>${escHtml((catById(o.categoryId) || {}).name || '—')}</td>
            <td style="${overdue ? 'color:var(--danger-light)' : ''}">${formatDate(o.dueDate)}
              ${overdue ? `<div style="font-size:11px">${Math.abs(days)} kun o'tdi</div>` : ''}</td>
            <td style="text-align:right">${fmt(o.amount)}</td>
            <td style="text-align:right;font-weight:600">${fmt(o.amount - o.paidAmount)}</td>
            <td><span class="badge ${overdue ? 'danger' : STATUS_CLASS[o.status]}">
              ${overdue ? 'Muddati o\'tgan' : STATUS_LABEL[o.status]}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div></div>`;
  };

  document.getElementById('debitorWrap').innerHTML =
    table('📥 Debitor — mijozlar bizga qarzdor', debitor) +
    table('📤 Kreditor — biz to\'lashimiz kerak', kreditor);
}

// ══════════════════════════════════════════
// P&L  (kategoriyalardan avtomat)
// ══════════════════════════════════════════

function plRange() {
  return {
    from: document.getElementById('plMonthFrom')?.value || '',
    to: document.getElementById('plMonthTo')?.value || ''
  };
}
function resetPLRange() {
  const f = document.getElementById('plMonthFrom'), t = document.getElementById('plMonthTo');
  if (f) f.value = ''; if (t) t.value = '';
  renderPL();
}
function plPeriodLabel(from, to) {
  if (from && to) return `${monthLabel(from)} — ${monthLabel(to)}`;
  if (from) return `${monthLabel(from)} dan`;
  if (to) return `${monthLabel(to)} gacha`;
  return 'Barcha davr';
}

function monthsElapsed(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const [fy, fm] = String(fromDate).slice(0, 7).split('-').map(Number);
  const [ty, tm] = String(toDate).slice(0, 7).split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function depreciationForRange(from, to) {
  const assets = state.assets.filter(a => a.firmId === activeFirmId);
  if (!assets.length) return 0;
  if (!from || !to) {
    return assets.reduce((s, a) => {
      const monthly = a.purchaseValue / a.usefulLifeMonths;
      const elapsed = monthsElapsed(a.purchaseDate, today());
      return s + monthly * Math.min(a.usefulLifeMonths, Math.max(0, elapsed));
    }, 0);
  }
  const months = monthsBetween(from, to);
  return assets.reduce((s, a) => {
    const monthly = a.purchaseValue / a.usefulLifeMonths;
    const active = months.filter(m => {
      const elapsed = monthsElapsed(a.purchaseDate, m + '-01');
      return elapsed >= 0 && elapsed < a.usefulLifeMonths;
    }).length;
    return s + monthly * active;
  }, 0);
}

function computePL(from, to) {
  let ops = firmOperations();
  if (from) ops = ops.filter(o => monthOf(o.accrualDate) >= from);
  if (to) ops = ops.filter(o => monthOf(o.accrualDate) <= to);

  const bySection = { revenue: 0, cogs: 0, opex: 0, tax: 0, interest: 0 };
  const lines = {};

  ops.forEach(o => {
    const c = catById(o.categoryId);
    if (!c) return;
    const signed = c.type === 'revenue' ? o.amount : -o.amount;
    if (c.pnlSection === 'revenue') bySection.revenue += signed;
    else bySection[c.pnlSection] += o.amount;

    if (!lines[c.pnlSection]) lines[c.pnlSection] = {};
    lines[c.pnlSection][c.name] = (lines[c.pnlSection][c.name] || 0) +
      (c.pnlSection === 'revenue' ? signed : o.amount);
  });

  const revenue = bySection.revenue;
  const cogs = bySection.cogs;
  const grossProfit = revenue - cogs;
  const opex = bySection.opex;
  const ebitda = grossProfit - opex;
  const depreciation = depreciationForRange(from, to);
  const ebit = ebitda - depreciation;
  const interest = bySection.interest;
  const ebt = ebit - interest;
  const tax = bySection.tax;
  const netProfit = ebt - tax;

  return { ops, lines, revenue, cogs, grossProfit, opex, ebitda, depreciation, ebit, interest, ebt, tax, netProfit };
}

function renderPL() {
  const { from, to } = plRange();
  const p = computePL(from, to);

  if (!p.ops.length) {
    document.getElementById('plCards').innerHTML = '';
    document.getElementById('plWrap').innerHTML = emptyState('📑', 'Ma\'lumot yo\'q',
      'Tanlangan davr uchun operatsiya topilmadi');
    return;
  }

  const margin = v => p.revenue > 0 ? (v / p.revenue * 100).toFixed(1) + '%' : '—';

  document.getElementById('plCards').innerHTML = `
    <div class="stat-card success"><div class="stat-icon success">💰</div>
      <div class="stat-label">Jami daromad</div><div class="stat-value">${fmt(p.revenue)}</div></div>
    <div class="stat-card ${p.grossProfit >= 0 ? 'success' : 'danger'}">
      <div class="stat-icon ${p.grossProfit >= 0 ? 'success' : 'danger'}">📊</div>
      <div class="stat-label">Yalpi foyda</div><div class="stat-value">${fmt(p.grossProfit)}</div>
      <div class="stat-change ${p.grossProfit >= 0 ? 'up' : 'down'}">${margin(p.grossProfit)} marja</div></div>
    <div class="stat-card ${p.ebitda >= 0 ? 'success' : 'danger'}">
      <div class="stat-icon ${p.ebitda >= 0 ? 'success' : 'danger'}">📈</div>
      <div class="stat-label">EBITDA</div><div class="stat-value">${fmt(p.ebitda)}</div>
      <div class="stat-change ${p.ebitda >= 0 ? 'up' : 'down'}">${margin(p.ebitda)} marja</div></div>
    <div class="stat-card warning"><div class="stat-icon warning">🧾</div>
      <div class="stat-label">Soliqlar</div><div class="stat-value">${fmt(p.tax)}</div></div>
    <div class="stat-card ${p.netProfit >= 0 ? 'success' : 'danger'}">
      <div class="stat-icon ${p.netProfit >= 0 ? 'success' : 'danger'}">${p.netProfit >= 0 ? '🏆' : '📉'}</div>
      <div class="stat-label">Sof foyda / zarar</div><div class="stat-value">${fmt(p.netProfit)}</div>
      <div class="stat-change ${p.netProfit >= 0 ? 'up' : 'down'}">${margin(p.netProfit)} marja</div></div>`;

  const pct = n => p.revenue > 0 ? (Math.abs(n) / p.revenue * 100).toFixed(1) + '%' : '—';
  const sectionRow = label => `<tr style="background:var(--bg-3)">
    <td colspan="3" style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;padding:12px 16px 8px">${escHtml(label)}</td></tr>`;
  const catRows = section => {
    const obj = p.lines[section] || {};
    const entries = Object.entries(obj).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (!entries.length) return `<tr><td colspan="3" style="color:var(--text-muted);padding-left:28px">—</td></tr>`;
    return entries.map(([name, amt]) => `<tr>
      <td style="padding-left:28px">${escHtml(name)}</td>
      <td style="text-align:right" class="${section === 'revenue' ? (amt >= 0 ? 'amount-positive' : 'amount-negative') : 'amount-negative'}">
        ${section === 'revenue' ? (amt >= 0 ? '+' : '−') : '−'}${fmt(amt)}</td>
      <td style="text-align:right;color:var(--text-muted)">${pct(amt)}</td></tr>`).join('');
  };
  const totalRow = (label, amount, strong) => `<tr style="border-top:1px solid var(--border)${strong ? ';background:var(--bg-3)' : ''}">
    <td><strong>${escHtml(label)}</strong></td>
    <td style="text-align:right"><strong>${fmtSign(amount)}</strong></td>
    <td style="text-align:right"><strong>${pct(amount)}</strong></td></tr>`;

  document.getElementById('plWrap').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Ko'rsatkich</th><th style="text-align:right">Summa</th><th style="text-align:right">Daromaddan</th></tr></thead>
      <tbody>
        ${sectionRow('Daromadlar')}
        ${catRows('revenue')}
        ${totalRow('Jami daromad', p.revenue)}

        ${sectionRow('Tannarx (COGS)')}
        ${catRows('cogs')}
        ${totalRow('Yalpi foyda', p.grossProfit, true)}

        ${sectionRow('Operatsion xarajatlar (OPEX)')}
        ${catRows('opex')}
        ${totalRow('EBITDA', p.ebitda, true)}

        ${sectionRow('Amortizatsiya')}
        <tr><td style="padding-left:28px">Asosiy vositalar amortizatsiyasi</td>
          <td style="text-align:right" class="amount-negative">−${fmt(p.depreciation)}</td>
          <td style="text-align:right;color:var(--text-muted)">${pct(p.depreciation)}</td></tr>
        ${totalRow('EBIT (operativ foyda)', p.ebit, true)}

        ${sectionRow('Foiz xarajatlari')}
        ${catRows('interest')}
        ${totalRow('EBT (soliqqacha foyda)', p.ebt, true)}

        ${sectionRow('Soliqlar')}
        ${catRows('tax')}

        <tr style="border-top:2px solid var(--accent);background:var(--accent-bg)">
          <td style="font-size:14px"><strong>SOF FOYDA / ZARAR</strong></td>
          <td style="text-align:right;font-size:14px"><strong>${fmtSign(p.netProfit)}</strong></td>
          <td style="text-align:right;font-size:14px"><strong>${pct(p.netProfit)}</strong></td></tr>
      </tbody></table></div>`;
}

function exportPLCSV() {
  const { from, to } = plRange();
  const p = computePL(from, to);
  if (!p.ops.length) { toast('Eksport uchun ma\'lumot yo\'q', 'warning'); return; }
  const rows = [['P&L Hisobot'], ['Davr', plPeriodLabel(from, to)], [], ['Ko\'rsatkich', 'Summa (so\'m)']];
  const push = (label, val) => rows.push([label, Math.round(val)]);
  const section = (label, key, sign) => {
    rows.push([label.toUpperCase(), '']);
    Object.entries(p.lines[key] || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .forEach(([n, v]) => rows.push(['  ' + n, Math.round(sign * v)]));
  };
  section('Daromadlar', 'revenue', 1); push('Jami daromad', p.revenue);
  section('Tannarx', 'cogs', -1); push('Yalpi foyda', p.grossProfit);
  section('Operatsion xarajatlar', 'opex', -1); push('EBITDA', p.ebitda);
  push('Amortizatsiya', -p.depreciation); push('EBIT', p.ebit);
  section('Foiz xarajatlari', 'interest', -1); push('EBT', p.ebt);
  section('Soliqlar', 'tax', -1); push('SOF FOYDA / ZARAR', p.netProfit);
  downloadCSV(rows, `pl_hisobot_${today()}.csv`);
  toast('P&L CSV yuklab olindi', 'success');
}

function printPL() {
  const { from, to } = plRange();
  const p = computePL(from, to);
  if (!p.ops.length) { toast('Chop etish uchun ma\'lumot yo\'q', 'warning'); return; }
  const firm = state.firms.find(f => f.id === activeFirmId) || {};
  const money = n => (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ru-RU') + ' so\'m';
  const row = (label, val, strong, indent) => `<tr${strong ? ' style="font-weight:700;background:#F5F6F8"' : ''}>
    <td style="padding:9px 12px;${indent ? 'padding-left:30px;' : ''}">${escHtml(label)}</td>
    <td style="padding:9px 12px;text-align:right">${money(val)}</td></tr>`;
  const sec = (label, key, sign) => `<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF;font-weight:600">${escHtml(label)}</td></tr>` +
    Object.entries(p.lines[key] || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([n, v]) => row(n, sign * v, false, true)).join('');

  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:760px;margin:0 auto;padding:40px;color:#1A1D29">
    <div style="display:flex;justify-content:space-between;border-bottom:2px solid #E5E7EB;padding-bottom:20px;margin-bottom:24px">
      <div><h1 style="font-size:24px;font-weight:800;color:#0C5A52;margin:0 0 4px">FOYDA VA ZARAR HISOBOTI</h1>
        <div style="font-size:13px;color:#6B7280">Davr: ${escHtml(plPeriodLabel(from, to))}</div></div>
      <div style="text-align:right"><div style="font-size:16px;font-weight:700">${escHtml(firm.name || '')}</div>
        <div style="font-size:12px;color:#6B7280">STIR: ${escHtml(firm.stir || '—')}</div></div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13.5px">
      ${sec('Daromadlar', 'revenue', 1)}${row('Jami daromad', p.revenue, true)}
      ${sec('Tannarx (COGS)', 'cogs', -1)}${row('Yalpi foyda', p.grossProfit, true)}
      ${sec('Operatsion xarajatlar', 'opex', -1)}${row('EBITDA', p.ebitda, true)}
      ${row('Amortizatsiya', -p.depreciation, false, true)}${row('EBIT', p.ebit, true)}
      ${sec('Foiz xarajatlari', 'interest', -1)}${row('EBT', p.ebt, true)}
      ${sec('Soliqlar', 'tax', -1)}
      <tr style="border-top:2px solid #1A1D29;background:#F5F6F8">
        <td style="padding:14px 12px;font-weight:800;font-size:15px">SOF FOYDA / ZARAR</td>
        <td style="padding:14px 12px;text-align:right;font-weight:800;font-size:16px;color:${p.netProfit >= 0 ? '#24D07A' : '#DC2626'}">${money(p.netProfit)}</td></tr>
    </table>
    <div style="margin-top:24px;font-size:11px;color:#9CA3AF;text-align:center">
      RaqamX · ${formatDate(today())} · Hisoblangan (accrual) asosidagi hisobot</div>
  </div>`;

  const win = window.open('', '_blank');
  if (!win) { toast('Chop oynasi bloklandi', 'warning'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>P&L</title></head><body>${html}</body></html>`);
  win.document.close(); win.focus(); win.print();
}

// ══════════════════════════════════════════
// CASH FLOW
// ══════════════════════════════════════════

function cashflowRange() {
  return {
    from: document.getElementById('cfMonthFrom')?.value || '',
    to: document.getElementById('cfMonthTo')?.value || ''
  };
}
function resetCashflowRange() {
  const f = document.getElementById('cfMonthFrom'), t = document.getElementById('cfMonthTo');
  if (f) f.value = ''; if (t) t.value = '';
  renderCashflow();
}

function computeCashflow(from, to) {
  let pays = firmPayments();
  if (from) pays = pays.filter(p => monthOf(p.paymentDate) >= from);
  if (to) pays = pays.filter(p => monthOf(p.paymentDate) <= to);

  const months = {};
  const byActivity = { operating: 0, investing: 0, financing: 0 };
  const byCategory = {};

  pays.forEach(p => {
    const cat = paymentCategory(p);
    if (!cat) return;
    const m = monthOf(p.paymentDate);
    const signed = paymentSigned(p);
    if (!months[m]) months[m] = { operating: 0, investing: 0, financing: 0, in: 0, out: 0 };
    months[m][cat.cfActivity] += signed;
    if (signed > 0) months[m].in += signed; else months[m].out += -signed;
    byActivity[cat.cfActivity] += signed;
    byCategory[cat.name] = (byCategory[cat.name] || 0) + signed;
  });

  return { pays, months, sorted: Object.keys(months).sort(), byActivity, byCategory };
}

function renderCashflow() {
  const { from, to } = cashflowRange();
  const cf = computeCashflow(from, to);
  const cardsEl = document.getElementById('cashflowCards');

  if (!cf.pays.length) {
    cardsEl.innerHTML = '';
    if (cashflowDetailChartInstance) { cashflowDetailChartInstance.destroy(); cashflowDetailChartInstance = null; }
    document.getElementById('cashflowWrap').innerHTML = emptyState('📈', 'Ma\'lumot yo\'q',
      (from || to) ? 'Tanlangan davr uchun to\'lov topilmadi' : 'Kassa bo\'limidan yozuv qo\'shing');
    document.getElementById('cashflowAccountsWrap').innerHTML = '';
    return;
  }

  const totalIn = cf.sorted.reduce((s, m) => s + cf.months[m].in, 0);
  const totalOut = cf.sorted.reduce((s, m) => s + cf.months[m].out, 0);
  const net = totalIn - totalOut;

  cardsEl.innerHTML = `
    <div class="stat-card success"><div class="stat-icon success">↑</div>
      <div class="stat-label">Jami kirim</div><div class="stat-value">${fmt(totalIn)}</div></div>
    <div class="stat-card danger"><div class="stat-icon danger">↓</div>
      <div class="stat-label">Jami chiqim</div><div class="stat-value">${fmt(totalOut)}</div></div>
    <div class="stat-card ${net >= 0 ? 'success' : 'danger'}">
      <div class="stat-icon ${net >= 0 ? 'success' : 'danger'}">${net >= 0 ? '📈' : '📉'}</div>
      <div class="stat-label">Sof pul oqimi</div><div class="stat-value">${fmtSign(net)}</div></div>
    <div class="stat-card accent"><div class="stat-icon accent">💰</div>
      <div class="stat-label">Joriy kassa qoldig'i</div><div class="stat-value">${fmt(totalCash())}</div></div>`;

  const ctx = document.getElementById('cashflowDetailChart');
  if (ctx) {
    if (cashflowDetailChartInstance) cashflowDetailChartInstance.destroy();
    const tc = chartColors();
    cashflowDetailChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: cf.sorted.map(monthLabel),
        datasets: [
          { label: 'Kirim', data: cf.sorted.map(m => cf.months[m].in / 1e6),
            borderColor: '#24D07A', backgroundColor: 'rgba(36,208,122,0.10)', fill: true, tension: .4, pointRadius: 4 },
          { label: 'Chiqim', data: cf.sorted.map(m => cf.months[m].out / 1e6),
            borderColor: '#E5636C', backgroundColor: 'rgba(229,99,108,0.10)', fill: true, tension: .4, pointRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tc.legend, usePointStyle: true, pointStyle: 'circle', font: { family: 'Space Grotesk', size: 12 } } } },
        scales: {
          x: { ticks: { color: tc.tick, font: { family: 'Space Grotesk' } }, grid: { color: tc.grid } },
          y: { ticks: { color: tc.tick, font: { family: 'Space Grotesk' }, callback: v => v + ' mln' }, grid: { color: tc.grid } }
        }
      }
    });
  }

  document.getElementById('cashflowWrap').innerHTML = `
    <div class="table-wrap" style="margin-bottom:16px"><table>
      <thead><tr><th>Faoliyat turi</th><th style="text-align:right">Sof oqim</th></tr></thead>
      <tbody>
        ${CF_ACTIVITIES.map(a => `<tr>
          <td><strong>${escHtml(a.label)}</strong></td>
          <td style="text-align:right;font-weight:600">${fmtSign(cf.byActivity[a.key])}</td></tr>`).join('')}
        <tr style="border-top:2px solid var(--border);background:var(--bg-3)">
          <td><strong>JAMI SOF PUL OQIMI</strong></td>
          <td style="text-align:right"><strong>${fmtSign(net)}</strong></td></tr>
      </tbody></table></div>

    <div class="table-wrap"><table>
      <thead><tr><th>Oy</th><th style="text-align:right">Kirim</th><th style="text-align:right">Chiqim</th>
        <th style="text-align:right">Sof oqim</th><th style="text-align:right">Jamg'arma</th></tr></thead>
      <tbody>${(() => {
        let cum = 0;
        return cf.sorted.map(m => {
          const n = cf.months[m].in - cf.months[m].out;
          cum += n;
          return `<tr>
            <td><strong>${monthLabel(m)}</strong></td>
            <td style="text-align:right" class="amount-positive">+${fmt(cf.months[m].in)}</td>
            <td style="text-align:right" class="amount-negative">−${fmt(cf.months[m].out)}</td>
            <td style="text-align:right">${fmtSign(n)}</td>
            <td style="text-align:right;font-weight:600">${fmt(cum)}</td></tr>`;
        }).join('');
      })()}</tbody></table></div>`;

  const accs = firmAccounts(true);
  document.getElementById('cashflowAccountsWrap').innerHTML = accs.length ? `
    <div class="chart-card" style="margin-top:16px;padding:0;overflow:hidden">
      <div style="padding:14px 20px;background:var(--bg-3)"><strong style="font-size:14px">Hisoblar kesimida qoldiq</strong></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Hisob</th><th>Turi</th><th style="text-align:right">Joriy qoldiq</th></tr></thead>
        <tbody>
          ${accs.map(a => `<tr>
            <td><strong>${escHtml(a.name)}</strong></td>
            <td><span class="badge info">${escHtml(accountTypeLabel(a.accountType))}</span></td>
            <td style="text-align:right;font-weight:600">${fmtSign(accountBalance(a.id))}</td></tr>`).join('')}
          ${inTransitTotal() ? `<tr><td colspan="2">🚚 Yo'ldagi pul</td>
            <td style="text-align:right;font-weight:600">${fmt(inTransitTotal())}</td></tr>` : ''}
          <tr style="border-top:2px solid var(--border);background:var(--bg-3)">
            <td colspan="2"><strong>TEKSHIRUV — jami kassa</strong></td>
            <td style="text-align:right"><strong>${fmt(totalCash())}</strong></td></tr>
        </tbody></table></div></div>` : '';
}

function exportCashflowCSV() {
  const { from, to } = cashflowRange();
  const cf = computeCashflow(from, to);
  if (!cf.pays.length) { toast('Eksport uchun ma\'lumot yo\'q', 'warning'); return; }
  const rows = [['Cash Flow'], ['Davr', plPeriodLabel(from, to)], [],
    ['Oy', 'Kirim', 'Chiqim', 'Sof oqim', 'Jamg\'arma']];
  let cum = 0;
  cf.sorted.forEach(m => {
    const n = cf.months[m].in - cf.months[m].out; cum += n;
    rows.push([monthLabel(m), Math.round(cf.months[m].in), Math.round(cf.months[m].out), Math.round(n), Math.round(cum)]);
  });
  rows.push([]);
  rows.push(['Faoliyat turi', 'Sof oqim']);
  CF_ACTIVITIES.forEach(a => rows.push([a.label, Math.round(cf.byActivity[a.key])]));
  downloadCSV(rows, `cashflow_${today()}.csv`);
  toast('Cash Flow CSV yuklab olindi', 'success');
}

// ══════════════════════════════════════════
// BALANS (RPC)
// ══════════════════════════════════════════

async function renderBalans() {
  const dateEl = document.getElementById('balansDate');
  if (dateEl && !dateEl.value) dateEl.value = today();
  const asOf = dateEl ? dateEl.value : today();
  const wrap = document.getElementById('balansWrap');
  wrap.innerHTML = skeletonGrid(4) + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div>${skeletonRows(6)}</div><div>${skeletonRows(6)}</div></div>`;

  const { data, error } = await sb.rpc('firm_balance_sheet', { f: activeFirmId, as_of: asOf });
  if (error) {
    wrap.innerHTML = emptyState('⚠️', 'Balansni hisoblab bo\'lmadi', error.message);
    return;
  }
  const b = data;
  const line = (label, val, indent) => `<tr>
    <td style="${indent ? 'padding-left:28px;' : ''}">${escHtml(label)}</td>
    <td style="text-align:right">${fmt(val)}</td></tr>`;
  const total = (label, val) => `<tr style="border-top:1px solid var(--border);background:var(--bg-3)">
    <td><strong>${escHtml(label)}</strong></td>
    <td style="text-align:right"><strong>${fmt(val)}</strong></td></tr>`;

  const check = Number(b.balance_check) || 0;
  const ok = Math.abs(check) < 1;

  wrap.innerHTML = `
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card accent"><div class="stat-icon accent">📦</div>
        <div class="stat-label">Jami aktivlar</div><div class="stat-value">${fmt(b.assets.total)}</div></div>
      <div class="stat-card warning"><div class="stat-icon warning">📉</div>
        <div class="stat-label">Jami majburiyatlar</div><div class="stat-value">${fmt(b.liabilities.total)}</div></div>
      <div class="stat-card success"><div class="stat-icon success">🏛️</div>
        <div class="stat-label">Jami kapital</div><div class="stat-value">${fmt(b.equity.total)}</div></div>
      <div class="stat-card ${ok ? 'success' : 'danger'}">
        <div class="stat-icon ${ok ? 'success' : 'danger'}">${ok ? '✓' : '⚠️'}</div>
        <div class="stat-label">Balans tekshiruvi</div>
        <div class="stat-value" style="font-size:16px">${ok ? 'To\'g\'ri' : 'Farq: ' + fmt(check)}</div></div>
    </div>

    <div class="dashboard-grid" style="grid-template-columns:1fr 1fr">
      <div class="chart-card" style="padding:0;overflow:hidden">
        <div style="padding:14px 20px;background:var(--bg-3)"><strong style="font-size:14px">AKTIVLAR</strong></div>
        <div class="table-wrap"><table><tbody>
          ${line('Pul mablag\'lari', b.assets.cash, true)}
          ${line('Yo\'ldagi pul', b.assets.in_transit, true)}
          ${line('Debitorlik qarzi', b.assets.receivables, true)}
          ${line('Berilgan qarzlar', b.assets.loan_receivable, true)}
          ${line('Asosiy vositalar (net)', b.assets.fixed_assets_net, true)}
          ${total('JAMI AKTIVLAR', b.assets.total)}
        </tbody></table></div>
      </div>
      <div class="chart-card" style="padding:0;overflow:hidden">
        <div style="padding:14px 20px;background:var(--bg-3)"><strong style="font-size:14px">MAJBURIYAT VA KAPITAL</strong></div>
        <div class="table-wrap"><table><tbody>
          ${line('Kreditorlik qarzi', b.liabilities.payables, true)}
          ${line('To\'lanmagan soliqlar', b.liabilities.tax_payable, true)}
          ${line('Olingan qarzlar', b.liabilities.loan_payable, true)}
          ${line('Kredit qoldig\'i', b.liabilities.credit_payable, true)}
          ${total('Jami majburiyatlar', b.liabilities.total)}
          ${line('Ustav kapitali', b.equity.paid_in_capital, true)}
          ${line('Taqsimlanmagan foyda', b.equity.retained_earnings, true)}
          ${total('Jami kapital', b.equity.total)}
          ${total('JAMI MAJBURIYAT + KAPITAL', b.liabilities.total + b.equity.total)}
        </tbody></table></div>
      </div>
    </div>

    <div style="margin-top:16px;padding:12px 16px;background:${ok ? 'var(--success-bg)' : 'var(--danger-bg)'};
      border-radius:var(--radius-md);font-size:12.5px;color:${ok ? 'var(--success-light)' : 'var(--danger-light)'}">
      ${ok ? '✓ Balans tenglamasi to\'g\'ri: Aktivlar = Majburiyatlar + Kapital'
           : '⚠️ Balans yopilmadi. Farq: ' + fmt(check) + '. Biror to\'lov hisobga bog\'lanmagan yoki yozuv to\'liq emas bo\'lishi mumkin.'}
    </div>`;
  setTimeout(() => animateCounts(wrap), 20);
}

// ══════════════════════════════════════════
// SOLIQLAR
// ══════════════════════════════════════════

function renderSoliqlar() {
  const taxCats = firmCategories().filter(c => c.pnlSection === 'tax');
  const wrap = document.getElementById('soliqlarWrap');
  if (!taxCats.length) {
    wrap.innerHTML = emptyState('🧾', 'Soliq kategoriyasi yo\'q',
      'Sozlamalar → Kategoriyalar bo\'limida P/L bo\'limi "Soliqlar" bo\'lgan tur qo\'shing');
    return;
  }
  const ops = firmOperations();
  const rows = taxCats.map(c => {
    const list = ops.filter(o => o.categoryId === c.id);
    const accrued = list.reduce((s, o) => s + o.amount, 0);
    const paid = list.reduce((s, o) => s + o.paidAmount, 0);
    return { c, accrued, paid, remain: accrued - paid };
  });
  const totalRemain = rows.reduce((s, r) => s + r.remain, 0);

  wrap.innerHTML = `
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card warning"><div class="stat-icon warning">🧾</div>
        <div class="stat-label">Hisoblangan soliqlar</div>
        <div class="stat-value">${fmt(rows.reduce((s, r) => s + r.accrued, 0))}</div></div>
      <div class="stat-card success"><div class="stat-icon success">✓</div>
        <div class="stat-label">To'langan</div>
        <div class="stat-value">${fmt(rows.reduce((s, r) => s + r.paid, 0))}</div></div>
      <div class="stat-card danger"><div class="stat-icon danger">!</div>
        <div class="stat-label">To'lanmagan qoldiq</div><div class="stat-value">${fmt(totalRemain)}</div></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Soliq turi</th><th style="text-align:right">Hisoblangan</th>
        <th style="text-align:right">To'langan</th><th style="text-align:right">Qoldiq</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td><strong>${escHtml(r.c.name)}</strong></td>
        <td style="text-align:right">${fmt(r.accrued)}</td>
        <td style="text-align:right;color:var(--success-light)">${fmt(r.paid)}</td>
        <td style="text-align:right;font-weight:600;${r.remain > 0 ? 'color:var(--danger-light)' : ''}">${fmt(r.remain)}</td>
      </tr>`).join('')}</tbody></table></div>
    <div style="margin-top:12px;padding:12px 16px;background:var(--warning-bg);border-radius:var(--radius-md);font-size:12.5px;color:var(--warning-light)">
      ⚠️ Bu yerdagi summalar siz kiritgan operatsiyalarga asoslanadi. Rasmiy hisob-kitob uchun buxgalter maslahati tavsiya etiladi.
    </div>`;
}

// ══════════════════════════════════════════
// HISOBOT MUDDATLARI (qaysi hisobotni qachon topshirish kerak)
// ══════════════════════════════════════════

function firmReports() { return state.reports.filter(r => r.firmId === activeFirmId); }

// Firma tanlagan hisobot turlari bo'yicha kelgusi muddatlarni avtomat yaratadi
async function ensureUpcomingReports() {
  if (!canEdit()) return;
  const firm = state.firms.find(f => f.id === activeFirmId);
  const keys = (firm && firm.reportKeys) || [];
  if (!keys.length) return;
  const existing = firmReports();
  const now = new Date();
  const dueDate = (freq, offset) => {
    if (freq === 'Oylik') return new Date(now.getFullYear(), now.getMonth() + offset, 20).toISOString().slice(0, 10);
    if (freq === 'Choraklik') { const q = Math.floor(now.getMonth() / 3); return new Date(now.getFullYear(), q * 3 + 3 + offset * 3, 20).toISOString().slice(0, 10); }
    return new Date(now.getFullYear() + offset, 1, 20).toISOString().slice(0, 10);
  };
  const toInsert = [];
  keys.forEach(key => {
    const cat = REPORT_CATALOG.find(r => r.key === key);
    if (!cat) return;
    const offsets = cat.freq === 'Oylik' ? [0, 1, 2] : cat.freq === 'Choraklik' ? [0, 1] : [0];
    offsets.forEach(offset => {
      const due = dueDate(cat.freq, offset);
      const already = existing.some(r => r.type === cat.label && r.dueDate === due) ||
        toInsert.some(r => r.type === cat.label && r.due_date === due);
      if (!already) toInsert.push({ firm_id: activeFirmId, type: cat.label, due_date: due, status: 'Kutilmoqda' });
    });
  });
  if (toInsert.length) { await sb.from('reports').insert(toInsert); await refreshAndRender(); }
}

// Hisobotning hisoblangan holati: done / overdue / pending
function reportState(r, todayStr) {
  if (r.status === 'Topshirilgan') return 'done';
  if (r.dueDate && r.dueDate < todayStr) return 'overdue';
  return 'pending';
}

function resetReportFilters() {
  const s = document.getElementById('repSearch');
  const m = document.getElementById('repMonthFilter');
  const st = document.getElementById('repStatusFilter');
  if (s) s.value = ''; if (m) m.value = ''; if (st) st.value = '';
  renderReports();
}

function renderReports() {
  const todayStr = today();
  const all = firmReports();

  // ── Umumiy kartalar (filtrga bog'liq emas) ──
  const cardsEl = document.getElementById('reportsCards');
  if (cardsEl) {
    const pending = all.filter(r => reportState(r, todayStr) === 'pending').length;
    const overdue = all.filter(r => reportState(r, todayStr) === 'overdue').length;
    const done = all.filter(r => reportState(r, todayStr) === 'done').length;
    const thisMonth = all.filter(r => monthOf(r.dueDate) === currentMonth() && reportState(r, todayStr) !== 'done').length;
    cardsEl.innerHTML = `
      <div class="stat-card warning"><div class="stat-icon warning">📋</div>
        <div class="stat-label">Kutilmoqda</div><div class="stat-value">${pending} ta</div></div>
      <div class="stat-card danger"><div class="stat-icon danger">🚨</div>
        <div class="stat-label">Muddati o'tgan</div><div class="stat-value">${overdue} ta</div></div>
      <div class="stat-card accent"><div class="stat-icon accent">📅</div>
        <div class="stat-label">Shu oy topshiriladigan</div><div class="stat-value">${thisMonth} ta</div></div>
      <div class="stat-card success"><div class="stat-icon success">✓</div>
        <div class="stat-label">Topshirilgan</div><div class="stat-value">${done} ta</div></div>`;
  }

  // ── Filtrlar ──
  const q = (document.getElementById('repSearch')?.value || '').toLowerCase();
  const monthF = document.getElementById('repMonthFilter')?.value || '';
  const statusF = document.getElementById('repStatusFilter')?.value || '';

  let list = all;
  if (q) list = list.filter(r => (r.type || '').toLowerCase().includes(q));
  if (monthF) list = list.filter(r => monthOf(r.dueDate) === monthF);
  if (statusF) list = list.filter(r => reportState(r, todayStr) === statusF);

  const wrap = document.getElementById('reportsWrap');
  if (!all.length) {
    wrap.innerHTML = emptyState('📄', 'Hisobot yo\'q',
      '"Hisobot turlarini tanlash" orqali kuzatiladigan hisobotlarni belgilang yoki "Hisobot qo\'shish" bilan qo\'lda kiriting');
    return;
  }
  if (!list.length) {
    wrap.innerHTML = emptyState('🔍', 'Filtrga mos hisobot yo\'q', 'Filtrlarni o\'zgartiring yoki tozalang');
    return;
  }

  const byMonth = {};
  list.forEach(r => {
    const m = r.dueDate ? r.dueDate.slice(0, 7) : 'Boshqa';
    (byMonth[m] = byMonth[m] || []).push(r);
  });
  const months = Object.keys(byMonth).sort();

  const rowHtml = r => {
    const days = daysUntil(r.dueDate);
    const st = reportState(r, todayStr);
    const cls = st === 'done' ? 'success' : st === 'overdue' ? 'danger' : (days !== null && days <= 5 ? 'warning' : 'info');
    const label = st === 'done' ? 'Topshirilgan' : st === 'overdue' ? 'Muddati o\'tgan' : 'Kutilmoqda';
    const daysLabel = st === 'done' ? '—' : days === null ? '—' : days < 0 ? `${Math.abs(days)} kun o'tdi` : `${days} kun`;
    return `<tr>
      <td><strong>${escHtml(r.type)}</strong></td>
      <td>${formatDate(r.dueDate)}</td>
      <td style="color:${st === 'overdue' ? 'var(--danger-light)' : (days !== null && days <= 5 ? 'var(--warning-light)' : 'var(--text-muted)')}">${daysLabel}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td><div class="row-actions">
        <button class="btn btn-sm buxgalter-only btn-${st === 'done' ? 'secondary' : 'success'}" onclick="toggleReport('${r.id}')">
          ${st === 'done' ? '↩ Bekor' : '✓ Topshirildi'}</button>
        <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteReport('${r.id}')">🗑</button>
      </div></td>
    </tr>`;
  };

  wrap.innerHTML = months.map(m => {
    const rows = byMonth[m].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    const pending = rows.filter(r => reportState(r, todayStr) !== 'done').length;
    return `<div class="chart-card" style="margin-bottom:16px;padding:0;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:var(--bg-3)">
        <strong style="font-size:14px">${m === 'Boshqa' ? 'Muddati belgilanmagan' : monthLabel(m)}</strong>
        <span class="badge ${pending ? 'warning' : 'success'}">${pending ? pending + ' ta tayyorlash kerak' : 'Barchasi topshirilgan'}</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Hisobot turi</th><th>Muddat</th><th>Qolgan</th><th>Holat</th><th></th></tr></thead>
        <tbody>${rows.map(rowHtml).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('');
}

function openReportSettingsModal() {
  const firm = state.firms.find(f => f.id === activeFirmId);
  const keys = (firm && firm.reportKeys) || [];
  openModal('Kuzatiladigan hisobot turlari', `
    <div class="field-hint" style="margin-bottom:12px">Firmangiz topshiradigan hisobotlarni belgilang — muddatlar avtomat yaratiladi.</div>
    <div class="checkbox-group">
      ${REPORT_CATALOG.map(r => `
        <div class="checkbox-item">
          <input type="checkbox" id="rep_${r.key}" value="${r.key}" ${keys.includes(r.key) ? 'checked' : ''}>
          <label for="rep_${r.key}">${escHtml(r.label)} · ${r.freq}</label>
        </div>`).join('')}
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveReportSettings(this)">Saqlash</button>`);
}

async function saveReportSettings(btn) {
  const keys = REPORT_CATALOG.filter(r => document.getElementById('rep_' + r.key)?.checked).map(r => r.key);
  setBtnLoading(btn, true);
  try {
    const { error } = await sb.from('firms').update({ report_keys: keys }).eq('id', activeFirmId);
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast('Saqlandi — muddatlar yaratilmoqda...', 'success');
    await loadState();
    await ensureUpcomingReports();
    renderAll();
  } finally { setBtnLoading(btn, false); }
}

function openReportModal() {
  openModal('Hisobot qo\'shish', `
    <div class="field"><label>Hisobot turi *</label>
      <input id="r_type" placeholder="Masalan: QQS hisoboti" list="reportCatalog">
      <datalist id="reportCatalog">${REPORT_CATALOG.map(r => `<option value="${escHtml(r.label)}">`).join('')}</datalist></div>
    <div class="field"><label>Topshirish muddati</label><input id="r_due" type="date"></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveReport(this)">Saqlash</button>`);
}

async function saveReport(btn) {
  const type = document.getElementById('r_type').value.trim();
  if (!type) { toast('Hisobot turini kiriting', 'warning'); return; }
  setBtnLoading(btn, true);
  try {
    const { error } = await sb.from('reports').insert({
      firm_id: activeFirmId, type,
      due_date: document.getElementById('r_due').value || null, status: 'Kutilmoqda'
    });
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast('Hisobot qo\'shildi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

async function toggleReport(id) {
  const r = state.reports.find(x => x.id === id);
  if (!r) return;
  const newStatus = r.status === 'Topshirilgan' ? 'Kutilmoqda' : 'Topshirilgan';
  const { error } = await sb.from('reports').update({ status: newStatus }).eq('id', id);
  if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
  await refreshAndRender();
}

async function deleteReport(id) {
  if (!(await confirmDialog('Ushbu hisobotni o\'chirasizmi?'))) return;
  const { error } = await sb.from('reports').delete().eq('id', id);
  if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
  toast('O\'chirildi', 'success');
  await refreshAndRender();
}

// ══════════════════════════════════════════
// ADMIN PANEL (firmalar + hisobotlar bazasi)
// ══════════════════════════════════════════

function renderAdmin() {
  const wrap = document.getElementById('adminWrap');
  const todayStr = today();
  const reports = firmReports().sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const firm = state.firms.find(f => f.id === activeFirmId);

  wrap.innerHTML = `
    <!-- FIRMALAR -->
    <div class="chart-card" style="padding:0;overflow:hidden;margin-bottom:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:var(--bg-3)">
        <strong style="font-size:15px">🏢 Firmalar</strong>
        <button class="btn btn-primary btn-sm buxgalter-only" onclick="openFirmModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Firma qo'shish
        </button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nomi</th><th>STIR</th><th>Soliq rejimi</th><th>Sizning rolingiz</th><th></th></tr></thead>
        <tbody>${state.firms.map(f => {
          const role = roleForFirm(f.id);
          return `<tr>
            <td><strong>${escHtml(f.name)}</strong>${f.id === activeFirmId ? ' <span class="badge success">faol</span>' : ''}</td>
            <td>${escHtml(f.stir) || '—'}</td>
            <td>${escHtml(f.regime) || '—'}</td>
            <td><span class="badge ${role === 'buxgalter' ? 'success' : 'muted'}">${role === 'buxgalter' ? 'Buxgalter' : 'Direktor'}</span></td>
            <td><div class="row-actions">
              <button class="btn btn-sm btn-secondary" onclick="setActiveFirm('${f.id}')">Tanlash</button>
              <button class="btn btn-sm btn-secondary buxgalter-only" onclick="openFirmEditModal('${f.id}')">✏️</button>
              <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteFirm('${f.id}')">🗑</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>

    <!-- HISOBOTLAR BAZASI -->
    <div class="chart-card" style="padding:0;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:var(--bg-3);flex-wrap:wrap;gap:8px">
        <strong style="font-size:15px">📋 Hisobotlar bazasi — ${escHtml(firm ? firm.name : '')}</strong>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm buxgalter-only" onclick="openReportSettingsModal()">⚙️ Turlarni tanlash</button>
          <button class="btn btn-primary btn-sm buxgalter-only" onclick="openReportEditModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Hisobot qo'shish
          </button>
        </div>
      </div>
      ${reports.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Hisobot turi</th><th>Muddat</th><th>Holat</th><th></th></tr></thead>
        <tbody>${reports.map(r => {
          const st = reportState(r, todayStr);
          const cls = st === 'done' ? 'success' : st === 'overdue' ? 'danger' : 'warning';
          const label = st === 'done' ? 'Topshirilgan' : st === 'overdue' ? 'Muddati o\'tgan' : 'Kutilmoqda';
          return `<tr>
            <td><strong>${escHtml(r.type)}</strong></td>
            <td>${formatDate(r.dueDate)}</td>
            <td><span class="badge ${cls}">${label}</span></td>
            <td><div class="row-actions">
              <button class="btn btn-sm btn-secondary buxgalter-only" onclick="openReportEditModal('${r.id}')">✏️ Muddat</button>
              <button class="btn btn-sm buxgalter-only btn-${st === 'done' ? 'secondary' : 'success'}" onclick="toggleReport('${r.id}')">${st === 'done' ? '↩' : '✓'}</button>
              <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteReport('${r.id}')">🗑</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` :
      `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">Hali hisobot yo'q. "Turlarni tanlash" yoki "Hisobot qo'shish" orqali kiriting.</div>`}
    </div>`;
}

async function deleteFirm(id) {
  const firm = state.firms.find(f => f.id === id);
  if (!firm) return;
  if (state.firms.length <= 1) { toast('Oxirgi firmani o\'chirib bo\'lmaydi', 'warning'); return; }
  const ok = await confirmDialog(
    `"${firm.name}" firmasini VA uning BARCHA ma'lumotlarini (kassa, operatsiyalar, hisobotlar...) butunlay o'chirasizmi? Bu amalni QAYTARIB BO'LMAYDI.`,
    { okText: 'Ha, butunlay o\'chirish' });
  if (!ok) return;

  // Baza funksiyasi barcha bog'liq ma'lumotni to'g'ri tartibda o'chiradi (RLS xavfsiz)
  const { error } = await sb.rpc('delete_firm', { f: id });
  if (error) { toast('O\'chirishda xatolik: ' + error.message, 'error', 6000); return; }

  if (activeFirmId === id) activeFirmId = null;
  toast('Firma o\'chirildi', 'success');
  await refreshAndRender();
}

// Firma ma'lumotlarini tahrirlash
function openFirmEditModal(id) {
  const f = state.firms.find(x => x.id === id);
  if (!f) return;
  openModal('Firmani tahrirlash', `
    <div class="field-row">
      <div class="field"><label>Firma nomi *</label><input id="fe_name" value="${escHtml(f.name)}"></div>
      <div class="field"><label>STIR</label><input id="fe_stir" value="${escHtml(f.stir)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Telefon</label><input id="fe_phone" value="${escHtml(f.phone)}"></div>
      <div class="field"><label>Soliq rejimi</label><select id="fe_regime">
        ${['QQS to\'lovchi', 'Aylanma soliq', 'Yagona soliq to\'lovchi', 'Oddiy deklaratsiya']
          .map(r => `<option ${f.regime === r ? 'selected' : ''}>${r}</option>`).join('')}
      </select></div>
    </div>
    <div class="field"><label>Manzil</label><input id="fe_address" value="${escHtml(f.address)}"></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveFirmEdit('${id}', this)">Saqlash</button>`);
}

async function saveFirmEdit(id, btn) {
  const name = document.getElementById('fe_name').value.trim();
  if (!name) { toast('Firma nomini kiriting', 'warning'); return; }
  setBtnLoading(btn, true);
  try {
    const { error } = await sb.from('firms').update({
      name,
      stir: document.getElementById('fe_stir').value.trim(),
      phone: document.getElementById('fe_phone').value.trim(),
      address: document.getElementById('fe_address').value.trim(),
      regime: document.getElementById('fe_regime').value
    }).eq('id', id);
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast('Firma yangilandi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

// Hisobot qo'shish / muddatini o'zgartirish (bitta modal)
function openReportEditModal(editId) {
  const r = editId ? state.reports.find(x => x.id === editId) : null;
  openModal(r ? 'Hisobot muddatini o\'zgartirish' : 'Hisobot qo\'shish', `
    <div class="field"><label>Hisobot turi *</label>
      <input id="r_type" value="${r ? escHtml(r.type) : ''}" placeholder="Masalan: QQS hisoboti" list="reportCatalog">
      <datalist id="reportCatalog">${REPORT_CATALOG.map(x => `<option value="${escHtml(x.label)}">`).join('')}</datalist></div>
    <div class="field-row">
      <div class="field"><label>Topshirish muddati</label>
        <input id="r_due" type="date" value="${r ? String(r.dueDate).slice(0, 10) : ''}"></div>
      <div class="field"><label>Holat</label><select id="r_status">
        <option value="Kutilmoqda" ${!r || r.status !== 'Topshirilgan' ? 'selected' : ''}>Kutilmoqda</option>
        <option value="Topshirilgan" ${r && r.status === 'Topshirilgan' ? 'selected' : ''}>Topshirilgan</option>
      </select></div>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveReportEdit('${editId || ''}', this)">Saqlash</button>`);
}

async function saveReportEdit(editId, btn) {
  const type = document.getElementById('r_type').value.trim();
  if (!type) { toast('Hisobot turini kiriting', 'warning'); return; }
  const row = {
    type,
    due_date: document.getElementById('r_due').value || null,
    status: document.getElementById('r_status').value
  };
  setBtnLoading(btn, true);
  try {
    const { error } = editId
      ? await sb.from('reports').update(row).eq('id', editId)
      : await sb.from('reports').insert({ firm_id: activeFirmId, ...row });
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast(editId ? 'Muddat yangilandi' : 'Hisobot qo\'shildi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

// ══════════════════════════════════════════
// BYUDJET
// ══════════════════════════════════════════

function renderByudjet() {
  const monthEl = document.getElementById('byudjetMonth');
  const month = monthEl?.value || currentMonth();
  const budgets = state.budgets.filter(b => b.firmId === activeFirmId && b.month === month);
  const wrap = document.getElementById('byudjetWrap');

  if (!budgets.length) {
    wrap.innerHTML = emptyState('📅', 'Byudjet belgilanmagan',
      `${monthLabel(month)} uchun kategoriya bo'yicha chegara belgilang`);
    return;
  }

  const ops = firmOperations().filter(o => monthOf(o.accrualDate) === month);
  wrap.innerHTML = `<div class="budget-section">${budgets.map(b => {
    const cat = firmCategories(true).find(c => c.name === b.category);
    const spent = ops.filter(o => cat && o.categoryId === cat.id).reduce((s, o) => s + o.amount, 0);
    const pct = b.limit > 0 ? Math.min((spent / b.limit) * 100, 150) : 0;
    const cls = pct >= 100 ? 'over' : pct >= 75 ? 'warn' : 'ok';
    return `<div class="budget-item">
      <div class="budget-item-header">
        <div class="budget-item-name">📌 ${escHtml(b.category)}</div>
        <div style="display:flex;gap:10px;align-items:center">
          <span class="budget-item-amounts">${fmt(spent)} / ${fmt(b.limit)}</span>
          <span class="badge ${pct >= 100 ? 'danger' : pct >= 75 ? 'warning' : 'success'}">${Math.round(pct)}%</span>
          <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteBudget('${b.id}')">🗑</button>
        </div>
      </div>
      <div class="progress-bar"><div class="progress-fill ${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
      ${pct >= 100 ? `<div style="color:var(--danger-light);font-size:12px;margin-top:6px">⚠️ Byudjet oshdi: ${fmt(spent - b.limit)} ortiqcha</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function openByudjetModal() {
  const cats = firmCategories().filter(c => c.type === 'expense');
  if (!cats.length) { toast('Avval xarajat kategoriyasini qo\'shing', 'warning'); return; }
  openModal('Byudjet belgilash', `
    <div class="field"><label>Oy</label><input id="b_month" type="month" value="${currentMonth()}"></div>
    <div class="field"><label>Kategoriya</label>
      <select id="b_category">${cats.map(c => `<option>${escHtml(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Byudjet chegarasi (so'm)</label>
      <input id="b_limit" type="text" inputmode="numeric" oninput="formatAmountInput(this)" placeholder="0"></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveBudget(this)">Saqlash</button>`);
}

async function saveBudget(btn) {
  const limit = parseAmountInput('b_limit');
  if (!limit) { toast('Summani kiriting', 'warning'); return; }
  const month = document.getElementById('b_month').value;
  const category = document.getElementById('b_category').value;
  const existing = state.budgets.find(b => b.firmId === activeFirmId && b.month === month && b.category === category);
  setBtnLoading(btn, true);
  try {
    const { error } = existing
      ? await sb.from('budgets').update({ amount: limit }).eq('id', existing.id)
      : await sb.from('budgets').insert({ firm_id: activeFirmId, month, category, amount: limit });
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast('Byudjet saqlandi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

async function deleteBudget(id) {
  const { error } = await sb.from('budgets').delete().eq('id', id);
  if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
  await refreshAndRender();
}

// ══════════════════════════════════════════
// KONTRAGENTLAR
// ══════════════════════════════════════════

function renderKontragentlar() {
  const q = (document.getElementById('contSearch')?.value || '').toLowerCase();
  let list = firmContragents();
  if (q) list = list.filter(c =>
    c.name.toLowerCase().includes(q) || (c.stir || '').includes(q) || (c.email || '').toLowerCase().includes(q));

  const wrap = document.getElementById('kontragentlarWrap');
  if (!list.length) {
    wrap.innerHTML = emptyState('👥', 'Kontragent topilmadi', 'Mijoz yoki yetkazib beruvchi qo\'shing');
    return;
  }

  const ops = firmOperations();
  wrap.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Nomi</th><th>STIR</th><th>Telefon</th>
      <th style="text-align:right">Debitor</th><th style="text-align:right">Kreditor</th><th>Holat</th><th></th></tr></thead>
    <tbody>${list.map(c => {
      const mine = ops.filter(o => o.contragentId === c.id && o.status !== 'paid');
      const deb = mine.filter(o => (catById(o.categoryId) || {}).type === 'revenue')
        .reduce((s, o) => s + (o.amount - o.paidAmount), 0);
      const kred = mine.filter(o => (catById(o.categoryId) || {}).type === 'expense')
        .reduce((s, o) => s + (o.amount - o.paidAmount), 0);
      return `<tr>
        <td><strong>${escHtml(c.name)}</strong></td>
        <td>${escHtml(c.stir) || '—'}</td>
        <td>${escHtml(c.phone) || '—'}</td>
        <td style="text-align:right">${deb ? fmt(deb) : '—'}</td>
        <td style="text-align:right">${kred ? fmt(kred) : '—'}</td>
        <td><span class="badge ${c.status === 'Faol' ? 'success' : 'muted'}">${escHtml(c.status)}</span></td>
        <td><div class="row-actions">
          <button class="btn btn-sm btn-secondary buxgalter-only" onclick="openContragentModal('${c.id}')">✏️</button>
          <button class="btn btn-sm btn-danger buxgalter-only" onclick="deleteContragent('${c.id}')">🗑</button>
        </div></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function openContragentModal(editId) {
  const c = editId ? state.contragents.find(x => x.id === editId) : null;
  openModal(c ? 'Kontragentni tahrirlash' : 'Kontragent qo\'shish', `
    <div class="field-row">
      <div class="field"><label>Nomi *</label><input id="c_name" value="${c ? escHtml(c.name) : ''}" placeholder="MCHJ / FIO"></div>
      <div class="field"><label>STIR / JSHIR</label><input id="c_stir" value="${c ? escHtml(c.stir) : ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Telefon</label><input id="c_phone" value="${c ? escHtml(c.phone) : ''}"></div>
      <div class="field"><label>Email</label><input id="c_email" type="email" value="${c ? escHtml(c.email) : ''}"></div>
    </div>
    <div class="field"><label>Holat</label><select id="c_status">
      <option ${!c || c.status === 'Faol' ? 'selected' : ''}>Faol</option>
      <option ${c && c.status === 'Tugagan' ? 'selected' : ''}>Tugagan</option>
    </select></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Bekor</button>
     <button class="btn btn-primary" onclick="saveContragent('${editId || ''}', this)">Saqlash</button>`);
}

async function saveContragent(editId, btn) {
  const name = document.getElementById('c_name').value.trim();
  if (!name) { toast('Nomni kiriting', 'warning'); return; }
  const row = {
    name,
    stir: document.getElementById('c_stir').value.trim(),
    phone: document.getElementById('c_phone').value.trim(),
    email: document.getElementById('c_email').value.trim(),
    status: document.getElementById('c_status').value
  };
  setBtnLoading(btn, true);
  try {
    const { error } = editId
      ? await sb.from('contragents').update(row).eq('id', editId)
      : await sb.from('contragents').insert({ firm_id: activeFirmId, ...row });
    if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
    closeModal();
    toast(editId ? 'Kontragent yangilandi' : 'Kontragent qo\'shildi', 'success');
    await refreshAndRender();
  } finally { setBtnLoading(btn, false); }
}

async function deleteContragent(id) {
  if (!(await confirmDialog('Ushbu kontragentni o\'chirasizmi?'))) return;
  const { error } = await sb.from('contragents').delete().eq('id', id);
  if (error) { toast('Xatolik: ' + error.message, 'error'); return; }
  toast('Kontragent o\'chirildi', 'success');
  await refreshAndRender();
}

// ══════════════════════════════════════════
// DASHBOARD + GRAFIKLAR
// ══════════════════════════════════════════

function getLastNMonths(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function renderDashboard() {
  const pays = firmPayments();
  const monthNow = currentMonth();
  const monthIn = pays.filter(p => monthOf(p.paymentDate) === monthNow)
    .reduce((s, p) => s + Math.max(paymentSigned(p), 0), 0);
  const monthOut = pays.filter(p => monthOf(p.paymentDate) === monthNow)
    .reduce((s, p) => s + Math.max(-paymentSigned(p), 0), 0);

  const open = firmOperations().filter(o => o.status !== 'paid');
  const debitor = open.filter(o => (catById(o.categoryId) || {}).type === 'revenue')
    .reduce((s, o) => s + (o.amount - o.paidAmount), 0);

  // Sparkline uchun so'nggi 6 oy trendi
  const m6 = getLastNMonths(6);
  const incArr = m6.map(m => pays.filter(p => monthOf(p.paymentDate) === m).reduce((s, p) => s + Math.max(paymentSigned(p), 0), 0));
  const expArr = m6.map(m => pays.filter(p => monthOf(p.paymentDate) === m).reduce((s, p) => s + Math.max(-paymentSigned(p), 0), 0));
  let cum = 0; const balArr = m6.map((_, i) => (cum += incArr[i] - expArr[i]));

  document.getElementById('dashboardCards').innerHTML = `
    <div class="stat-card accent"><div class="stat-icon accent">💰</div>
      <div class="stat-label">Kassa qoldig'i</div><div class="stat-value">${fmt(totalCash())}</div>
      ${sparklineSVG(balArr, 'rgba(255,255,255,0.85)')}</div>
    <div class="stat-card success"><div class="stat-icon success">↑</div>
      <div class="stat-label">Shu oy kirim</div><div class="stat-value">${fmt(monthIn)}</div>
      ${sparklineSVG(incArr, 'var(--success)')}</div>
    <div class="stat-card danger"><div class="stat-icon danger">↓</div>
      <div class="stat-label">Shu oy chiqim</div><div class="stat-value">${fmt(monthOut)}</div>
      ${sparklineSVG(expArr, 'var(--danger)')}</div>
    <div class="stat-card warning"><div class="stat-icon warning">📥</div>
      <div class="stat-label">Debitor qarzi</div><div class="stat-value">${fmt(debitor)}</div></div>`;

  const recent = [...pays].sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || '')).slice(0, 6);
  document.getElementById('recentTransactions').innerHTML = recent.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th>Kategoriya</th><th>Hisob</th><th style="text-align:right">Summa</th></tr></thead>
      <tbody>${recent.map(p => {
        const cat = paymentCategory(p);
        const op = opById(p.operationId);
        const who = (op && contragentName(op.contragentId)) || (cat ? cat.name : '—');
        return `<tr>
          <td><div class="tx-party"><div class="tx-av">${escHtml(avatarInitials(who))}</div>
            <div><div class="tx-nm">${escHtml(cat ? cat.name : '—')}</div>
            <div class="tx-mt">${formatDate(p.paymentDate)}${op && contragentName(op.contragentId) ? ' · ' + escHtml(contragentName(op.contragentId)) : ''}</div></div></div></td>
          <td>${escHtml((accById(p.accountId) || {}).name || '—')}</td>
          <td style="text-align:right">${fmtSign(paymentSigned(p))}</td></tr>`;
      }).join('')}</tbody></table></div>`
    : emptyState('💳', 'Hali to\'lov yo\'q', 'Kassa bo\'limidan birinchi kirim yoki chiqimni qo\'shing — dashboard jonlanadi');

  updateChart();
  updateCategoryChart();
}

function updateChart() {
  const n = parseInt(document.getElementById('chartMonthFilter')?.value || '6');
  const months = getLastNMonths(n);
  const pays = firmPayments();
  const inData = months.map(m => pays.filter(p => monthOf(p.paymentDate) === m)
    .reduce((s, p) => s + Math.max(paymentSigned(p), 0), 0) / 1e6);
  const outData = months.map(m => pays.filter(p => monthOf(p.paymentDate) === m)
    .reduce((s, p) => s + Math.max(-paymentSigned(p), 0), 0) / 1e6);

  const ctx = document.getElementById('cashflowChart');
  if (!ctx) return;
  if (cashflowChartInstance) cashflowChartInstance.destroy();

  const last = months.length - 1;
  const areaGrad = hex => (c) => {
    const { ctx: cc, chartArea } = c.chart;
    if (!chartArea) return hex + '00';
    const g = cc.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, hex + '55'); g.addColorStop(1, hex + '00');
    return g;
  };
  const dot = (hex) => months.map((_, i) => i === last ? 5 : 0);
  const tc = chartColors();

  cashflowChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months.map(monthLabel),
      datasets: [
        { label: 'Kirim', data: inData, borderColor: '#24D07A', backgroundColor: areaGrad('#24D07A'),
          fill: true, tension: 0.4, borderWidth: 2.6, pointRadius: dot(), pointHoverRadius: 5,
          pointBackgroundColor: '#24D07A', pointBorderColor: tc.cardBg, pointBorderWidth: 2 },
        { label: 'Chiqim', data: outData, borderColor: '#E5636C', backgroundColor: areaGrad('#E5636C'),
          fill: true, tension: 0.4, borderWidth: 2.6, pointRadius: dot(), pointHoverRadius: 5,
          pointBackgroundColor: '#E5636C', pointBorderColor: tc.cardBg, pointBorderWidth: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { labels: { color: tc.legend, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, font: { family: 'Space Grotesk', size: 12 } } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.raw.toFixed(1)} mln so'm` } }
      },
      scales: {
        x: { ticks: { color: tc.tick, font: { family: 'Space Grotesk', size: 11 } }, grid: { display: false } },
        y: { ticks: { color: tc.tick, font: { family: 'Space Grotesk', size: 11 }, callback: v => v + ' mln' }, grid: { color: tc.grid }, border: { display: false } }
      }
    }
  });
}

function updateCategoryChart() {
  const el = document.getElementById('categoryBreakdown');
  if (!el) return;

  const map = {};
  firmPayments().forEach(p => {
    const cat = paymentCategory(p);
    if (!cat || cat.type !== 'expense') return;
    map[cat.name] = (map[cat.name] || 0) + p.amount;
  });
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);

  if (!entries.length) {
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--text-muted);font-size:13px">Ma'lumot yo'q</div>`;
    return;
  }

  const max = entries[0][1] || 1;
  const colors = ['#24D07A', '#1FB86C', '#4ADE80', '#7DE9A8', '#A7EFC4', 'var(--border)'];
  el.innerHTML = entries.map(([name, val], i) => {
    const pct = Math.max(4, Math.round(val / max * 100));
    return `<div class="brk-line">
      <div class="brk-top"><span class="brk-name">${escHtml(name)}</span><span class="brk-amt">${(val / 1e6).toFixed(1)} mln</span></div>
      <div class="brk-track"><i style="width:${pct}%;background:${colors[i] || 'var(--border)'}"></i></div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
// ESLATMALAR
// ══════════════════════════════════════════

function getNotifications() {
  const notifs = [];
  firmOperations().filter(o => o.status !== 'paid' && o.dueDate).forEach(o => {
    const days = daysUntil(o.dueDate);
    const cat = catById(o.categoryId);
    const who = contragentName(o.contragentId) || (cat ? cat.name : '');
    if (days !== null && days < 0) {
      notifs.push({ type: 'danger', icon: '🚨', title: 'To\'lov muddati o\'tdi',
        sub: `${who} — ${fmt(o.amount - o.paidAmount)} — ${Math.abs(days)} kun oldin` });
    } else if (days !== null && days <= 5) {
      notifs.push({ type: 'warning', icon: '⚠️', title: 'To\'lov muddati yaqin',
        sub: `${who} — ${fmt(o.amount - o.paidAmount)} — ${days} kun qoldi` });
    }
  });
  firmTransfers().filter(t => !t.receivedDate).forEach(t => {
    notifs.push({ type: 'warning', icon: '🚚', title: 'Yo\'ldagi pul',
      sub: `${fmt(t.amount)} — ${formatDate(t.sentDate)} da jo'natilgan, hali yetib bormagan` });
  });
  firmReports().filter(r => r.status !== 'Topshirilgan').forEach(r => {
    const days = daysUntil(r.dueDate);
    if (days !== null && days < 0) {
      notifs.push({ type: 'danger', icon: '🚨', title: `${r.type} — muddati o'tdi`,
        sub: `${Math.abs(days)} kun oldin (${formatDate(r.dueDate)})` });
    } else if (days !== null && days <= 5 && days >= 0) {
      notifs.push({ type: 'warning', icon: '📋', title: `${r.type} — topshirish yaqin`,
        sub: `${days} kun qoldi — ${formatDate(r.dueDate)}` });
    }
  });
  return notifs;
}

function renderNotifications() {
  const notifs = getNotifications();
  const dot = document.getElementById('notifDot');
  const listEl = document.getElementById('notifList');
  dot.classList.toggle('show', notifs.length > 0);
  listEl.innerHTML = notifs.length
    ? notifs.map(n => `<div class="notif-item">
        <div class="notif-item-icon ${n.type}">${n.icon}</div>
        <div class="notif-item-text">
          <div class="notif-item-title">${escHtml(n.title)}</div>
          <div class="notif-item-sub">${escHtml(n.sub)}</div>
        </div></div>`).join('')
    : `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Hozircha eslatma yo'q ✓</div>`;
}

// ══════════════════════════════════════════
// RENDER ALL
// ══════════════════════════════════════════

function renderAll() {
  if (!state) return;
  applyRolePermissions();
  renderFirmSelect();
  renderNotifications();

  const activeView = document.querySelector('.view.active');
  if (!activeView) return;
  const viewId = activeView.id.replace('view-', '');

  const bm = document.getElementById('byudjetMonth');
  if (bm && !bm.value) bm.value = currentMonth();

  switch (viewId) {
    case 'dashboard': renderDashboard(); break;
    case 'kassa': renderKassa(); break;
    case 'operatsiyalar': renderOperatsiyalar(); break;
    case 'debitor': renderDebitor(); break;
    case 'byudjet': renderByudjet(); break;
    case 'cashflow': renderCashflow(); break;
    case 'pl': renderPL(); break;
    case 'balans': renderBalans(); break;
    case 'soliqlar': renderSoliqlar(); break;
    case 'hisobotlar': renderReports(); ensureUpcomingReports(); break;
    case 'kategoriyalar': renderKategoriyalar(); break;
    case 'hisoblar': renderHisoblar(); break;
    case 'kontragentlar': renderKontragentlar(); break;
    case 'admin': renderAdmin(); break;
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
// SOAT
// ══════════════════════════════════════════

function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const d = document.getElementById('topbarDate');
  const t = document.getElementById('sidebarTime');
  if (d) d.textContent = `${date} · ${time}`;
  if (t) t.textContent = time;
}

// ══════════════════════════════════════════
// AUTH & INIT
// ══════════════════════════════════════════

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login_email').value.trim();
  const password = document.getElementById('login_password').value;
  const errEl = document.getElementById('loginError');
  const btn = e.target.querySelector('button[type="submit"]');
  errEl.textContent = '';
  setBtnLoading(btn, true);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    setBtnLoading(btn, false);
    errEl.textContent = 'Email yoki parol noto\'g\'ri.';
    return;
  }
  await startApp();
  setBtnLoading(btn, false);
}

async function handleLogout() {
  await sb.auth.signOut();
  location.reload();
}

async function startApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = '';
  showLoader('Ma\'lumotlar yuklanmoqda...');
  try {
    await loadState();
  } catch (err) {
    hideLoader();
    toast('Yuklashda xatolik: ' + (err?.message || err), 'error', 8000);
    document.getElementById('app').innerHTML =
      `<div style="padding:60px;text-align:center;color:var(--text-muted)">
        Ma'lumotlarni yuklab bo'lmadi.<br><br>
        <span style="font-size:12px">${escHtml(err?.message || '')}</span><br><br>
        <span style="font-size:12px">Baza migratsiyalari (financehub_v2_migrations) bajarilganini tekshiring.</span>
      </div>`;
    return;
  }
  hideLoader();

  if (!state.firms.length) {
    document.getElementById('app').innerHTML =
      '<div style="padding:60px;text-align:center;color:var(--text-muted)">Sizga hali birorta firma biriktirilmagan. Buxgalteringiz bilan bog\'laning.</div>';
    return;
  }
  showView('dashboard');
}

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

  document.addEventListener('click', e => {
    const panel = document.getElementById('notifPanel');
    const bell = document.getElementById('notifBell');
    if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
      panel.classList.remove('open');
    }
  });
});
