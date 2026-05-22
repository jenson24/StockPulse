// ─── Watchlist Engine ─────────────────────────────────────────────────────────

function saveWatchlist() { localStorage.setItem('sp-watchlist', JSON.stringify(watchlist)); }

function isOnWatchlist(ticker) { return watchlist.some(w => w.ticker.toUpperCase() === ticker.toUpperCase()); }

function snapshotFromIndicators(ind, price) {
  if (!ind) return { price: price ?? null, rsi: null, bb: null, macd: null, sma50: null, sma200: null };
  return {
    price: price ?? ind.price ?? null,
    rsi: ind.rsi ?? null,
    bb: ind.bb?.pct ?? null,
    macd: ind.macd?.histogram ?? null,
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
      <div class="empty-sub">Add stocks from the Buy Ideas or position detail views to track how price and indicators change over time.</div>
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
        <div class="wl-delta"><div class="wl-delta-label">MACD Δ</div><div class="wl-delta-val" style="color:${deltaColor(macdDelta,'macd')}">${fmtDelta(macdDelta,'macd',3)}</div><div class="wl-delta-sub">Now: ${w.current?.macd != null ? (w.current.macd > 0 ? '▲' : '▼') : '—'}</div></div>
        <div class="wl-delta"><div class="wl-delta-label">SMA 50 Δ</div><div class="wl-delta-val" style="color:${deltaColor(sma50D,'sma50')}">${sma50D !== null ? (sma50D >= 0?'+':'')+' $'+Math.abs(sma50D).toFixed(2) : '—'}</div><div class="wl-delta-sub">Now: ${w.current?.sma50 ? '$'+w.current.sma50.toFixed(2) : '—'}</div></div>
        <div class="wl-delta"><div class="wl-delta-label">SMA 200 Δ</div><div class="wl-delta-val" style="color:${deltaColor(sma200D,'sma200')}">${sma200D !== null ? (sma200D >= 0?'+':'')+' $'+Math.abs(sma200D).toFixed(2) : '—'}</div><div class="wl-delta-sub">Now: ${w.current?.sma200 ? '$'+w.current.sma200.toFixed(2) : '—'}</div></div>
        <div class="wl-delta"><div class="wl-delta-label">Price Δ $</div><div class="wl-delta-val" style="color:${priceColor}">${basePrice && curPrice ? (curPrice>=basePrice?'+':'')+' $'+(curPrice-basePrice).toFixed(2) : '—'}</div><div class="wl-delta-sub">Base: ${basePrice ? '$'+basePrice.toFixed(2) : '—'}</div></div>
      </div>
    </div>`;
  }).join('');
}

function openWlDetail(ticker) {
  const w = watchlist.find(x => x.ticker === ticker.toUpperCase());
  if (!w) return;
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

  $('wlDetailContent').innerHTML = `
    <div class="modal-title">${w.ticker} <span style="font-size:14px;color:var(--text3);font-weight:400">${w.name}</span></div>
    <div class="modal-subtitle">${w.sector} · Added ${addedDate} (${daysAgo} day${daysAgo!==1?'s':''} ago)</div>
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
    <button class="delete-btn" onclick="removeFromWatchlist('${w.ticker}');$('wlDetailModal').classList.remove('open')">Remove from watchlist</button>
    <button class="btn-secondary" onclick="$('wlDetailModal').classList.remove('open')">Close</button>
  `;
  $('wlDetailModal').classList.add('open');
  $('wlDetailModal').onclick = e => { if (e.target === $('wlDetailModal')) $('wlDetailModal').classList.remove('open'); };
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
