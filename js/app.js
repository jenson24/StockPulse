// ─── Navigation ───────────────────────────────────────────────────────────────

function navigateTo(tab) {
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-nav="${tab}"]`);
  if (navItem) navItem.classList.add('active');
  $('page-' + tab).classList.add('active');
  activeTab = tab;

  if (tab === 'alerts') renderAlerts();
  if (tab === 'buys') renderBuys();
  if (tab === 'settings') renderSettings();
  if (tab === 'watchlist') renderWatchlist();
  if (tab === 'performance') renderPerformancePage();
  if (tab === 'momentum')    renderMomentumPage();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(n => {
  n.addEventListener('click', () => navigateTo(n.dataset.nav));
});

$('addBtn').addEventListener('click', () => {
  $('f-date').valueAsDate = new Date();
  // Inject the track toggle into the add modal (defaults to checked/true)
  $('add-track-toggle-wrap').innerHTML = trackToggleHTML(true, 'add-track-toggle'); // ← NEW
  $('addModal').classList.add('open');
});

$('cancelAddBtn').addEventListener('click', () => $('addModal').classList.remove('open'));
$('detailModal').addEventListener('click', e => { if (e.target === $('detailModal')) closeDetail(); });
$('addModal').addEventListener('click', e => { if (e.target === $('addModal')) $('addModal').classList.remove('open'); });

// ─── Close record trade modal on backdrop click ──── NEW
document.addEventListener('click', e => {
  const modal = $('recordTradeModal');
  if (modal && e.target === modal) closeRecordTradeModal();
});

$('savePositionBtn').addEventListener('click', () => {
  const ticker = $('f-ticker').value.trim().toUpperCase();
  const shares = parseFloat($('f-shares').value);
  const cost   = parseFloat($('f-cost').value);
  const price  = parseFloat($('f-price').value);
  const purchaseDate = $('f-date').value;
  const sector = $('f-sector').value;

  if (!ticker || isNaN(shares) || isNaN(cost)) { showToast('Fill in required fields'); return; }

  // Read track toggle — defaults true if element missing
  const tracked = $('add-track-toggle')?.checked !== false; // ← NEW

  positions.push({
    ticker,
    name: $('f-name').value.trim(),
    shares,
    cost,
    price: isNaN(price) ? cost : price,
    purchaseDate,
    sector,
    tracked, // ← NEW
  });

  save();
  $('addModal').classList.remove('open');
  ['f-ticker','f-name','f-shares','f-cost','f-price'].forEach(id => $(id).value = '');
  renderAll();
  showToast(`${ticker} added`);

  if (settings.apiKey) {
    refreshPrices();
    enrichPositionSector(ticker);
  }
});

$('saveSettingsBtn').addEventListener('click', () => {
  const oldWatchlist = settings.watchlist;
  settings.apiKey     = $('apiKeyInput').value.trim().replace(/\/+$/, '');
  settings.pwaSecret  = $('pwaSecretInput').value.trim();
  settings.anthropicKey = $('anthropicKeyInput').value.trim();
  settings.watchlist  = $('watchlistInput').value.trim();
  settings.stRate     = parseFloat($('stRateInput').value)    || 32;
  settings.ltRate     = parseFloat($('ltRateInput').value)    || 15;
  settings.stateRate  = parseFloat($('stateRateInput').value) || 0;
  settings.maxPos     = parseFloat($('maxPosInput').value)    || 10;
  settings.maxSector  = parseFloat($('maxSectorInput').value) || 30;
  settings.sigAlert   = parseFloat($('sigAlertInput').value)  || 100;
  settings.sigWarn    = parseFloat($('sigWarnInput').value)   || 50;
  localStorage.setItem('sp-settings', JSON.stringify(settings));
  if (oldWatchlist !== settings.watchlist) localStorage.removeItem('sp-buy-cache');
  showToast('Settings saved');
  updateApiStatus(settings.apiKey ? null : false);
  renderAll();
});

$('refreshBtn').addEventListener('click', () => {
  if (activeTab === 'buys') {
    loadBuyIdeas(true);
  } else if (activeTab === 'watchlist') {
    refreshWatchlistPrices().then(() => { renderWatchlistCards(); renderCorrView(); });
  } else if (activeTab === 'performance') {
    renderPerformancePage(); // ← NEW: refresh re-fetches SPY benchmark
  } else {
    refreshPrices();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

renderBuys();
renderAll();
updateWlBadge();
updateApiStatus(settings.apiKey && settings.pwaSecret ? null : false);

if (settings.apiKey && settings.pwaSecret && positions.length > 0) {
  refreshPrices();
  positions.filter(p => !p.sector).forEach(p => enrichPositionSector(p.ticker));
}

initMomentum();