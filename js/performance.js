// ─── StockPulse Performance Module ───────────────────────────────────────────
// Tracks trade-level performance for positions marked "tracked with StockPulse"
// Data model:
//   sp-trades: Array of trade log entries (buys + sells)
//   sp-perf-settings: { spyCache: {...}, spyCacheDate: '...' }
//
// Each trade entry:
// {
//   id: string (uuid),
//   positionId: string (ticker + purchaseDate as stable key),
//   ticker: string,
//   name: string,
//   type: 'buy' | 'sell',
//   shares: number,
//   price: number,           // price per share at time of trade
//   date: string,            // ISO date string YYYY-MM-DD
//   notes: string,
//   isFull: boolean,         // for sells: was this a full exit?
//   remainingShares: number, // snapshot of shares remaining after trade
// }

// ─── Storage helpers ──────────────────────────────────────────────────────────

function perfGetTrades() {
  return JSON.parse(localStorage.getItem('sp-trades') || '[]');
}

function perfSaveTrades(trades) {
  localStorage.setItem('sp-trades', JSON.stringify(trades));
}

function perfAddTrade(trade) {
  const trades = perfGetTrades();
  trade.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  trades.push(trade);
  perfSaveTrades(trades);
  return trade;
}

// Stable position key: ticker + original purchaseDate
function posKey(p) {
  return (p.ticker + '_' + (p.purchaseDate || 'nodate')).toUpperCase();
}

// ─── Track toggle helpers (reads/writes on position objects) ──────────────────

function isTracked(p) {
  // Default true — new positions are tracked unless explicitly opted out
  return p.tracked !== false;
}

function trackedPositions() {
  return (typeof positions !== 'undefined' ? positions : []).filter(isTracked);
}

// ─── Record Trade Modal ───────────────────────────────────────────────────────

let recordTradeIdx = null;

function openRecordTradeModal(posIdx) {
  recordTradeIdx = posIdx;
  const p = positions[posIdx];
  if (!p) return;

  const modal = document.getElementById('recordTradeModal');
  const content = document.getElementById('recordTradeContent');
  if (!modal || !content) return;

  const today = new Date().toISOString().slice(0, 10);

  content.innerHTML = `
    <div class="modal-title">Record Trade</div>
    <div class="modal-subtitle" style="margin-bottom:16px">
      <span style="font-size:16px;font-weight:700;color:var(--text)">${p.ticker}</span>
      <span style="color:var(--text3);font-size:13px;margin-left:6px">${p.name || ''}</span>
      <div style="margin-top:6px;font-size:12px;color:var(--text2)">
        Current position: <strong style="color:var(--text)">${fmt(p.shares, 4)} shares</strong>
        @ avg cost <strong style="color:var(--text)">${fmtUSD(p.cost)}</strong>
      </div>
    </div>

    <div class="field">
      <label>TRADE TYPE</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button id="rt-buy-btn" onclick="setTradeType('buy')"
          style="padding:12px;border-radius:12px;border:1.5px solid var(--green);background:var(--green-bg);color:var(--green);font-size:14px;font-weight:600;cursor:pointer">
          ▲ Buy
        </button>
        <button id="rt-sell-btn" onclick="setTradeType('sell')"
          style="padding:12px;border-radius:12px;border:0.5px solid var(--border2);background:var(--bg3);color:var(--text2);font-size:14px;cursor:pointer">
          ▼ Sell
        </button>
      </div>
    </div>
    <input type="hidden" id="rt-type" value="buy"/>

    <div class="field-row">
      <div class="field">
        <label>SHARES</label>
        <input id="rt-shares" type="number" step="0.0001" placeholder="0.0000" oninput="updateTradePreview()"/>
      </div>
      <div class="field">
        <label>PRICE / SHARE</label>
        <input id="rt-price" type="number" step="0.01" placeholder="${fmt(p.price, 2)}" value="${fmt(p.price, 2)}" oninput="updateTradePreview()"/>
      </div>
    </div>

    <div class="field">
      <label>TRADE DATE</label>
      <input id="rt-date" type="date" value="${today}"/>
    </div>

    <div class="field">
      <label>NOTES (optional)</label>
      <input id="rt-notes" type="text" placeholder="e.g. StockPulse sell signal triggered"/>
    </div>

    <div id="rt-preview" style="display:none;background:var(--bg3);border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:13px"></div>

    <button class="btn-primary" id="rt-submit" onclick="submitRecordTrade(${posIdx})">Record Trade</button>
    <button class="btn-secondary" onclick="closeRecordTradeModal()">Cancel</button>
  `;

  modal.classList.add('open');
}

function setTradeType(type) {
  document.getElementById('rt-type').value = type;
  const buyBtn = document.getElementById('rt-buy-btn');
  const sellBtn = document.getElementById('rt-sell-btn');

  if (type === 'buy') {
    buyBtn.style.cssText = 'padding:12px;border-radius:12px;border:1.5px solid var(--green);background:var(--green-bg);color:var(--green);font-size:14px;font-weight:600;cursor:pointer';
    sellBtn.style.cssText = 'padding:12px;border-radius:12px;border:0.5px solid var(--border2);background:var(--bg3);color:var(--text2);font-size:14px;cursor:pointer';
  } else {
    sellBtn.style.cssText = 'padding:12px;border-radius:12px;border:1.5px solid var(--red);background:var(--red-bg);color:var(--red);font-size:14px;font-weight:600;cursor:pointer';
    buyBtn.style.cssText = 'padding:12px;border-radius:12px;border:0.5px solid var(--border2);background:var(--bg3);color:var(--text2);font-size:14px;cursor:pointer';
  }
  updateTradePreview();
}

function updateTradePreview() {
  const p = positions[recordTradeIdx];
  if (!p) return;

  const type = document.getElementById('rt-type')?.value;
  const shares = parseFloat(document.getElementById('rt-shares')?.value);
  const price = parseFloat(document.getElementById('rt-price')?.value);
  const preview = document.getElementById('rt-preview');
  if (!preview || isNaN(shares) || isNaN(price) || shares <= 0) {
    if (preview) preview.style.display = 'none';
    return;
  }

  const total = shares * price;
  preview.style.display = 'block';

  if (type === 'sell') {
    const costBasis = p.cost * shares;
    const gain = total - costBasis;
    const gainPct = (gain / costBasis) * 100;
    const remaining = p.shares - shares;
    const isFull = remaining <= 0.0001;
    const gainColor = gain >= 0 ? 'var(--green)' : 'var(--red)';

    preview.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="color:var(--text2)">Proceeds</span>
        <strong>${fmtUSD(total)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="color:var(--text2)">Cost basis</span>
        <span>${fmtUSD(costBasis)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="color:var(--text2)">Realized gain/loss</span>
        <strong style="color:${gainColor}">${gain >= 0 ? '+' : ''}${fmtUSD(gain)} (${fmt(gainPct, 1)}%)</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="color:var(--text2)">Remaining shares</span>
        <span style="color:${isFull ? 'var(--red)' : 'var(--text)'}">${isFull ? '0 — Full exit' : fmt(Math.max(remaining, 0), 4) + ' — Partial'}</span>
      </div>
    `;
  } else {
    const newShares = p.shares + shares;
    const newAvgCost = (p.shares * p.cost + shares * price) / newShares;
    preview.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="color:var(--text2)">Total invested</span>
        <strong>${fmtUSD(total)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="color:var(--text2)">New share count</span>
        <span>${fmt(newShares, 4)}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--text2)">New avg cost</span>
        <strong style="color:var(--blue)">${fmtUSD(newAvgCost)}</strong>
      </div>
    `;
  }
}

function submitRecordTrade(posIdx) {
  const p = positions[posIdx];
  if (!p) return;

  const type = document.getElementById('rt-type').value;
  const shares = parseFloat(document.getElementById('rt-shares').value);
  const price = parseFloat(document.getElementById('rt-price').value);
  const date = document.getElementById('rt-date').value;
  const notes = document.getElementById('rt-notes').value.trim();

  if (isNaN(shares) || shares <= 0) { showToast('Enter a valid share count'); return; }
  if (isNaN(price) || price <= 0) { showToast('Enter a valid price'); return; }
  if (!date) { showToast('Enter a trade date'); return; }

  if (type === 'sell' && shares > p.shares + 0.0001) {
    showToast(`Can't sell more than ${fmt(p.shares, 4)} shares`);
    return;
  }

  if (type === 'sell') {
    const remaining = p.shares - shares;
    const isFull = remaining <= 0.0001;

    // Log the trade
    perfAddTrade({
      positionId: posKey(p),
      ticker: p.ticker,
      name: p.name || p.ticker,
      type: 'sell',
      shares,
      price,
      costAtTrade: p.cost,
      date,
      notes,
      isFull,
      remainingShares: Math.max(remaining, 0),
      tracked: isTracked(p),
    });

    // Update or remove position
    if (isFull) {
      positions.splice(posIdx, 1);
      save();
      closeRecordTradeModal();
      closeDetail();
      renderAll();
      showToast(`${p.ticker} fully exited & logged ✓`);
    } else {
      positions[posIdx] = { ...p, shares: parseFloat(remaining.toFixed(6)) };
      save();
      closeRecordTradeModal();
      renderAll();
      // Reopen detail
      setTimeout(() => openDetail(posIdx), 50);
      showToast(`${p.ticker} partial sale logged ✓`);
    }

  } else {
    // Buy: update weighted avg cost
    const newShares = p.shares + shares;
    const newAvgCost = (p.shares * p.cost + shares * price) / newShares;

    perfAddTrade({
      positionId: posKey(p),
      ticker: p.ticker,
      name: p.name || p.ticker,
      type: 'buy',
      shares,
      price,
      date,
      notes,
      isFull: false,
      remainingShares: newShares,
      tracked: isTracked(p),
    });

    positions[posIdx] = {
      ...p,
      shares: parseFloat(newShares.toFixed(6)),
      cost: parseFloat(newAvgCost.toFixed(4)),
    };
    save();
    closeRecordTradeModal();
    renderAll();
    setTimeout(() => openDetail(posIdx), 50);
    showToast(`${p.ticker} buy logged · new avg cost ${fmtUSD(newAvgCost)} ✓`);
  }
}

function closeRecordTradeModal() {
  const modal = document.getElementById('recordTradeModal');
  if (modal) modal.classList.remove('open');
  recordTradeIdx = null;
}

// ─── Performance Calculations ─────────────────────────────────────────────────

function perfCalcTrades() {
  // Only sells from tracked positions
  const trades = perfGetTrades();
  return trades.filter(t => t.type === 'sell' && t.tracked !== false);
}

function perfCalcMetrics(sellTrades) {
  if (!sellTrades.length) return null;

  let totalProfit = 0, totalLoss = 0, wins = 0, losses = 0;
  const returns = [];

  sellTrades.forEach(t => {
    const gain = (t.price - t.costAtTrade) * t.shares;
    const ret = (t.price - t.costAtTrade) / t.costAtTrade;
    returns.push(ret);
    if (gain >= 0) { totalProfit += gain; wins++; }
    else { totalLoss += Math.abs(gain); losses++; }
    totalProfit += gain >= 0 ? gain : 0;
  });

  const winRate = sellTrades.length > 0 ? (wins / sellTrades.length) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  // Sharpe ratio (using trade-level returns, risk-free ~5%)
  const riskFreePerTrade = 0.05 / 252; // daily approx
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length - 1))
    : 0;
  const sharpe = stdDev > 0 ? ((avgReturn - riskFreePerTrade) / stdDev) * Math.sqrt(252) : null;

  // Sortino (downside deviation only)
  const downside = returns.filter(r => r < 0);
  const downsideStd = downside.length > 1
    ? Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / downside.length)
    : 0;
  const sortino = downsideStd > 0 ? ((avgReturn - riskFreePerTrade) / downsideStd) * Math.sqrt(252) : null;

  // Max drawdown on cumulative returns series
  let peak = 1, cumVal = 1, maxDrawdown = 0;
  returns.forEach(r => {
    cumVal *= (1 + r);
    if (cumVal > peak) peak = cumVal;
    const dd = (peak - cumVal) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  });

  // Total return on tracked open positions
  const openTracked = trackedPositions();
  const openGain = openTracked.reduce((s, p) => s + (p.price - p.cost) * p.shares, 0);
  const openCost = openTracked.reduce((s, p) => s + p.cost * p.shares, 0);

  return {
    tradeCount: sellTrades.length,
    wins, losses, winRate,
    totalProfit: totalProfit,
    totalLoss,
    netGain: totalProfit - totalLoss,
    profitFactor: isFinite(profitFactor) ? profitFactor : 99,
    sharpe,
    sortino,
    maxDrawdown: maxDrawdown * 100,
    avgReturn: avgReturn * 100,
    openGain,
    openCost,
  };
}

// ─── S&P 500 Benchmark ────────────────────────────────────────────────────────

let spyPriceCache = null;
let spyCacheDate = null;

async function fetchSPYHistory(days = 365) {
  const today = new Date().toISOString().slice(0, 10);
  if (spyPriceCache && spyCacheDate === today) return spyPriceCache;

  if (!settings.apiKey || !settings.pwaSecret) return null;

  try {
    const data = await workerGet(`/history?symbol=SPY&days=${days}`);
    if (!data.ok || !data.c) return null;
    spyPriceCache = data;
    spyCacheDate = today;
    return data;
  } catch(e) {
    console.warn('SPY fetch failed', e);
    return null;
  }
}

// ─── Performance Page Rendering ───────────────────────────────────────────────

async function renderPerformancePage() {
  const el = document.getElementById('page-performance');
  if (!el) return;

  const allTracked = trackedPositions();
  const trades = perfGetTrades();
  const trackedTrades = trades.filter(t => t.tracked !== false);
  const sellTrades = trackedTrades.filter(t => t.type === 'sell');

  if (allTracked.length === 0 && trackedTrades.length === 0) {
    el.innerHTML = `
      <div class="section">
        <div class="section-label">Performance</div>
        <div class="empty" style="padding:60px 20px">
          <div class="empty-icon">📊</div>
          <div class="empty-title">No tracked positions yet</div>
          <div class="empty-sub">Add positions and toggle "Track with StockPulse" to start measuring your performance. Only positions you actively manage with StockPulse are included.</div>
        </div>
      </div>`;
    return;
  }

  const metrics = perfCalcMetrics(sellTrades);

  // Fetch SPY for benchmark
  const firstTradeDate = trackedTrades.length
    ? trackedTrades.slice().sort((a, b) => a.date.localeCompare(b.date))[0].date
    : null;

  const daysSinceStart = firstTradeDate
    ? Math.ceil((Date.now() - new Date(firstTradeDate + 'T00:00:00').getTime()) / 86400000)
    : 0;

  const spyData = await fetchSPYHistory(Math.max(daysSinceStart + 10, 60));
  let spyReturn = null;
  if (spyData && spyData.c && spyData.c.length >= 2 && firstTradeDate && spyData.t) {
    const startIdx = spyData.t.findIndex(t => {
      const d = new Date(t).toISOString().slice(0, 10);
      return d >= firstTradeDate;
    });
    if (startIdx >= 0 && startIdx < spyData.c.length - 1) {
      spyReturn = ((spyData.c[spyData.c.length - 1] - spyData.c[startIdx]) / spyData.c[startIdx]) * 100;
    }
  }

  // Open positions gain
  const openGain = allTracked.reduce((s, p) => s + (p.price - p.cost) * p.shares, 0);
  const openCost = allTracked.reduce((s, p) => s + p.cost * p.shares, 0);
  const openReturnPct = openCost > 0 ? (openGain / openCost) * 100 : 0;

  // Combined return: closed realized + open unrealized
  const closedNet = metrics ? metrics.netGain : 0;
  const totalNet = closedNet + openGain;
  const totalCost = openCost + (metrics ? trackedTrades.filter(t => t.type === 'buy').reduce((s, t) => s + t.shares * t.price, 0) : 0);

  // Build the HTML
  el.innerHTML = `
    <div class="section">
      <div class="perf-header-card">
        <div style="font-size:11px;font-weight:600;letter-spacing:1px;color:var(--text3);text-transform:uppercase;margin-bottom:8px">StockPulse Performance</div>
        ${firstTradeDate ? `<div style="font-size:11px;color:var(--text3);margin-bottom:12px">Since ${new Date(firstTradeDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:4px">
          <div class="perf-big-stat">
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Open Positions</div>
            <div style="font-size:22px;font-weight:700;color:${openGain >= 0 ? 'var(--green)' : 'var(--red)'}">
              ${openGain >= 0 ? '+' : ''}${fmtUSD(openGain)}
            </div>
            <div style="font-size:12px;color:${openReturnPct >= 0 ? 'var(--green)' : 'var(--red)'}">
              ${openReturnPct >= 0 ? '+' : ''}${fmt(openReturnPct, 1)}% unrealized
            </div>
          </div>
          <div class="perf-big-stat">
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Realized (Closed)</div>
            <div style="font-size:22px;font-weight:700;color:${closedNet >= 0 ? 'var(--green)' : 'var(--red)'}">
              ${closedNet >= 0 ? '+' : ''}${fmtUSD(closedNet)}
            </div>
            <div style="font-size:12px;color:var(--text3)">${sellTrades.length} closed trade${sellTrades.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        ${spyReturn !== null ? `
        <div style="margin-top:12px;padding:10px 12px;background:var(--bg3);border-radius:10px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;color:var(--text2)">vs. S&P 500 (same period)</span>
          <span style="font-size:13px;font-weight:600;color:${spyReturn >= 0 ? 'var(--green)' : 'var(--red)'}">
            ${spyReturn >= 0 ? '+' : ''}${fmt(spyReturn, 1)}%
            <span style="font-size:11px;font-weight:400;color:${openReturnPct - spyReturn >= 0 ? 'var(--green)' : 'var(--red)'}">
              (you: ${openReturnPct >= 0 ? '+' : ''}${fmt(openReturnPct, 1)}%)
            </span>
          </span>
        </div>` : ''}
      </div>

      ${metrics && metrics.tradeCount > 0 ? `
      <div class="section-label" style="margin-top:16px">Trade Metrics</div>
      <div class="perf-metrics-grid">

        <div class="perf-metric-card">
          <div class="perf-metric-label">Win Rate</div>
          <div class="perf-metric-val" style="color:${metrics.winRate >= 50 ? 'var(--green)' : 'var(--red)'}">
            ${fmt(metrics.winRate, 0)}%
          </div>
          <div class="perf-metric-sub">${metrics.wins}W · ${metrics.losses}L</div>
          <div class="perf-bar-track"><div class="perf-bar-fill" style="width:${metrics.winRate}%;background:${metrics.winRate >= 50 ? 'var(--green)' : 'var(--red)'}"></div></div>
        </div>

        <div class="perf-metric-card">
          <div class="perf-metric-label">Profit Factor</div>
          <div class="perf-metric-val" style="color:${metrics.profitFactor >= 1.5 ? 'var(--green)' : metrics.profitFactor >= 1 ? 'var(--amber)' : 'var(--red)'}">
            ${metrics.profitFactor >= 99 ? '∞' : fmt(metrics.profitFactor, 2)}
          </div>
          <div class="perf-metric-sub">${metrics.profitFactor >= 1.5 ? 'Strong edge' : metrics.profitFactor >= 1 ? 'Slight edge' : 'No edge'}</div>
          <div class="perf-bar-track"><div class="perf-bar-fill" style="width:${Math.min(metrics.profitFactor/3*100, 100)}%;background:${metrics.profitFactor >= 1.5 ? 'var(--green)' : metrics.profitFactor >= 1 ? 'var(--amber)' : 'var(--red)'}"></div></div>
        </div>

        ${metrics.sharpe !== null ? `
        <div class="perf-metric-card">
          <div class="perf-metric-label">Sharpe Ratio</div>
          <div class="perf-metric-val" style="color:${metrics.sharpe >= 1 ? 'var(--green)' : metrics.sharpe >= 0 ? 'var(--amber)' : 'var(--red)'}">
            ${fmt(metrics.sharpe, 2)}
          </div>
          <div class="perf-metric-sub">${metrics.sharpe >= 2 ? 'Excellent' : metrics.sharpe >= 1 ? 'Good' : metrics.sharpe >= 0 ? 'Marginal' : 'Underperforming'}</div>
          <div class="perf-bar-track"><div class="perf-bar-fill" style="width:${Math.min(Math.max(metrics.sharpe/3*100,0),100)}%;background:${metrics.sharpe >= 1 ? 'var(--green)' : 'var(--amber)'}"></div></div>
        </div>` : ''}

        ${metrics.maxDrawdown > 0 ? `
        <div class="perf-metric-card">
          <div class="perf-metric-label">Max Drawdown</div>
          <div class="perf-metric-val" style="color:${metrics.maxDrawdown < 10 ? 'var(--green)' : metrics.maxDrawdown < 20 ? 'var(--amber)' : 'var(--red)'}">
            -${fmt(metrics.maxDrawdown, 1)}%
          </div>
          <div class="perf-metric-sub">${metrics.maxDrawdown < 10 ? 'Well controlled' : metrics.maxDrawdown < 20 ? 'Moderate risk' : 'High drawdown'}</div>
          <div class="perf-bar-track"><div class="perf-bar-fill" style="width:${Math.min(metrics.maxDrawdown/50*100,100)}%;background:${metrics.maxDrawdown < 10 ? 'var(--green)' : metrics.maxDrawdown < 20 ? 'var(--amber)' : 'var(--red)'}"></div></div>
        </div>` : ''}

      </div>` : `
      <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:14px;padding:16px;margin-top:12px;font-size:13px;color:var(--text3);text-align:center;line-height:1.6">
        Trade metrics appear once you record your first sale.<br>
        Use the <strong style="color:var(--text2)">Record Trade</strong> button on any position.
      </div>`}

      ${sellTrades.length > 0 ? `
      <div class="section-label" style="margin-top:16px">Closed Trades</div>
      <div id="perf-trades-list">
        ${sellTrades.slice().sort((a, b) => b.date.localeCompare(a.date)).map(t => {
          const gain = (t.price - t.costAtTrade) * t.shares;
          const gainPct = (t.price - t.costAtTrade) / t.costAtTrade * 100;
          const isWin = gain >= 0;
          return `
          <div class="perf-trade-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div style="display:flex;align-items:center;gap:7px">
                  <span style="font-size:16px;font-weight:700">${t.ticker}</span>
                  <span class="pill ${isWin ? 'pill-green' : 'pill-red'}" style="font-size:10px">${isWin ? 'Win' : 'Loss'}</span>
                  <span class="pill pill-blue" style="font-size:10px">${t.isFull ? 'Full exit' : 'Partial'}</span>
                </div>
                <div style="font-size:11px;color:var(--text3);margin-top:3px">
                  ${new Date(t.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                  · ${fmt(t.shares, 4)} shares @ ${fmtUSD(t.price)}
                </div>
                ${t.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;font-style:italic">${t.notes}</div>` : ''}
              </div>
              <div style="text-align:right">
                <div style="font-size:16px;font-weight:700;color:${isWin ? 'var(--green)' : 'var(--red)'}">
                  ${gain >= 0 ? '+' : ''}${fmtUSD(gain)}
                </div>
                <div style="font-size:11px;color:${isWin ? 'var(--green)' : 'var(--red)'}">
                  ${gainPct >= 0 ? '+' : ''}${fmt(gainPct, 1)}%
                </div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${allTracked.length > 0 ? `
      <div class="section-label" style="margin-top:16px">Open Tracked Positions</div>
      ${allTracked.map(p => {
        const gain = (p.price - p.cost) * p.shares;
        const gainPct = (p.price - p.cost) / p.cost * 100;
        return `
        <div class="perf-trade-card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:15px;font-weight:700">${p.ticker}
                <span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:4px">${p.name || ''}</span>
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">
                ${fmt(p.shares, 4)} shares · avg cost ${fmtUSD(p.cost)} · held ${holdingLabel(p.purchaseDate)}
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:15px;font-weight:600;color:${gain >= 0 ? 'var(--green)' : 'var(--red)'}">
                ${gain >= 0 ? '+' : ''}${fmtUSD(gain)}
              </div>
              <div style="font-size:11px;color:${gainPct >= 0 ? 'var(--green)' : 'var(--red)'}">
                ${gainPct >= 0 ? '+' : ''}${fmt(gainPct, 1)}%
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}` : ''}

    </div>`;
}

// ─── CSS for performance page (injected once) ─────────────────────────────────

function injectPerfStyles() {
  if (document.getElementById('perf-styles')) return;
  const style = document.createElement('style');
  style.id = 'perf-styles';
  style.textContent = `
    .perf-header-card {
      background: var(--bg2);
      border: 0.5px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 4px;
    }
    .perf-big-stat {
      background: var(--bg3);
      border-radius: 12px;
      padding: 12px 14px;
    }
    .perf-metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 4px;
    }
    .perf-metric-card {
      background: var(--bg2);
      border: 0.5px solid var(--border);
      border-radius: 14px;
      padding: 13px 14px;
    }
    .perf-metric-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.8px;
      color: var(--text3);
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .perf-metric-val {
      font-size: 24px;
      font-weight: 700;
      line-height: 1;
      margin-bottom: 4px;
    }
    .perf-metric-sub {
      font-size: 11px;
      color: var(--text3);
      margin-bottom: 8px;
    }
    .perf-bar-track {
      height: 3px;
      background: var(--bg4);
      border-radius: 99px;
      overflow: hidden;
    }
    .perf-bar-fill {
      height: 100%;
      border-radius: 99px;
      transition: width 0.5s ease;
    }
    .perf-trade-card {
      background: var(--bg2);
      border: 0.5px solid var(--border);
      border-radius: 14px;
      padding: 13px 14px;
      margin-bottom: 8px;
    }
    .track-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: var(--bg3);
      border-radius: 12px;
      margin-bottom: 14px;
      cursor: pointer;
    }
    .track-toggle-label {
      font-size: 13px;
      color: var(--text);
    }
    .track-toggle-sub {
      font-size: 11px;
      color: var(--text3);
      margin-top: 2px;
    }
    /* Toggle switch */
    .toggle-switch {
      position: relative;
      width: 44px;
      height: 26px;
      flex-shrink: 0;
    }
    .toggle-switch input { display: none; }
    .toggle-slider {
      position: absolute;
      inset: 0;
      background: var(--bg4);
      border-radius: 99px;
      transition: background 0.2s;
      cursor: pointer;
    }
    .toggle-slider:before {
      content: '';
      position: absolute;
      width: 20px; height: 20px;
      left: 3px; top: 3px;
      background: #fff;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    .toggle-switch input:checked + .toggle-slider { background: var(--accent); }
    .toggle-switch input:checked + .toggle-slider:before { transform: translateX(18px); }
    .edit-meta-btn {
      background: var(--bg3);
      border: 0.5px solid var(--border2);
      border-radius: 8px;
      padding: 4px 10px;
      font-size: 12px;
      color: var(--text2);
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

// ─── Track toggle HTML helper (used in add modal + detail modal) ──────────────

function trackToggleHTML(checked = true, id = 'track-toggle') {
  return `
    <label class="track-toggle-row" for="${id}">
      <div>
        <div class="track-toggle-label">📊 Track with StockPulse</div>
        <div class="track-toggle-sub">Include in performance metrics & trade history</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}/>
        <span class="toggle-slider"></span>
      </label>
    </label>`;
}

// Init: inject styles when module loads
injectPerfStyles();
