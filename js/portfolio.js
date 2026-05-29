// ─── Portfolio Rendering ──────────────────────────────────────────────────────
let currentIndicators = {};

function renderHealthPanel() {
  if (positions.length === 0) {
    $('healthPanel').style.display = 'none';
    return;
  }
  $('healthPanel').style.display = 'block';

  const maxPos = settings.maxPos || 10;
  const maxSector = settings.maxSector || 30;
  const { bySector, byPosition, sectorColors } = computeConcentration();

  const posWarnings = byPosition.filter(p => p.pct > maxPos).length;
  const sectorWarnings = Object.entries(bySector).filter(([,pct]) => pct > maxSector).length;
  const totalWarnings = posWarnings + sectorWarnings;

  const badge = $('healthAlertBadge');
  if (totalWarnings > 0) {
    badge.style.display = 'inline-flex';
    badge.textContent = totalWarnings + ' risk' + (totalWarnings > 1 ? 's' : '');
  } else {
    badge.style.display = 'none';
  }

  const sectors = Object.entries(bySector).sort((a, b) => b[1] - a[1]);
  const cx = 50, cy = 50, r = 38, strokeW = 14;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const svgArcs = sectors.map(([sector, pct]) => {
    const dash = pct / 100 * circumference;
    const gap = circumference - dash;
    const color = sectorColors[sector];
    const arc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeW}"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      stroke-dashoffset="${(-offset * circumference / 100 + circumference / 4).toFixed(2)}"
      style="transition: stroke-dasharray 0.4s ease"/>`;
    offset += pct;
    return arc;
  }).join('');

  $('donutSvg').innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg4)" stroke-width="${strokeW}"/>
    ${svgArcs}
    <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="sans-serif">${sectors.length}</text>
    <text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="sans-serif">sectors</text>
  `;

  $('donutLegend').innerHTML = sectors.map(([sector, pct]) => {
    const over = pct > maxSector;
    return `<div class="legend-item">
      <div class="legend-dot" style="background:${sectorColors[sector]}"></div>
      <span class="legend-label">${sector}</span>
      <span class="legend-pct">${pct.toFixed(1)}%${over ? '<span class="legend-warn">⚠</span>' : ''}</span>
    </div>`;
  }).join('');

  $('allocBars').innerHTML = byPosition.map(p => {
    const over = p.pct > maxPos;
    const under = p.pct < 1;
    const barColor = over ? 'var(--red)' : under ? 'var(--text3)' : 'var(--accent)';
    const warning = over ? `<span style="font-size:10px;color:var(--red)">⚠ Oversized</span>`
                  : under ? `<span style="font-size:10px;color:var(--text3)">Too small</span>` : '';
    return `<div class="alloc-row">
      <div class="alloc-top">
        <span class="alloc-ticker">${p.ticker}</span>
        <div class="alloc-right">${warning}<span>${p.pct.toFixed(1)}%</span></div>
      </div>
      <div class="alloc-track">
        <div class="alloc-fill" style="width:${Math.min(p.pct, 100)}%;background:${barColor}"></div>
      </div>
    </div>`;
  }).join('');
}

function toggleHealth() {
  const body = $('healthBody');
  const chevron = $('healthChevron');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  chevron.classList.toggle('open', !isOpen);
}

function renderPortfolioWithRSIs(rsiMap) {
  currentIndicators = rsiMap;
  const el = $('positionsList');
  const sigAlert = settings.sigAlert;
  const sigWarn = settings.sigWarn;

  if (positions.length === 0) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📈</div><div class="empty-title">No positions yet</div><div class="empty-sub">Tap "Add position" to start tracking your portfolio.</div></div>`;
    $('totalValue').textContent = '$0.00';
    $('totalReturn').textContent = '—';
    $('alertPill').style.display = 'none';
    return;
  }

  let totalVal = 0, totalCost = 0, alertCount = 0;
  el.innerHTML = positions.map((p, i) => {
    const val = p.shares * p.price;
    const cost = p.shares * p.cost;
    const gain = val - cost;
    const pnlPct = ((p.price - p.cost) / p.cost * 100);
    const ind = rsiMap[p.ticker.toUpperCase()] ?? null;
    const rsi = ind?.rsi ?? null;
    const sellCount = ind?.sellSignals?.length ?? 0;
    const isAlert = sellCount >= 2 || pnlPct > sigAlert;
    const isWarn = !isAlert && (sellCount === 1 || pnlPct > sigWarn);
    if (isAlert) alertCount++;
    totalVal += val; totalCost += cost;

    const cardClass = isAlert ? 'pos-card sell-alert' : isWarn ? 'pos-card sell-warn' : 'pos-card';
    const holdLabel = holdingLabel(p.purchaseDate);
    const lt = isLongTerm(p.purchaseDate);
    const taxInfo = calcTax(gain, p.purchaseDate);

    const pnlColor = pnlPct >= 0 ? 'var(--green)' : 'var(--red)';
    const rsiC = rsi !== null ? rsiColor(rsi) : 'var(--text3)';
    const rsiText = rsi !== null ? `${rsi} · ${rsiLabel(rsi)}` : 'Loading…';
    const rsiW = rsi !== null ? rsi + '%' : '50%';

    const bbPct = ind?.bb?.pct ?? null;
    const bbC = bbPct !== null ? (bbPct > 80 ? 'var(--red)' : bbPct < 20 ? 'var(--green)' : 'var(--text2)') : 'var(--text3)';
    const bbText = bbPct !== null ? `${bbPct}% · ${bbPct > 80 ? 'Near upper' : bbPct < 20 ? 'Near lower' : 'Mid-band'}` : 'Loading…';

    const macdH = ind?.macd?.histogram ?? null;
    const macdC = macdH !== null ? (macdH > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)';
    const macdMomentum = ind?.macd?.momentumLabel ?? null;
    const macdDiv = ind?.macd?.divergenceType ?? null;
    let macdText = macdH !== null ? (macdH > 0 ? '▲ Bullish' : '▼ Bearish') : 'Loading…';
    if (macdMomentum && macdMomentum !== 'Flat') macdText += ` · ${macdMomentum}`;
    else if (macdDiv === 'bullish') macdText += ' · Div ↑';
    else if (macdDiv === 'bearish') macdText += ' · Div ↓';
    const macdBarW = macdH !== null ? Math.min(Math.abs(macdH) * 200, 100) + '%' : '50%';

    const alertPill = isAlert ? `<span class="pill pill-red">Sell signal</span>` : isWarn ? `<span class="pill pill-amber">Watch</span>` : '';
    const termPill = p.purchaseDate ? `<span class="pill ${lt ? 'pill-green' : 'pill-amber'}" style="font-size:10px">${lt ? 'Long-term' : 'Short-term'}</span>` : '';
    const taxLine = taxInfo ? `<div class="tax-row"><span class="tax-label">Est. tax if sold today</span><span class="tax-val" style="color:var(--red)">${fmtUSD(taxInfo.taxDue)} <span style="color:var(--text3);font-weight:400;font-size:10px">(${taxInfo.totalRate}%)</span></span></div>` : '';

    return `<div class="${cardClass}" onclick="openDetail(${i})">
      <div class="pos-row1">
        <div>
          <div class="pos-ticker-wrap">
            <span class="pos-ticker">${p.ticker}</span>
            ${alertPill}
          </div>
          <div class="pos-name">${p.name || ''} ${termPill}</div>
        </div>
        <div class="pos-right">
          <div class="pos-price">${fmtUSD(p.price)}</div>
          <div class="pos-val" style="color:${pnlColor}">${pnlPct >= 0 ? '+' : ''}${fmt(pnlPct)}% · ${fmtUSD(val)}</div>
          <div class="pos-val" style="color:var(--text3);font-size:11px">${annualizedLabel(pnlPct, p.purchaseDate)}</div>        
        </div>
      </div>
      <div class="indicators">
        <div class="ind">
          <div class="ind-label">RSI (14)</div>
          <div class="ind-track"><div class="ind-fill" style="width:${rsiW};background:${rsiC}"></div></div>
          <div class="ind-val" style="color:${rsiC}">${rsiText}</div>
        </div>
        <div class="ind">
          <div class="ind-label">Bollinger %B</div>
          <div class="ind-track"><div class="ind-fill" style="width:${bbPct !== null ? bbPct+'%' : '50%'};background:${bbC}"></div></div>
          <div class="ind-val" style="color:${bbC}">${bbText}</div>
        </div>
        <div class="ind">
          <div class="ind-label">MACD</div>
          <div class="ind-track"><div class="ind-fill" style="width:${macdBarW};background:${macdC}"></div></div>
          <div class="ind-val" style="color:${macdC}">${macdText}</div>
        </div>
      </div>
      ${taxLine}
    </div>`;
  }).join('');

  const totalPnl = totalCost > 0 ? (totalVal - totalCost) / totalCost * 100 : 0;
  const totalGain = totalVal - totalCost;
  $('totalValue').textContent = fmtUSD(totalVal);
  $('totalReturn').innerHTML = `<span style="color:${totalGain >= 0 ? 'var(--green)' : 'var(--red)'}">${totalGain >= 0 ? '+' : ''}${fmtUSD(totalGain)} (${fmt(totalPnl)}%)</span>`;

  const pill = $('alertPill');
  if (alertCount > 0) { pill.style.display = 'inline-flex'; pill.textContent = alertCount + ' sell signal' + (alertCount > 1 ? 's' : ''); }
  else { pill.style.display = 'none'; }

  const badge = $('badge-alerts');
  if (badge) {
    if (alertCount > 0) { badge.textContent = alertCount; badge.style.display = 'inline-block'; }
    else badge.style.display = 'none';
  }

  renderHealthPanel();
}

function annualizedReturn(pnlPct, dateStr) {
  const days = daysSince(dateStr);
  if (!days || days < 1) return null;
  // CAGR formula
  return (Math.pow(1 + pnlPct / 100, 365 / days) - 1) * 100;
}

function annualizedLabel(pnlPct, dateStr) {
  const ann = annualizedReturn(pnlPct, dateStr);
  if (ann === null) return '';
  return `${ann >= 0 ? '+' : ''}${fmt(ann)}% annualized`;
}

async function renderPortfolio() {
  renderPortfolioWithRSIs(currentIndicators);
  if (positions.length === 0) return;
  const tickers = [...new Set(positions.map(p => p.ticker.toUpperCase()))];
  const rsiMap = await fetchAllIndicators(tickers);
  renderPortfolioWithRSIs(rsiMap);
}

function renderAll() { renderPortfolio(); }

// ─── Detail Modal ─────────────────────────────────────────────────────────────
function openDetail(idx) {
  const p = positions[idx];
  if (!p) return;
  posChartTicker = p.ticker.toUpperCase();
  posChartRange = 1; posChartMom = 'rsi';
  const ind = currentIndicators[p.ticker.toUpperCase()] ?? null;
  const rsi = ind?.rsi ?? null;
  const val = p.shares * p.price;
  const costBasis = p.shares * p.cost;
  const gain = val - costBasis;
  const pnlPct = (p.price - p.cost) / p.cost * 100;
  const lt = isLongTerm(p.purchaseDate);
  const taxInfo = calcTax(gain, p.purchaseDate);

  const stTax = gain > 0 ? gain * ((settings.stRate + settings.stateRate) / 100) : 0;
  const ltTax = gain > 0 ? gain * ((settings.ltRate + settings.stateRate) / 100) : 0;

  let taxHTML = '';
  if (gain > 0) {
    taxHTML = `<div class="detail-section"> <div class="detail-section-title">Tax implications — if sold today</div> <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px"> <div class="tax-scenario" style="${lt ? 'border:1px solid rgba(0,201,122,0.3)' : ''}"> <div class="tax-scenario-title" style="color:${lt ? 'var(--green)' : 'var(--text3)'}">Long-term ${lt ? '✓ Applies' : '(not yet)'}</div> <div class="tax-big" style="color:var(--red)">${fmtUSD(ltTax)}</div> <div style="font-size:11px;color:var(--text3);margin-top:4px">${settings.ltRate}% fed + ${settings.stateRate}% state = ${settings.ltRate + settings.stateRate}%</div> <div style="font-size:12px;color:var(--green);margin-top:6px">Net: ${fmtUSD(gain - ltTax)}</div> </div> <div class="tax-scenario" style="${!lt ? 'border:1px solid rgba(245,166,35,0.3)' : ''}"> <div class="tax-scenario-title" style="color:${!lt ? 'var(--amber)' : 'var(--text3)'}">Short-term ${!lt ? '✓ Applies' : '(was applicable)'}</div> <div class="tax-big" style="color:var(--red)">${fmtUSD(stTax)}</div> <div style="font-size:11px;color:var(--text3);margin-top:4px">${settings.stRate}% fed + ${settings.stateRate}% state = ${settings.stRate + settings.stateRate}%</div> <div style="font-size:12px;color:var(--green);margin-top:6px">Net: ${fmtUSD(gain - stTax)}</div> </div> </div> ${p.purchaseDate && !lt ?`<div style="background:var(--amber-bg);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--amber)">⚠️ Holding ${holdingLabel(p.purchaseDate)} — wait until ${new Date(new Date(p.purchaseDate+'T00:00:00').getTime() + 366*86400000).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} for long-term rate. Tax savings: ${fmtUSD(stTax - ltTax)}.</div>`: ''} ${lt ?`<div style="background:var(--green-bg);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--green)">✓ Held over 1 year — long-term capital gains rate applies. Savings vs. short-term: ${fmtUSD(stTax - ltTax)}.</div>` : ''} </div>`;
  } else if (gain < 0) {
    taxHTML = `<div class="detail-section"> <div class="detail-section-title">Tax implications</div> <div style="background:var(--green-bg);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--green)"> This position has an unrealized loss of ${fmtUSD(Math.abs(gain))}. Selling would harvest a tax loss you can use to offset other gains (tax-loss harvesting). </div> </div>`;
  }

  const macdMomentumRow = ind?.macd ? (() => {
    const m = ind.macd;
    const slopeStr = m.slope != null ? (m.slope > 0 ? '+' : '') + m.slope.toFixed(4) + '/bar' : '—';
    const rocStr = m.roc != null ? (m.roc > 0 ? '+' : '') + m.roc.toFixed(2) + '%' : '—';
    const divColor = m.divergenceType === 'bullish' ? 'var(--green)' : m.divergenceType === 'bearish' ? 'var(--red)' : 'var(--text3)';
    const divLabel = m.divergenceType === 'bullish' ? '▲ Bullish divergence' : m.divergenceType === 'bearish' ? '▼ Bearish divergence' : m.divergenceType === 'none' ? 'None' : '—';
    const momColor = m.momentumLabel?.includes('↑') ? 'var(--green)' : m.momentumLabel?.includes('↓') ? 'var(--red)' : 'var(--text3)';
    return `<div class="detail-row"><span class="label">MACD momentum</span><span class="val" style="color:${momColor}">${m.momentumLabel || '—'}</span></div>
    <div class="detail-row"><span class="label">MACD slope</span><span class="val" style="color:${momColor}">${slopeStr}</span></div>
    <div class="detail-row"><span class="label">MACD rate of change</span><span class="val">${rocStr}</span></div>
    <div class="detail-row"><span class="label">MACD divergence</span><span class="val" style="color:${divColor}">${divLabel}</span></div>`;
  })() : '';

  $('detailContent').innerHTML = `<div class="modal-title">${p.ticker} <span style="font-size:14px;color:var(--text3);font-weight:400">${p.name || ''}</span></div> <div class="modal-subtitle" style="display:flex;align-items:center;justify-content:space-between">${p.sector || 'Other'}<button class="edit-meta-btn" onclick="openEditPositionModal(${idx})">✏️ Edit</button></div> <div class="detail-section"> <div class="detail-section-title">Position summary</div> <div class="detail-row"><span class="label">Shares</span><span class="val">${fmt(p.shares, 4)}</span></div> <div class="detail-row"><span class="label">Avg cost</span><span class="val">${fmtUSD(p.cost)}</span></div> <div class="detail-row"><span class="label">Current price</span><span class="val">${fmtUSD(p.price)}</span></div> <div class="detail-row"><span class="label">Market value</span><span class="val">${fmtUSD(val)}</span></div> <div class="detail-row"><span class="label">Cost basis</span><span class="val">${fmtUSD(costBasis)}</span></div> <div class="detail-row"><span class="label">Unrealized gain/loss</span><span class="val" style="color:${gain >= 0 ? 'var(--green)' : 'var(--red)'}">${gain >= 0 ? '+' : ''}${fmtUSD(gain)} (${fmt(pnlPct)}%)</span></div> <div class="detail-row"><span class="label">Purchase date</span><span class="val">${p.purchaseDate ? new Date(p.purchaseDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}</span></div> <div class="detail-row"><span class="label">Annualized return</span><span class="val" style="color:${gain >= 0 ? 'var(--green)' : 'var(--red)'}">${annualizedLabel(pnlPct, p.purchaseDate) || '—'}</span></div><div class="detail-row"><span class="label">Holding period</span><span class="val">${holdingLabel(p.purchaseDate)} <span class="pill ${lt ? 'pill-green' : 'pill-amber'}" style="font-size:10px">${lt ? 'Long-term' : 'Short-term'}</span></span></div> </div> <div class="detail-section"> <div class="detail-section-title">Technical signals</div> <div class="detail-row"><span class="label">RSI (14)</span><span class="val" style="color:${rsi !== null ? rsiColor(rsi) : 'var(--text3)'}">${rsi !== null ? rsi + ' · ' + rsiLabel(rsi) : 'Unavailable'}</span></div> <div class="detail-row"><span class="label">SMA 50 / 200</span><span class="val" style="color:var(--text2)">${ind?.sma50 ? '$'+ind.sma50.toFixed(2) : '—'} / ${ind?.sma200 ? '$'+ind.sma200.toFixed(2) : '—'}</span></div> <div class="detail-row"><span class="label">MA trend</span><span class="val">${ind?.sma50 && ind?.sma200 ? (ind.sma50 > ind.sma200 ? '🟢 Golden cross' : '🔴 Death cross') : '—'}</span></div> <div class="detail-row"><span class="label">Bollinger %B</span><span class="val" style="color:${ind?.bb ? (ind.bb.pct > 80 ? 'var(--red)' : ind.bb.pct < 20 ? 'var(--green)' : 'var(--text2)') : 'var(--text3)'}">${ind?.bb ? ind.bb.pct + '% (' + (ind.bb.pct > 80 ? 'near upper band' : ind.bb.pct < 20 ? 'near lower band' : 'mid-band') + ')' : 'Unavailable'}</span></div> <div class="detail-row"><span class="label">MACD</span><span class="val" style="color:${ind?.macd?.histogram != null ? (ind.macd.histogram > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)'}">${ind?.macd?.histogram != null ? (ind.macd.histogram > 0 ? '▲ Bullish histogram' : '▼ Bearish histogram') : 'Unavailable'}</span></div> ${macdMomentumRow} <div class="detail-row"><span class="label">Volume vs avg</span><span class="val" style="color:${ind?.volRatio != null ? (ind.volRatio > 1.5 ? 'var(--amber)' : 'var(--text2)') : 'var(--text3)'}">${ind?.volRatio != null ? (ind.volRatio * 100).toFixed(0) + '% of 20-day avg' : 'Unavailable'}</span></div> <div class="detail-row"><span class="label">Sell signals</span><span class="val" style="color:${ind?.sellSignals?.length ? 'var(--red)' : 'var(--green)'}">${ind?.sellSignals?.length ? ind.sellSignals.join(', ') : '✓ None'}</span></div> <div class="detail-row"><span class="label">Buy signals</span><span class="val" style="color:${ind?.buySignals?.length ? 'var(--green)' : 'var(--text3)'}">${ind?.buySignals?.length ? ind.buySignals.join(', ') : 'None'}</span></div> </div> ${taxHTML} <div class="detail-section"> <div class="detail-section-title">Charts</div> ${chartControlsHTML('pos')} </div> <button class="delete-btn" onclick="deletePosition(${idx})">Remove position</button> <button class="btn-secondary" onclick="closeDetail()">Close</button>`;
  $('detailModal').classList.add('open');
  renderTwoPanel(posChartTicker, posChartRange, posChartMom, 'pos');
}

function closeDetail() { $('detailModal').classList.remove('open'); }

// ─── Edit Position Metadata Modal ─────────────────────────────────────────────
function openEditPositionModal(idx) {
  const p = positions[idx];
  if (!p) return;
  const sectorOptions = ['Other','Information Technology','Health Care','Financials',
    'Consumer Discretionary','Communication Services','Industrials','Consumer Staples',
    'Energy','Utilities','Real Estate','Materials'];
  $('editMetaContent').innerHTML = `
    <div class="modal-title">Edit Position</div>
    <div class="modal-subtitle">Update metadata for ${p.ticker}</div>
    <div class="field-row">
      <div class="field"><label>TICKER</label><input id="em-ticker" value="${p.ticker}" style="text-transform:uppercase" readonly/></div>
      <div class="field"><label>COMPANY NAME</label><input id="em-name" value="${p.name || ''}" placeholder="e.g. Apple Inc."/></div>
    </div>
    <div class="field">
      <label>SECTOR</label>
      <select id="em-sector">
        ${sectorOptions.map(s => `<option value="${s}" ${(p.sector||'Other')===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="field-row">
      <div class="field"><label>SHARES</label><input id="em-shares" type="number" step="0.0001" value="${p.shares}"/></div>
      <div class="field"><label>AVG COST / SHARE</label><input id="em-cost" type="number" step="0.01" value="${p.cost}"/></div>
    </div>
    <div class="field"><label>PURCHASE DATE</label><input id="em-date" type="date" value="${p.purchaseDate || ''}"/></div>
    <button class="btn-primary" onclick="saveEditPosition(${idx})">Save changes</button>
    <button class="btn-secondary" onclick="$('editMetaModal').classList.remove('open')">Cancel</button>
  `;
  $('editMetaModal').classList.add('open');
  $('editMetaModal').onclick = e => { if (e.target === $('editMetaModal')) $('editMetaModal').classList.remove('open'); };
}

function saveEditPosition(idx) {
  const p = positions[idx];
  if (!p) return;
  const name = $('em-name').value.trim();
  const sector = $('em-sector').value;
  const shares = parseFloat($('em-shares').value);
  const cost = parseFloat($('em-cost').value);
  const date = $('em-date').value;
  if (isNaN(shares) || shares <= 0) { showToast('Shares must be a positive number'); return; }
  if (isNaN(cost) || cost <= 0) { showToast('Cost must be a positive number'); return; }
  positions[idx] = { ...p, name: name || p.ticker, sector, shares, cost, purchaseDate: date || p.purchaseDate };
  save();
  $('editMetaModal').classList.remove('open');
  renderAll();
  // Reopen detail with fresh data
  setTimeout(() => openDetail(idx), 50);
  showToast(`${p.ticker} updated ✓`);
}

function deletePosition(idx) {
  const t = positions[idx].ticker;
  positions.splice(idx, 1);
  save();
  closeDetail();
  renderAll();
  showToast(`${t} removed`);
}

// ─── Alerts Rendering ─────────────────────────────────────────────────────────
function renderAlerts() {
  const el = $('alertsList');
  const sigAlert = settings.sigAlert;
  const sigWarn = settings.sigWarn;
  const alerts = positions.map((p, i) => {
    const ind = currentIndicators[p.ticker.toUpperCase()] ?? null;
    const pnl = (p.price - p.cost) / p.cost * 100;
    const gain = (p.price - p.cost) * p.shares;
    const taxInfo = calcTax(gain, p.purchaseDate);
    const sellCount = ind?.sellSignals?.length ?? 0;
    const totalVal = positions.reduce((s, q) => s + q.shares * q.price, 0);
    const posPct = totalVal > 0 ? (p.price * p.shares / totalVal * 100) : 0;
    const maxPos = settings.maxPos || 10;
    const isSizeAlert = posPct > maxPos;
    const isAlert = sellCount >= 2 || pnl > sigAlert || isSizeAlert;
    const isWarn = !isAlert && (sellCount === 1 || pnl > sigWarn);
    return { ...p, i, ind, pnl, gain, taxInfo, isAlert, isWarn, isSizeAlert, posPct };
  }).filter(p => p.isAlert || p.isWarn);

  if (alerts.length === 0) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">No signals right now</div><div class="empty-sub">All positions are within healthy indicator ranges. Check back daily.</div></div>`;
    return;
  }

  el.innerHTML = alerts.map(p => {
    const reasons = [...(p.ind?.sellSignals || [])];
    if (p.pnl > sigAlert) reasons.push(`Up ${fmt(p.pnl)}% — consider taking profits`);
    else if (p.pnl > sigWarn) reasons.push(`Up ${fmt(p.pnl)}% — watch for exit opportunity`);
    if (p.isSizeAlert) reasons.push(`${fmt(p.posPct)}% of portfolio — exceeds ${settings.maxPos || 10}% max position size`);

    const lt = isLongTerm(p.purchaseDate);
    const taxLine = p.taxInfo ? `<div class="alert-tax">
      If sold today: <strong style="color:var(--red)">${fmtUSD(p.taxInfo.taxDue)}</strong> in estimated ${lt ? 'long-term' : 'short-term'} cap gains tax
      (${p.taxInfo.fedRate}% fed${p.taxInfo.stateRate > 0 ? ' + ' + p.taxInfo.stateRate + '% state' : ''}) ·
      Net proceeds: <strong>${fmtUSD(p.gain - p.taxInfo.taxDue)}</strong>
    </div>` : '';

    return `<div class="${p.isAlert ? 'alert-card' : 'alert-card warn'}" onclick="openDetail(${p.i})">
      <div class="alert-ticker">
        ${p.ticker}
        <span class="pill ${p.isAlert ? 'pill-red' : 'pill-amber'}" style="font-size:10px">${p.isAlert ? 'Sell signal' : 'Watch'}</span>
        <span class="pill ${lt ? 'pill-green' : 'pill-amber'}" style="font-size:10px">${lt ? 'LT gains' : 'ST gains'}</span>
      </div>
      <div class="alert-desc">${reasons.join(' · ')}</div>
      ${taxLine}
    </div>`;
  }).join('');
}

// ─── Settings Rendering ───────────────────────────────────────────────────────
function renderSettings() {
  $('apiKeyInput').value = settings.apiKey || '';
  $('pwaSecretInput').value = settings.pwaSecret || '';
  $('anthropicKeyInput').value = settings.anthropicKey || '';
  $('watchlistInput').value = settings.watchlist || DEFAULT_WATCHLIST;
  $('stRateInput').value = settings.stRate || 32;
  $('ltRateInput').value = settings.ltRate || 15;
  $('stateRateInput').value = settings.stateRate || 0;
  $('maxPosInput').value = settings.maxPos || 10;
  $('maxSectorInput').value = settings.maxSector || 30;
  $('sigAlertInput').value = settings.maxPos || 100;
  $('sigWarnInput').value = settings.maxSector || 50;
  updateApiStatus(settings.apiKey && settings.pwaSecret ? null : false);
  if (settings.apiKey) checkWorkerStatus();
}
