// ─── State ───────────────────────────────────────────────────────────────────
let positions = JSON.parse(localStorage.getItem('sp-positions') || '[]');
let settings = JSON.parse(localStorage.getItem('sp-settings') || '{"apiKey":"","pwaSecret":"","anthropicKey":"","watchlist":"","stRate":32,"ltRate":15,"stateRate":0,"maxPos":10,"maxSector":30,"sigAlert":100,"sigWarn":50}');
let liveprices = {};
let cachedBuyIdeas = null;
let watchlist = JSON.parse(localStorage.getItem('sp-watchlist') || '[]');
let wlSort = 'date';
let buyIdeasGeneratedDate = null;
let activeTab = 'portfolio';

// ─── Utilities ────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function fmt(n, d=2) { return n.toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d}); }
function fmtUSD(n) { return '$' + fmt(n); }

function showToast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function save() { localStorage.setItem('sp-positions', JSON.stringify(positions)); }

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function isLongTerm(dateStr) { const d = daysSince(dateStr); return d !== null && d > 365; }

function holdingLabel(dateStr) {
  const d = daysSince(dateStr);
  if (d === null) return '—';
  if (d > 365) return Math.floor(d/365) + 'y ' + (Math.floor((d%365)/30)) + 'm';
  return d + ' days';
}

function calcTax(gain, dateStr) {
  if (gain <= 0) return null;
  const lt = isLongTerm(dateStr);
  const fedRate = lt ? (settings.ltRate || 15) : (settings.stRate || 32);
  const stateRate = settings.stateRate || 0;
  const totalRate = fedRate + stateRate;
  const taxDue = gain * (totalRate / 100);
  const netProceeds = gain - taxDue;
  return { lt, fedRate, stateRate, totalRate, taxDue, netProceeds };
}

function todayStr() { return new Date().toISOString().split('T')[0]; }
