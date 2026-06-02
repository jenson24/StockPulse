// ─── Watchlist Engine ─────────────────────────────────────────────────────────

function saveWatchlist() { localStorage.setItem('sp-watchlist', JSON.stringify(watchlist)); }

function isOnWatchlist(ticker) { return watchlist.some(w => w.ticker.toUpperCase() === ticker.toUpperCase()); }

function snapshotFromIndicators(ind, price) {
  if (!ind) return { price: price ?? null, rsi: null, bb: null, macd: null, sma50: null, sma200: null, macdSlope: null, macdDiv: null, macdRoc: null };
  return {
    price: price ?? ind.price ?? null,
    rsi: ind.rsi ?? null,
    bb: ind.bb?.pct ?? null,
    macd: ind.macd?.histogram ?? null,
    macdSlope: ind.macd?.slope ?? null,
    macdDiv: ind.macd?.divergenceType ?? null,
    macdRoc: ind.macd?.roc ?? null,
    macdMomentum: ind.macd?.momentumLabel ?? null,
    sma50: ind.sma50 ?? null,
    sma200: ind.sma200 ?? null,
  };
}

async function addToWatchlist(ticker, name, sector) {
  const up = ticker.toUpperCase();
  if (isOnWatchlist(up)) { showToast(`${up} already on watchlist`); return; }
  let snapshot = { price: null, rsi: null, bb: null, macd: null, sma50: null, sma200: null };
  let ind = currentIndicators[up] || null;
  let price = null;
  if (settings.apiKey && settings.pwaSecret) {
    try { const priceData = await fetchPrices([up]); price = priceData[up] ?? null; } catch(e) {}
    if (!ind) ind = await fetchIndicators(up);
  }
  snapshot = snapshotFromIndicators(ind, price);
  const entry = {
    ticker: up, name: name || up,
    sector: sector || getSector(up) || 'Other',
    addedAt: new Date().toISOString(),
    snapshot,
    current: { ...snapshot, ts: Date.now() },
  };
  watchlist.push(entry);
  saveWatchlist();
  showToast(`${up} added to watchlist ✓`);
  updateWlBadge();
  if (activeTab === 'watchlist') renderWatchlist();
}

function removeFromWatchlist(ticker) {
  const up = ticker.toUpperCase();
  watchlist = watchlist.filter(w => w.ticker !== up);
  saveWatchlist();
  updateWlBadge();
  renderWatchlist();
  showToast(`${up} removed from watchlist`);
}

async function refreshWatchlistPrices() {
  if (watchlist.length === 0) return;
  const tickers = watchlist.map(w => w.ticker);
  let prices = {};
  if (settings.apiKey && settings.pwaSecret) {
    try { prices = await fetchPrices(tickers); } catch(e) {}
  }
  const indResults = (settings.apiKey && settings.pwaSecret) ? await fetchAllIndicators(tickers) : {};
  watchlist = watchlist.map(w => {
    const ind = indResults[w.ticker] || null;
    const price = prices[w.ticker] ?? w.current?.price ?? null;
    return { ...w, current: { ...snapshotFromIndicators(ind, price), ts: Date.now() } };
  });
  saveWatchlist();
}

function wlDelta(snap, cur, field) {
  const base = snap?.[field], now = cur?.[field];
  if (base == null || now == null) return null;
  return field === 'price' ? ((now - base) / base) * 100 : now - base;
}

function fmtDelta(val, field, decimals) {
  if (val === null) return '—';
  const sign = val > 0 ? '+' : '';
  return field === 'price' ? `${sign}${val.toFixed(2)}%` : `${sign}${val.toFixed(decimals ?? 1)}`;
}

function deltaColor(val, field) {
  if (val === null) return 'var(--text3)';
  if (field === 'bb') return val < 0 ? 'var(--green)' : val > 0 ? 'var(--red)' : 'var(--text2)';
  return val > 0 ? 'var(--green)' : val < 0 ? 'var(--red)' : 'var(--text2)';
}

function setWlSort(mode) {
  wlSort = mode;
  ['date','pct','rsi'].forEach(s => {
    const btn = $('wlSort' + s.charAt(0).toUpperCase() + s.slice(1));
    if (btn) btn.classList.toggle('active', s === mode);
  });
  renderWatchlistCards();
}

function getSortedWatchlist() {
  const list = [...watchlist];
  if (wlSort === 'pct') {
    list.sort((a, b) => (wlDelta(b.snapshot, b.current, 'price') ?? -Infinity) - (wlDelta(a.snapshot, a.current, 'price') ?? -Infinity));
  } else if (wlSort === 'rsi') {
    list.sort((a, b) => (a.current?.rsi ?? 999) - (b.current?.rsi ?? 999));
  } else {
    list.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  }
  return list;
}

function renderWatchlistCards() {
  const el = $('watchlistCards');
  const bar = $('watchlistRefreshBar');
  if (watchlist.length === 0) {
    if (bar) bar.style.display = 'none';
    el.innerHTML = `<div class="empty">
      <div class="empty-icon">👁</div>
      <div class="empty-title">Watchlist is empty</div>
      <div class="empty-sub">Add stocks from the Buy Ideas or position detail views, or tap "Add to Watchlist" above to start tracking.</div>
    </div>`;
    return;
  }
  if (bar) bar.style.display = 'flex';
  const lastTs = watchlist.reduce((m, w) => Math.max(m, w.current?.ts || 0), 0);
  const lastUpdatedEl = $('wlLastUpdated');
  if (lastUpdatedEl && lastTs > 0) {
    const mins = Math.round((Date.now() - lastTs) / 60000);
    lastUpdatedEl.textContent = mins < 2 ? 'Just updated' : `Updated ${mins}m ago`;
  }
  el.innerHTML = getSortedWatchlist().map(w => {
    const priceDelta = wlDelta(w.snapshot, w.current, 'price');
    const rsiDelta   = wlDelta(w.snapshot, w.current, 'rsi');
    const bbDelta    = wlDelta(w.snapshot, w.current, 'bb');
    const macdDelta  = wlDelta(w.snapshot, w.current, 'macd');
    const sma50D     = wlDelta(w.snapshot, w.current, 'sma50');
    const sma200D    = wlDelta(w.snapshot, w.current, 'sma200');
    const curPrice = w.current?.price, basePrice = w.snapshot?.price;
    const priceColor = priceDelta === null ? 'var(--text)' : priceDelta >= 0 ? 'var(--green)' : 'var(--red)';
    const addedDate = new Date(w.addedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const daysAgo = Math.floor((Date.now() - new Date(w.addedAt)) / 86400000);
    return `<div class="wl-card" onclick="openWlDetail('${w.ticker}')">
      <div class="wl-card-header">
        <div>
          <div class="wl-ticker">${w.ticker}</div>
          <div class="wl-name">${w.name}</div>
          <div class="wl-meta">${w.sector} · Added ${addedDate} (${daysAgo}d ago)</div>
        </div>
        <div class="wl-price-col">
          <div class="wl-price" style="color:${priceColor}">${curPrice ? '$'+curPrice.toFixed(2) : '—'}</div>
          <div class="wl-price-chg" style="color:${priceColor}">${priceDelta !== null ? fmtDelta(priceDelta,'price',2)+' since added' : ''}</div>
          <div style="margin-top:6px"><button class="wl-remove-btn" onclick="event.stopPropagation();removeFromWatchlist('${w.ticker}')">Remove</button></div>
        </div>
      </div>
      <div class="wl-delta-grid">
        <div class="wl-delta"><div class="wl-delta-label">RSI Δ</div><div class="wl-delta-val" style="color:${deltaColor(rsiDelta,'rsi')}">${fmtDelta(rsiDelta,'rsi',1)}</div><div class="wl-delta-sub">Now: ${w.current?.rsi ?? '—'}</div></div>
        <div class="wl-delta"><div class="wl-delta-label">BB %B Δ</div><div class="wl-delta-val" style="color:${deltaColor(bbDelta,'bb')}">${fmtDelta(bbDelta,'bb',1)}</div><div class="wl-delta-sub">Now: ${w.current?.bb ?? '—'}%</div></div>
        <div class="wl-delta"><div class="wl-delta-label">MACD Δ</div><div class="wl-delta-val" style="color:${deltaColor(macdDelta,'macd')}">${fmtDelta(macdDelta,'macd',3)}</div><div class="wl-delta-sub">${w.current?.macdMomentum ? w.current.macdMomentum : w.current?.macd != null ? (w.current.macd > 0 ? '▲' : '▼') : '—'}</div></div>
        <div class="wl-delta"><div class="wl-delta-label">SMA 50 Δ</div><div class="wl-delta-val" style="color:${deltaColor(sma50D,'sma50')}">${sma50D !== null ? (sma50D >= 0?'+':'')+' $'+Math.abs(sma50D).toFixed(2) : '—'}</div><div class="wl-delta-sub">Now: ${w.current?.sma50 ? '$'+w.current.sma50.toFixed(2) : '—'}</div></div>
        <div class="wl-delta"><div class="wl-delta-label">SMA 200 Δ</div><div class="wl-delta-val" style="color:${deltaColor(sma200D,'sma200')}">${sma200D !== null ? (sma200D >= 0?'+':'')+' $'+Math.abs(sma200D).toFixed(2) : '—'}</div><div class="wl-delta-sub">Now: ${w.current?.sma200 ? '$'+w.current.sma200.toFixed(2) : '—'}</div></div>
        <div class="wl-delta"><div class="wl-delta-label">Price Δ $</div><div class="wl-delta-val" style="color:${priceColor}">${basePrice && curPrice ? (curPrice>=basePrice?'+':'')+' $'+(curPrice-basePrice).toFixed(2) : '—'}</div><div class="wl-delta-sub">Base: ${basePrice ? '$'+basePrice.toFixed(2) : '—'}</div></div>
      </div>
    </div>`;
  }).join('');
}

async function openWlDetail(ticker) {
  const w = watchlist.find(x => x.ticker === ticker.toUpperCase());
  if (!w) return;
  // Set wl chart state so range/mom toggles work
  wlChartTicker = w.ticker.toUpperCase();
  wlChartRange  = 1;
  wlChartMom    = 'rsi';
  // Convert addedAt timestamp to YYYY-MM-DD for the marker
  wlChartAddedDate = w.addedAt
    ? new Date(w.addedAt).toISOString().slice(0, 10)
    : null;
  const fields = [
    { key:'price',  label:'Price',      fmt: v => v ? '$'+v.toFixed(2) : '—' },
    { key:'rsi',    label:'RSI (14)',    fmt: v => v ?? '—' },
    { key:'bb',     label:'BB %B',       fmt: v => v != null ? v+'%' : '—' },
    { key:'macd',   label:'MACD Hist',   fmt: v => v != null ? (v>0?'▲ ':'▼ ')+v.toFixed(3) : '—' },
    { key:'sma50',  label:'SMA 50',      fmt: v => v ? '$'+v.toFixed(2) : '—' },
    { key:'sma200', label:'SMA 200',     fmt: v => v ? '$'+v.toFixed(2) : '—' },
  ];
  const priceDelta = wlDelta(w.snapshot, w.current, 'price');
  const priceColor = priceDelta == null ? 'var(--text)' : priceDelta >= 0 ? 'var(--green)' : 'var(--red)';
  const addedDate = new Date(w.addedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const daysAgo = Math.floor((Date.now() - new Date(w.addedAt)) / 86400000);

  const snapshotRows = fields.map(f => {
    const d = wlDelta(w.snapshot, w.current, f.key);
    const dStr = f.key === 'sma50' || f.key === 'sma200'
      ? (d !== null ? (d>=0?'+':'')+' $'+Math.abs(d).toFixed(2) : '—')
      : fmtDelta(d, f.key, f.key==='macd' ? 3 : 2);
    return `<div class="detail-row">
      <span class="label">${f.label}</span>
      <span class="val">
        <span style="color:var(--text3)">${f.fmt(w.snapshot?.[f.key])} →</span>
        <span style="color:var(--text)">${f.fmt(w.current?.[f.key])}</span>
        <span style="color:${deltaColor(d, f.key)};margin-left:6px;font-size:12px">(${dStr})</span>
      </span>
    </div>`;
  }).join('');

  // Enhanced MACD momentum rows
  const cur = w.current;
  const macdMomentumRows = cur ? (() => {
    const momColor = cur.macdMomentum?.includes('↑') ? 'var(--green)' : cur.macdMomentum?.includes('↓') ? 'var(--red)' : 'var(--text3)';
    const divColor = cur.macdDiv === 'bullish' ? 'var(--green)' : cur.macdDiv === 'bearish' ? 'var(--red)' : 'var(--text3)';
    const slopeStr = cur.macdSlope != null ? (cur.macdSlope > 0 ? '+' : '') + cur.macdSlope.toFixed(4) + '/bar' : '—';
    const rocStr = cur.macdRoc != null ? (cur.macdRoc > 0 ? '+' : '') + cur.macdRoc.toFixed(2) + '%' : '—';
    const divLabel = cur.macdDiv === 'bullish' ? '▲ Bullish' : cur.macdDiv === 'bearish' ? '▼ Bearish' : cur.macdDiv === 'none' ? 'None' : '—';
    return `<div class="detail-row"><span class="label">MACD momentum</span><span class="val" style="color:${momColor}">${cur.macdMomentum || '—'}</span></div>
    <div class="detail-row"><span class="label">MACD slope</span><span class="val" style="color:${momColor}">${slopeStr}</span></div>
    <div class="detail-row"><span class="label">MACD rate of change</span><span class="val">${rocStr}</span></div>
    <div class="detail-row"><span class="label">MACD divergence</span><span class="val" style="color:${divColor}">${divLabel}</span></div>`;
  })() : '';

  $('wlDetailContent').innerHTML = `
    <div class="modal-title">${w.ticker} <span style="font-size:14px;color:var(--text3);font-weight:400">${w.name}</span></div>
    <div class="modal-subtitle" style="display:flex;align-items:center;justify-content:space-between">${w.sector} · Added ${addedDate} (${daysAgo} day${daysAgo!==1?'s':''} ago)<button class="edit-meta-btn" onclick="openEditWatchlistModal('${w.ticker}')">✏️ Edit</button></div>
    <div style="margin-bottom:14px">${chartControlsHTML('wl')}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div style="flex:1">
        <div style="font-size:28px;font-weight:700;color:${priceColor}">${w.current?.price ? '$'+w.current.price.toFixed(2) : '—'}</div>
        <div style="font-size:13px;color:${priceColor};margin-top:2px">${priceDelta !== null ? fmtDelta(priceDelta,'price',2)+' since added' : ''}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--text3)">Baseline (added)</div>
        <div style="font-size:15px;font-weight:600">${w.snapshot?.price ? '$'+w.snapshot.price.toFixed(2) : '—'}</div>
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Indicator snapshots — baseline → current (delta)</div>
      ${snapshotRows}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">MACD momentum analysis</div>
      ${macdMomentumRows || '<div style="font-size:13px;color:var(--text3)">No MACD data available</div>'}
    </div>
    <button class="delete-btn" onclick="removeFromWatchlist('${w.ticker}');$('wlDetailModal').classList.remove('open')">Remove from watchlist</button>
    <button class="btn-secondary" onclick="$('wlDetailModal').classList.remove('open')">Close</button>
  `;
  $('wlDetailModal').classList.add('open');
  $('wlDetailModal').onclick = e => { if (e.target === $('wlDetailModal')) $('wlDetailModal').classList.remove('open'); };
  // Ensure indicatorCache is warm for this ticker before rendering chart
  if (settings.apiKey && settings.pwaSecret) {
    const upper = w.ticker.toUpperCase();
    if (!indicatorCache[upper] || Date.now() - indicatorCache[upper].ts > 3600000) {
      await fetchIndicators(upper);
    }
  }
  // Render chart and style initial active buttons
  renderTwoPanel(wlChartTicker, wlChartRange, wlChartMom, 'wl');
  ['1','3','6'].forEach(m => {
    const btn = document.getElementById('wlRangeBtn'+m);
    if (btn) btn.style.cssText = m == wlChartRange
      ? 'padding:4px 12px;border-radius:8px;border:0.5px solid var(--accent);font-size:11px;font-weight:600;cursor:pointer;background:var(--accent);color:#fff'
      : 'padding:4px 12px;border-radius:8px;border:0.5px solid var(--border2);font-size:11px;font-weight:600;cursor:pointer;background:var(--bg3);color:var(--text2)';
  });
  ['rsi','macd'].forEach(m => {
    const btn = document.getElementById('wlMomBtn'+m);
    if (btn) btn.style.cssText = m === wlChartMom
      ? 'padding:4px 11px;border-radius:8px;border:0.5px solid var(--accent);font-size:11px;font-weight:600;cursor:pointer;text-transform:uppercase;background:var(--accent);color:#fff'
      : 'padding:4px 11px;border-radius:8px;border:0.5px solid var(--border2);font-size:11px;font-weight:600;cursor:pointer;text-transform:uppercase;background:var(--bg3);color:var(--text2)';
  });
}

function openWlAddModal(ticker, name, sector, ind) {
  const up = ticker.toUpperCase();
  if (isOnWatchlist(up)) { showToast(`${up} is already on watchlist`); return; }
  const fields = [
    { label:'Price',     val: ind?.price ? '$'+ind.price.toFixed(2) : 'Will fetch on add' },
    { label:'RSI (14)',  val: ind?.rsi ?? 'N/A' },
    { label:'BB %B',     val: ind?.bb?.pct != null ? ind.bb.pct+'%' : 'N/A' },
    { label:'MACD Hist', val: ind?.macd?.histogram != null ? (ind.macd.histogram>0?'▲ ':'▼ ')+ind.macd.histogram.toFixed(3) : 'N/A' },
    { label:'SMA 50',    val: ind?.sma50 ? '$'+ind.sma50.toFixed(2) : 'N/A' },
    { label:'SMA 200',   val: ind?.sma200 ? '$'+ind.sma200.toFixed(2) : 'N/A' },
  ];
  $('wlAddContent').innerHTML = `
    <div class="wl-add-modal-ticker">${up}</div>
    <div class="wl-add-modal-sub">${name || up} · These values will be your baseline for tracking changes over time.</div>
    ${fields.map(f=>`<div class="wl-snapshot-row"><div class="wl-snapshot-row-label">${f.label}</div><div class="wl-snapshot-row-val">${f.val}</div></div>`).join('')}
    <button class="btn-primary" style="margin-top:16px" onclick="addToWatchlist('${up}','${name||up}','${sector||''}');$('wlAddModal').classList.remove('open')">Add to watchlist</button>
    <button class="btn-secondary" onclick="$('wlAddModal').classList.remove('open')">Cancel</button>
  `;
  $('wlAddModal').classList.add('open');
  $('wlAddModal').onclick = e => { if (e.target === $('wlAddModal')) $('wlAddModal').classList.remove('open'); };
}

// ─── Direct Add to Watchlist (from Watchlist tab) ─────────────────────────────
async function openDirectAddWatchlistModal() {
  $('directWlContent').innerHTML = `
    <div class="modal-title">Add to Watchlist</div>
    <div class="modal-subtitle">Enter a ticker to track. Indicators will be fetched automatically if your Worker is connected.</div>
    <div class="field-row">
      <div class="field"><label>TICKER *</label><input id="dw-ticker" placeholder="AAPL" style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()"/></div>
      <div class="field"><label>COMPANY NAME</label><input id="dw-name" placeholder="Apple Inc."/></div>
    </div>
    <div class="field">
      <label>SECTOR</label>
      <select id="dw-sector">
        <option value="Other">Select a Sector</option>
        <option value="Information Technology">Information Technology</option>
        <option value="Health Care">Health Care</option>
        <option value="Financials">Financials</option>
        <option value="Consumer Discretionary">Consumer Discretionary</option>
        <option value="Communication Services">Communication Services</option>
        <option value="Industrials">Industrials</option>
        <option value="Consumer Staples">Consumer Staples</option>
        <option value="Energy">Energy</option>
        <option value="Utilities">Utilities</option>
        <option value="Real Estate">Real Estate</option>
        <option value="Materials">Materials</option>
      </select>
    </div>
    <button class="btn-primary" id="dw-addBtn" onclick="submitDirectAdd()">Fetch &amp; Add to Watchlist</button>
    <button class="btn-secondary" onclick="$('directWlModal').classList.remove('open')">Cancel</button>
  `;
  $('directWlModal').classList.add('open');
  $('directWlModal').onclick = e => { if (e.target === $('directWlModal')) $('directWlModal').classList.remove('open'); };
  setTimeout(() => $('dw-ticker')?.focus(), 100);
}

async function submitDirectAdd() {
  const ticker = ($('dw-ticker')?.value || '').trim().toUpperCase();
  const name   = ($('dw-name')?.value  || '').trim();
  const sector = $('dw-sector')?.value || 'Other';
  if (!ticker) { showToast('Enter a ticker symbol'); return; }
  if (isOnWatchlist(ticker)) { showToast(`${ticker} is already on watchlist`); return; }

  const btn = $('dw-addBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching data…'; }

  // Show loading state inside the modal
  $('directWlContent').innerHTML = `
    <div class="modal-title">Preview: ${ticker}</div>
    <div style="text-align:center;padding:40px 0;color:var(--text3)">
      <div style="font-size:28px;margin-bottom:12px">⏳</div>
      <div style="font-size:13px">Fetching live data…</div>
    </div>`;

  // Fetch price + indicators
  let ind = null;
  let price = null, change = null;
  if (settings.apiKey && settings.pwaSecret) {
    try {
      const quotes = await fetchMarketDataForWatchlist([ticker]);
      if (quotes.length) { price = quotes[0].price; change = quotes[0].change; }
    } catch(e) {}
    // Always call fetchIndicators so indicatorCache gets raw price history for the chart.
    // currentIndicators only holds computed values, not the raw OHLCV data the chart needs.
    ind = await fetchIndicators(ticker);
    if (!ind) ind = currentIndicators[ticker] || null;
    if (!price && ind?.price) price = ind.price;
  }

  // Build buy-ideas-style preview directly in directWlContent
  const resolvedName   = name || ind?.name || ticker;
  const resolvedSector = sector !== 'Other' ? sector : (ind?.sector || getSector(ticker) || 'Other');
  const priceColor = change?.startsWith('+') ? 'var(--green)' : change?.startsWith('-') ? 'var(--red)' : 'var(--text)';

  const indRows = [
    { label: 'RSI (14)',   val: ind?.rsi != null ? ind.rsi : '—',
      color: ind?.rsi != null ? (ind.rsi < 35 ? 'var(--green)' : ind.rsi > 65 ? 'var(--red)' : 'var(--text)') : 'var(--text3)' },
    { label: 'BB %B',      val: ind?.bb?.pct != null ? ind.bb.pct + '%' : '—',
      color: ind?.bb?.pct != null ? (ind.bb.pct < 20 ? 'var(--green)' : ind.bb.pct > 80 ? 'var(--red)' : 'var(--text)') : 'var(--text3)' },
    { label: 'MACD Hist',  val: ind?.macd?.histogram != null ? (ind.macd.histogram > 0 ? '▲ ' : '▼ ') + ind.macd.histogram.toFixed(3) : '—',
      color: ind?.macd?.histogram != null ? (ind.macd.histogram > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)' },
    { label: 'SMA 50',     val: ind?.sma50 != null ? '$' + ind.sma50.toFixed(2) : '—', color: 'var(--text)' },
    { label: 'SMA 200',    val: ind?.sma200 != null ? '$' + ind.sma200.toFixed(2) : '—', color: 'var(--text)' },
    { label: 'Vol ratio',  val: ind?.volRatio != null ? (ind.volRatio * 100).toFixed(0) + '% of avg' : '—',
      color: ind?.volRatio > 1.3 ? 'var(--green)' : 'var(--text)' },
  ];

  // Signal pills
  const buySigs  = ind?.buySignals  || [];
  const sellSigs = ind?.sellSignals || [];

  // Set up wl chart state for the preview chart
  wlChartTicker    = ticker;
  wlChartRange     = 1;
  wlChartMom       = 'rsi';
  wlChartAddedDate = null; // not added yet — no marker

  $('directWlContent').innerHTML = `
    <div class="modal-title">${ticker}
      <span style="font-size:14px;color:var(--text3);font-weight:400;margin-left:6px">${resolvedName}</span>
    </div>
    <div class="modal-subtitle" style="margin-bottom:12px">${resolvedSector}</div>

    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px">
      <div>
        <div style="font-size:30px;font-weight:700;color:${priceColor}">
          ${price != null ? '$' + price.toFixed(2) : '—'}
        </div>
        ${change ? `<div style="font-size:13px;color:${priceColor}">${change} today</div>` : ''}
      </div>
      ${buySigs.length || sellSigs.length ? `
      <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">
        ${buySigs.map(s => `<span class="pill pill-green" style="font-size:10px">${s}</span>`).join('')}
        ${sellSigs.map(s => `<span class="pill pill-red" style="font-size:10px">⚠ ${s}</span>`).join('')}
      </div>` : ''}
    </div>

    <!-- Chart -->
    <div style="margin-bottom:14px">${chartControlsHTML('wl')}</div>

    <!-- Indicator grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      ${indRows.map(r => `
      <div style="background:var(--bg3);border-radius:10px;padding:10px 12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px">${r.label}</div>
        <div style="font-size:15px;font-weight:600;color:${r.color}">${r.val}</div>
      </div>`).join('')}
    </div>

    <div style="background:var(--bg3);border-radius:12px;padding:11px 13px;margin-bottom:16px;font-size:12px;color:var(--text3)">
      These indicator values will be saved as your <strong style="color:var(--text2)">baseline</strong> so StockPulse can track changes over time after you add this ticker.
    </div>

    <button class="btn-primary" onclick="confirmAddToWatchlist('${ticker}','${resolvedName.replace(/'/g,"\'")}','${resolvedSector}')">
      + Add ${ticker} to Watchlist
    </button>
    <button class="btn-secondary" style="margin-top:8px" onclick="$('directWlModal').classList.remove('open')">Cancel</button>
  `;

  // Ensure indicatorCache is warm (fetchIndicators above populates it,
  // but call again in case it returned from a non-caching path)
  if (settings.apiKey && settings.pwaSecret) {
    const upper = ticker.toUpperCase();
    if (!indicatorCache[upper] || Date.now() - indicatorCache[upper].ts > 3600000) {
      await fetchIndicators(upper);
    }
  }
  // Render the preview chart
  renderTwoPanel(wlChartTicker, wlChartRange, wlChartMom, 'wl');
  ['1','3','6'].forEach(m => {
    const b = document.getElementById('wlRangeBtn'+m);
    if (b) b.style.cssText = m == wlChartRange
      ? 'padding:4px 12px;border-radius:8px;border:0.5px solid var(--accent);font-size:11px;font-weight:600;cursor:pointer;background:var(--accent);color:#fff'
      : 'padding:4px 12px;border-radius:8px;border:0.5px solid var(--border2);font-size:11px;font-weight:600;cursor:pointer;background:var(--bg3);color:var(--text2)';
  });
  ['rsi','macd'].forEach(m => {
    const b = document.getElementById('wlMomBtn'+m);
    if (b) b.style.cssText = m === wlChartMom
      ? 'padding:4px 11px;border-radius:8px;border:0.5px solid var(--accent);font-size:11px;font-weight:600;cursor:pointer;text-transform:uppercase;background:var(--accent);color:#fff'
      : 'padding:4px 11px;border-radius:8px;border:0.5px solid var(--border2);font-size:11px;font-weight:600;cursor:pointer;text-transform:uppercase;background:var(--bg3);color:var(--text2)';
  });
}

// Called from the preview — adds to watchlist then closes the modal
async function confirmAddToWatchlist(ticker, name, sector) {
  await addToWatchlist(ticker, name, sector);
  $('directWlModal').classList.remove('open');
}

// ─── Edit Watchlist Entry Metadata ────────────────────────────────────────────
function openEditWatchlistModal(ticker) {
  const w = watchlist.find(x => x.ticker === ticker.toUpperCase());
  if (!w) return;
  const sectorOptions = ['Other','Information Technology','Health Care','Financials',
    'Consumer Discretionary','Communication Services','Industrials','Consumer Staples',
    'Energy','Utilities','Real Estate','Materials'];

  $('editMetaContent').innerHTML = `
    <div class="modal-title">Edit Watchlist Entry</div>
    <div class="modal-subtitle">Update metadata for ${w.ticker}</div>
    <div class="field-row">
      <div class="field"><label>TICKER</label><input id="ew-ticker" value="${w.ticker}" readonly style="opacity:0.5"/></div>
      <div class="field"><label>COMPANY NAME</label><input id="ew-name" value="${w.name || ''}" placeholder="e.g. Apple Inc."/></div>
    </div>
    <div class="field">
      <label>SECTOR</label>
      <select id="ew-sector">
        ${sectorOptions.map(s => `<option value="${s}" ${(w.sector||'Other')===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="detail-section" style="margin-top:14px">
      <div class="detail-section-title">Current indicators (editable baseline)</div>
      <div class="field-row">
        <div class="field"><label>RSI</label><input id="ew-rsi" type="number" step="0.1" value="${w.current?.rsi ?? ''}"/></div>
        <div class="field"><label>BB %B</label><input id="ew-bb" type="number" step="0.1" value="${w.current?.bb ?? ''}"/></div>
      </div>
      <div class="field-row">
        <div class="field"><label>SMA 50</label><input id="ew-sma50" type="number" step="0.01" value="${w.current?.sma50 ?? ''}"/></div>
        <div class="field"><label>SMA 200</label><input id="ew-sma200" type="number" step="0.01" value="${w.current?.sma200 ?? ''}"/></div>
      </div>
      <div class="field"><label>MACD HISTOGRAM</label><input id="ew-macd" type="number" step="0.001" value="${w.current?.macd ?? ''}"/></div>
    </div>
    <button class="btn-primary" onclick="saveEditWatchlist('${w.ticker}')">Save changes</button>
    <button class="btn-secondary" onclick="$('editMetaModal').classList.remove('open')">Cancel</button>
  `;
  $('editMetaModal').classList.add('open');
  $('editMetaModal').onclick = e => { if (e.target === $('editMetaModal')) $('editMetaModal').classList.remove('open'); };
}

function saveEditWatchlist(ticker) {
  const idx = watchlist.findIndex(x => x.ticker === ticker.toUpperCase());
  if (idx === -1) return;
  const w = watchlist[idx];
  const name = $('ew-name').value.trim();
  const sector = $('ew-sector').value;
  const rsi = parseFloat($('ew-rsi').value) || null;
  const bb = parseFloat($('ew-bb').value) || null;
  const sma50 = parseFloat($('ew-sma50').value) || null;
  const sma200 = parseFloat($('ew-sma200').value) || null;
  const macd = parseFloat($('ew-macd').value);
  const macdVal = isNaN(macd) ? w.current?.macd ?? null : macd;

  watchlist[idx] = {
    ...w,
    name: name || w.ticker,
    sector,
    current: { ...w.current, rsi, bb, sma50, sma200, macd: macdVal, ts: Date.now() },
  };
  saveWatchlist();
  $('editMetaModal').classList.remove('open');
  renderWatchlist();
  showToast(`${ticker} updated ✓`);
}


function updateWlBadge() {
  const badge = $('badge-watchlist');
  if (!badge) return;
  if (watchlist.length > 0) { badge.textContent = watchlist.length; badge.style.display = 'inline-block'; }
  else badge.style.display = 'none';
}

async function renderWatchlist() {
  renderWatchlistCards();
  renderCorrView();
  if (settings.apiKey && settings.pwaSecret && watchlist.length > 0) {
    const stale = watchlist.some(w => !w.current?.ts || Date.now() - w.current.ts > 3600000);
    if (stale) {
      await refreshWatchlistPrices();
      renderWatchlistCards();
      renderCorrView();
    }
  }
}

// ─── Correlation Analysis ─────────────────────────────────────────────────────
let corrGroupBy = 'all';

function computeCorrelations() {
  if (watchlist.length < 2) return null;
  const rows = watchlist.map(w => ({
    ticker: w.ticker, sector: w.sector || 'Other',
    price:  wlDelta(w.snapshot, w.current, 'price'),
    rsi:    wlDelta(w.snapshot, w.current, 'rsi'),
    bb:     wlDelta(w.snapshot, w.current, 'bb'),
    macd:   wlDelta(w.snapshot, w.current, 'macd'),
    sma50:  wlDelta(w.snapshot, w.current, 'sma50'),
    sma200: wlDelta(w.snapshot, w.current, 'sma200'),
  })).filter(r => r.price !== null);
  if (rows.length < 2) return null;

  const fields = ['price','rsi','bb','macd','sma50','sma200'];
  const labels = ['Price %','RSI Δ','BB Δ','MACD Δ','SMA50 Δ','SMA200 Δ'];

  function pearson(a, b) {
    const pairs = a.map((v,i)=>[v,b[i]]).filter(([x,y])=>x!=null&&y!=null);
    if (pairs.length < 2) return null;
    const n = pairs.length;
    const mx = pairs.reduce((s,[x])=>s+x,0)/n, my = pairs.reduce((s,[,y])=>s+y,0)/n;
    let num=0,dx=0,dy=0;
    pairs.forEach(([x,y])=>{num+=(x-mx)*(y-my);dx+=(x-mx)**2;dy+=(y-my)**2;});
    return (dx===0||dy===0) ? null : num/Math.sqrt(dx*dy);
  }

  const matrix = fields.map((f1,i) => ({
    label: labels[i],
    values: fields.map(f2 => pearson(rows.map(r=>r[f1]), rows.map(r=>r[f2])))
  }));

  const insights = [];
  fields.forEach((f1,i) => fields.forEach((f2,j) => {
    if (j <= i) return;
    const v = matrix[i].values[j];
    if (v !== null && Math.abs(v) >= 0.5) insights.push({ f1:labels[i], f2:labels[j], corr:v });
  }));
  insights.sort((a,b) => Math.abs(b.corr)-Math.abs(a.corr));

  const sectors = {};
  rows.forEach(r => { if (!sectors[r.sector]) sectors[r.sector]=[]; sectors[r.sector].push(r.price); });
  const sectorAvg = Object.entries(sectors).map(([s,vals])=>({ sector:s, avg:vals.reduce((a,b)=>a+b,0)/vals.length, count:vals.length })).sort((a,b)=>b.avg-a.avg);

  return { matrix, labels, insights, sectorAvg, sorted:[...rows].sort((a,b)=>(b.price||0)-(a.price||0)) };
}

function corrCellColor(v) {
  if (v === null) return 'rgba(255,255,255,0.04)';
  const alpha = (Math.abs(v)*0.65+0.1).toFixed(2);
  return v > 0 ? `rgba(0,201,122,${alpha})` : `rgba(255,77,77,${alpha})`;
}

function setCorrGroup(group) { corrGroupBy = group; renderCorrView(); }

function renderCorrView() {
  const el = $('corrView');
  if (!el) return;
  if (watchlist.length === 0) { el.innerHTML = ''; return; }
  if (watchlist.length < 2) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📊</div><div class="empty-title">Add 2+ stocks to see correlations</div></div>`;
    return;
  }
  const data = computeCorrelations();
  if (!data) { el.innerHTML = `<div style="font-size:13px;color:var(--text3);padding:20px 0">Not enough data yet — prices still loading.</div>`; return; }

  const filterHTML = `<div class="corr-filter-bar">
    <button class="corr-filter-btn ${corrGroupBy==='all'?'active':''}" onclick="setCorrGroup('all')">Correlation matrix</button>
    <button class="corr-filter-btn ${corrGroupBy==='sector'?'active':''}" onclick="setCorrGroup('sector')">By sector</button>
    <button class="corr-filter-btn ${corrGroupBy==='return'?'active':''}" onclick="setCorrGroup('return')">By return</button>
  </div>`;

  let bodyHTML = '';
  if (corrGroupBy === 'sector') {
    bodyHTML = data.sectorAvg.map(s => {
      const c = s.avg >= 0 ? 'var(--green)' : 'var(--red)';
      return `<div class="corr-insight-card"><div style="display:flex;justify-content:space-between;align-items:center"><div class="corr-insight-title">${s.sector}</div><div style="font-size:16px;font-weight:700;color:${c}">${s.avg>=0?'+':''}${s.avg.toFixed(2)}%</div></div><div class="corr-insight-desc">${s.count} stock${s.count>1?'s':''} tracked</div></div>`;
    }).join('');
  } else if (corrGroupBy === 'return') {
    bodyHTML = data.sorted.map((r,i) => {
      const c = r.price >= 0 ? 'var(--green)' : 'var(--red)';
      const w = watchlist.find(x=>x.ticker===r.ticker);
      return `<div class="corr-insight-card"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="corr-insight-title">${i+1}. ${r.ticker}</div><div style="font-size:11px;color:var(--text3)">${w?.sector||'—'} · RSI Δ ${fmtDelta(r.rsi,'rsi',1)}</div></div><div style="text-align:right"><div style="font-size:16px;font-weight:700;color:${c}">${r.price>=0?'+':''}${r.price.toFixed(2)}%</div><div style="font-size:11px;color:var(--text3)">BB Δ ${fmtDelta(r.bb,'bb',1)}</div></div></div></div>`;
    }).join('');
  } else {
    bodyHTML = `<div class="corr-matrix-wrap"><table class="corr-table">
      <thead><tr><th></th>${data.labels.map(l=>`<th>${l}</th>`).join('')}</tr></thead>
      <tbody>${data.matrix.map(row=>`<tr><td>${row.label}</td>${row.values.map(v=>`<td><div class="corr-cell" style="background:${corrCellColor(v)};color:${v!==null?'var(--text)':'var(--text3)'}">${v!==null?(v>0?'+':'')+v.toFixed(2):'—'}</div></td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`
    + (data.insights.length > 0
      ? `<div class="corr-section-title">Key correlations</div>`
        + data.insights.slice(0,5).map(ins => {
            const strength = Math.abs(ins.corr)>=0.8?'Strong':Math.abs(ins.corr)>=0.6?'Moderate':'Mild';
            const dir = ins.corr>0?'positive':'negative';
            const c = ins.corr>0?'var(--green)':'var(--red)';
            return `<div class="corr-insight-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div class="corr-insight-title">${ins.f1} ↔ ${ins.f2}</div><div style="font-size:14px;font-weight:700;color:${c}">${ins.corr.toFixed(2)}</div></div><div class="corr-insight-desc">${strength} ${dir} correlation. When ${ins.f1} moved, ${ins.f2} tended to move in the ${dir==='positive'?'same':'opposite'} direction.</div></div>`;
          }).join('')
      : `<div style="font-size:13px;color:var(--text3);padding:12px 0">No strong correlations detected yet — add more stocks or wait for price data.</div>`);
  }
  el.innerHTML = filterHTML + bodyHTML;
}
