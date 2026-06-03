/**
 * StockPulse — Momentum Screener v2
 * js/momentum.js
 *
 * Architecture:
 *   Layer 1 (Discovery): Yahoo Finance trending + Finviz pre-market gainers
 *                        → free, no Schwab quota, refreshes every 5 min
 *   Layer 2 (Monitoring): Schwab /quotes poll on the merged hot list only
 *                         → one batched call per 30s, minimal API usage
 *
 * Integrates with existing StockPulse patterns:
 *   - workerGet() / showToast() / settings from state.js
 *   - calcRSI() / calcEMA() from indicators.js (reused, not duplicated)
 *   - localStorage keys prefixed 'sp-mom-'
 *
 * index.html changes needed:
 *   1. <link rel="stylesheet" href="styles/momentum.css"/> in <head>
 *   2. <div class="page" id="page-momentum"></div> in .content
 *   3. Nav item with data-nav="momentum" in .bottom-nav
 *   4. <script src="js/momentum.js"></script> after api.js, before app.js
 *
 * app.js changes needed:
 *   - In navigateTo(): add  if (tab === 'momentum') renderMomentumPage();
 *   - At init block bottom: add  initMomentum();
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const MOM = {
  POLL_MS:          30_000,   // Schwab /quotes poll interval
  DISCOVERY_MS:     5 * 60_000, // Yahoo/Finviz refresh interval
  HIST_DAYS:        20,       // days of /history for vol baseline
  MAX_MANUAL:       20,       // manual ticker cap
  MAX_HOT_LIST:     25,       // total tickers sent to Schwab per poll
  DEFAULT_VOL_PCT:  300,      // volume spike threshold (% of avg)
  DEFAULT_PRICE_PCT: 5,       // intraday price move threshold (%)
  DEDUP_MS:         5 * 60_000, // min ms between same signal re-firing
  SIGNAL_TTL_MS:    60 * 60_000, // signals older than this drop from badge count
  MAX_SIGNALS:      50,
  STORAGE_TICKERS:  'sp-mom-tickers',
  STORAGE_SETTINGS: 'sp-mom-settings',

  // Yahoo Finance trending — no auth, no key, CORS-friendly via proxy
  YAHOO_TRENDING:   'https://query1.finance.yahoo.com/v1/finance/trending/US?count=20&useQuotes=true',
  // Finviz top gainers (pre-market / today) — scrape-free JSON alternative
  FINVIZ_GAINERS:   'https://finviz.com/api/quote.ashx?t=SPY', // used as connectivity check only
};

// ─── Module state ─────────────────────────────────────────────────────────────
const mom = {
  manualTickers:  [],   // [{ ticker, addedAt }]  — user-added, always monitored
  trendingTickers: [],  // [{ ticker, source, score }] — from discovery layer
  hotList:         [],  // merged final list sent to Schwab (≤ MAX_HOT_LIST)
  quoteCache:      {},  // { AAPL: { price, changePct, volume, ... } }
  volBaseline:     {},  // { AAPL: avgVolume }
  signals:         [],  // fired signal objects
  settings: {
    volSpike:   MOM.DEFAULT_VOL_PCT,
    priceMove:  MOM.DEFAULT_PRICE_PCT,
  },
  pollTimer:       null,
  discoveryTimer:  null,
  isPolling:       false,
  lastPollAt:      null,
  lastDiscoveryAt: null,
  discoveryStatus: 'idle',  // 'idle' | 'loading' | 'ok' | 'error'
  histLoading:     new Set(),
  audioCtx:        null,
};

// ─── Persistence ──────────────────────────────────────────────────────────────
function momSave() {
  try {
    localStorage.setItem(MOM.STORAGE_TICKERS,  JSON.stringify(mom.manualTickers));
    localStorage.setItem(MOM.STORAGE_SETTINGS, JSON.stringify(mom.settings));
  } catch(e) {}
}

function momLoad() {
  try {
    const t = localStorage.getItem(MOM.STORAGE_TICKERS);
    if (t) mom.manualTickers = JSON.parse(t);
  } catch(e) { mom.manualTickers = []; }
  try {
    const s = localStorage.getItem(MOM.STORAGE_SETTINGS);
    if (s) mom.settings = { ...mom.settings, ...JSON.parse(s) };
  } catch(e) {}
}

// ─── Audio ────────────────────────────────────────────────────────────────────
function momPlayAlert(severity) {
  try {
    if (!mom.audioCtx) mom.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = mom.audioCtx;
    const tone = (freq, start, dur, vol = 0.12) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(vol, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      o.start(start); o.stop(start + dur);
    };
    const t = ctx.currentTime;
    if (severity === 'high') {
      tone(880, t,        0.1, 0.18);
      tone(1100, t + 0.12, 0.1, 0.18);
      tone(1320, t + 0.24, 0.18, 0.18);
    } else {
      tone(660, t,       0.1);
      tone(880, t + 0.13, 0.14);
    }
  } catch(e) {}
}

// ─── Layer 1: Discovery ───────────────────────────────────────────────────────

/**
 * Fetch Yahoo Finance trending tickers.
 * Returns [{ ticker, source:'yahoo', score }]
 * Uses a CORS proxy since Yahoo doesn't allow direct browser requests.
 */
async function momFetchYahooTrending() {
  // Two CORS proxies — try first, fall back to second
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(MOM.YAHOO_TRENDING)}`,
    `https://corsproxy.io/?${encodeURIComponent(MOM.YAHOO_TRENDING)}`,
  ];

  for (const url of proxies) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const quotes = data?.finance?.result?.[0]?.quotes || [];
      return quotes
        .map((q, i) => ({
          ticker: (q.symbol || '').toUpperCase().replace(/[^A-Z.]/g, ''),
          source: 'Yahoo Trending',
          score:  quotes.length - i,  // higher score = higher rank
        }))
        .filter(t => t.ticker && t.ticker.length <= 5 && !t.ticker.includes('='));
    } catch(e) {
      continue;
    }
  }
  return [];
}

/**
 * Fetch Finviz top % gainers today via their screener URL.
 * Parses the plain-text CSV export (no API key needed).
 * Returns [{ ticker, source:'Finviz Gainers', score }]
 */
async function momFetchFinvizGainers() {
  // Finviz screener: sorted by % change desc, filters: price > $1, volume > 500K
  const url = 'https://finviz.com/screener.ashx?v=111&s=ta_topgainers&f=sh_price_o1,sh_vol_o500&ft=4&o=-change&c=0,1,2,6,7,65';
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

  try {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const html = await res.text();

    // Parse ticker symbols from Finviz HTML table
    const matches = [...html.matchAll(/quote\.ashx\?t=([A-Z]{1,5})"/g)];
    const seen = new Set();
    const results = [];
    for (const m of matches) {
      const ticker = m[1];
      if (!seen.has(ticker)) {
        seen.add(ticker);
        results.push({ ticker, source: 'Finviz Gainers', score: matches.length - results.length });
      }
      if (results.length >= 15) break;
    }
    return results;
  } catch(e) {
    return [];
  }
}

/**
 * Merge discovery sources + manual tickers into the hot list.
 * Manual tickers always included. Trending tickers fill remaining slots.
 * Deduplicates, respects MAX_HOT_LIST cap.
 */
function momBuildHotList() {
  const manualSet = new Set(mom.manualTickers.map(t => t.ticker));

  // Score-sort trending, dedupe against manual
  const trending = mom.trendingTickers
    .filter(t => !manualSet.has(t.ticker))
    .sort((a, b) => b.score - a.score);

  const slots = Math.max(0, MOM.MAX_HOT_LIST - mom.manualTickers.length);
  const topTrending = trending.slice(0, slots);

  mom.hotList = [
    ...mom.manualTickers.map(t => ({ ticker: t.ticker, source: 'Manual' })),
    ...topTrending,
  ];

  momRenderHotList();
}

/**
 * Run both discovery sources in parallel, merge results, rebuild hot list.
 */
async function momRunDiscovery() {
  mom.discoveryStatus = 'loading';
  momRenderDiscoveryStatus();

  try {
    const [yahoo, finviz] = await Promise.allSettled([
      momFetchYahooTrending(),
      momFetchFinvizGainers(),
    ]);

    const yahooResults  = yahoo.status  === 'fulfilled' ? yahoo.value  : [];
    const finvizResults = finviz.status === 'fulfilled' ? finviz.value : [];

    // Merge: if ticker appears in both, boost its score
    const scoreMap = {};
    [...yahooResults, ...finvizResults].forEach(t => {
      if (!scoreMap[t.ticker]) {
        scoreMap[t.ticker] = { ...t };
      } else {
        scoreMap[t.ticker].score += t.score;
        scoreMap[t.ticker].source = 'Yahoo + Finviz';
      }
    });

    mom.trendingTickers   = Object.values(scoreMap);
    mom.lastDiscoveryAt   = Date.now();
    mom.discoveryStatus   = 'ok';

    momBuildHotList();

    // Trigger immediate Schwab poll with the fresh list
    if (mom.isPolling) momPoll();

  } catch(e) {
    mom.discoveryStatus = 'error';
    console.warn('momentum discovery failed:', e);
  }

  momRenderDiscoveryStatus();
}

// ─── Volume baseline loader ───────────────────────────────────────────────────
async function momLoadVolBaseline(ticker) {
  if (mom.histLoading.has(ticker)) return;
  if (!settings?.apiKey || !settings?.pwaSecret) return;
  mom.histLoading.add(ticker);
  try {
    const data = await workerGet(`/history?symbol=${ticker}&days=${MOM.HIST_DAYS}`);
    if (data.ok && data.v?.length > 0) {
      mom.volBaseline[ticker] = data.v.reduce((s, v) => s + v, 0) / data.v.length;
      momRenderHotList(); // refresh to show baseline
    }
  } catch(e) {
    console.warn(`momentum: history failed for ${ticker}:`, e.message);
  } finally {
    mom.histLoading.delete(ticker);
  }
}

// ─── Signal detection ─────────────────────────────────────────────────────────
function momCheckSignals(ticker, quote) {
  const now = Date.now();
  const results = [];

  const pricePct = Math.abs(quote.changePct ?? 0);
  if (pricePct >= mom.settings.priceMove) {
    results.push({
      type: 'PRICE', ticker,
      price: quote.price, changePct: quote.changePct,
      firedAt: now,
      label: `${(quote.changePct ?? 0) >= 0 ? '▲' : '▼'} ${pricePct.toFixed(2)}% intraday move`,
      severity: pricePct >= mom.settings.priceMove * 2 ? 'high' : 'medium',
      volume: quote.volume,
    });
  }

  const baseline = mom.volBaseline[ticker];
  if (baseline > 0 && quote.volume != null) {
    const volPct = (quote.volume / baseline) * 100;
    if (volPct >= mom.settings.volSpike) {
      results.push({
        type: 'VOLUME', ticker,
        price: quote.price, changePct: quote.changePct,
        volPct, volume: quote.volume, baseline,
        firedAt: now,
        label: `${momFmtVol(quote.volume)} traded · ${volPct.toFixed(0)}% of ${MOM.HIST_DAYS}d avg`,
        severity: volPct >= mom.settings.volSpike * 2 ? 'high' : 'medium',
      });
    }
  }

  if (results.length === 2) {
    results.forEach(s => s.severity = 'high');
    results.push({
      type: 'COMBO', ticker,
      price: quote.price, changePct: quote.changePct,
      firedAt: now,
      label: `Price + Volume spike simultaneously`,
      severity: 'high',
    });
  }

  // Deduplicate — don't re-fire same type+ticker within DEDUP_MS
  return results.filter(sig => {
    const lastFired = mom.signals
      .filter(s => s.ticker === ticker && s.type === sig.type)
      .reduce((max, s) => Math.max(max, s.firedAt), 0);
    return (now - lastFired) > MOM.DEDUP_MS;
  });
}

// ─── Layer 2: Schwab polling ──────────────────────────────────────────────────
async function momPoll() {
  if (!settings?.apiKey || !settings?.pwaSecret) return;
  if (mom.hotList.length === 0) return;

  const syms = mom.hotList.map(t => t.ticker);

  try {
    const data = await workerGet(`/quotes?symbols=${syms.join(',')}`);
    if (!data.ok || !data.quotes) return;

    mom.lastPollAt = Date.now();
    momUpdatePollTime();

    const newSignals = [];

    for (const [sym, q] of Object.entries(data.quotes)) {
      const prev = mom.quoteCache[sym];
      mom.quoteCache[sym] = q;

      // Lazy-load vol baseline
      if (mom.volBaseline[sym] == null && !mom.histLoading.has(sym)) {
        momLoadVolBaseline(sym);
      }

      momUpdateRow(sym);

      // Skip signal check if data unchanged
      if (prev && prev.price === q.price && prev.volume === q.volume) continue;

      const fired = momCheckSignals(sym, q);
      newSignals.push(...fired);
    }

    if (newSignals.length > 0) {
      mom.signals = [...newSignals, ...mom.signals].slice(0, MOM.MAX_SIGNALS);
      const topSeverity = newSignals.some(s => s.severity === 'high') ? 'high' : 'medium';
      momPlayAlert(topSeverity);
      momRenderSignals();
      momUpdateBadge();
      showToast(`⚡ ${newSignals.length} momentum signal${newSignals.length > 1 ? 's' : ''} fired`);
    }
  } catch(e) {
    console.warn('momentum poll error:', e.message);
  }
}

function momStartPolling() {
  if (mom.pollTimer) return;
  mom.isPolling = true;
  momPoll();
  mom.pollTimer = setInterval(momPoll, MOM.POLL_MS);
  // Also kick off discovery loop
  momRunDiscovery();
  mom.discoveryTimer = setInterval(momRunDiscovery, MOM.DISCOVERY_MS);
  momRenderStatusBar();
}

function momStopPolling() {
  clearInterval(mom.pollTimer);
  clearInterval(mom.discoveryTimer);
  mom.pollTimer       = null;
  mom.discoveryTimer  = null;
  mom.isPolling       = false;
  momRenderStatusBar();
}

function momToggle() {
  mom.isPolling ? momStopPolling() : momStartPolling();
}

// ─── Manual ticker management ─────────────────────────────────────────────────
function momAddTicker(raw) {
  const ticker = raw.trim().toUpperCase().replace(/[^A-Z.]/g, '');
  if (!ticker) return;
  if (mom.manualTickers.find(t => t.ticker === ticker)) {
    showToast(`${ticker} already in manual list`); return;
  }
  if (mom.manualTickers.length >= MOM.MAX_MANUAL) {
    showToast(`Max ${MOM.MAX_MANUAL} manual tickers`); return;
  }
  mom.manualTickers.push({ ticker, addedAt: Date.now() });
  momSave();
  momBuildHotList();
  momLoadVolBaseline(ticker);
  if (mom.isPolling) momPoll();
  showToast(`${ticker} added to momentum screener`);
}

function momRemoveTicker(ticker) {
  mom.manualTickers = mom.manualTickers.filter(t => t.ticker !== ticker);
  delete mom.quoteCache[ticker];
  delete mom.volBaseline[ticker];
  mom.signals = mom.signals.filter(s => s.ticker !== ticker);
  momSave();
  momBuildHotList();
  momRenderSignals();
  momUpdateBadge();
}

function momHandleAdd() {
  const input = document.getElementById('mom-ticker-input');
  if (!input?.value.trim()) return;
  input.value.split(',').forEach(t => momAddTicker(t.trim()));
  input.value = '';
}

function momClearSignals() {
  mom.signals = [];
  momRenderSignals();
  momUpdateBadge();
  showToast('Signal history cleared');
}

function momApplySettings() {
  const v = parseFloat(document.getElementById('mom-vol-thresh')?.value);
  const p = parseFloat(document.getElementById('mom-price-thresh')?.value);
  if (!isNaN(v) && v > 0) mom.settings.volSpike  = v;
  if (!isNaN(p) && p > 0) mom.settings.priceMove = p;
  momSave();
  showToast('Thresholds saved ✓');
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function momFmtPrice(p)  { return p != null ? `$${Number(p).toFixed(2)}` : '—'; }
function momFmtPct(p)    { return p != null ? `${p >= 0 ? '+' : ''}${Number(p).toFixed(2)}%` : '—'; }
function momFmtVol(v) {
  if (v == null) return '—';
  if (v >= 1e9)  return `${(v/1e9).toFixed(2)}B`;
  if (v >= 1e6)  return `${(v/1e6).toFixed(1)}M`;
  if (v >= 1e3)  return `${(v/1e3).toFixed(0)}K`;
  return String(v);
}
function momFmtAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}
function momFmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', second:'2-digit' });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function momUpdatePollTime() {
  const el = document.getElementById('mom-last-poll');
  if (el) el.textContent = mom.lastPollAt ? `Polled ${momFmtTime(mom.lastPollAt)}` : '';
}

function momRenderStatusBar() {
  const dot    = document.getElementById('mom-dot');
  const text   = document.getElementById('mom-status-text');
  const btn    = document.getElementById('mom-toggle-btn');
  if (!dot) return;
  if (mom.isPolling) {
    dot.className  = 'mom-dot mom-dot-live';
    text.textContent = `Live · polling every ${MOM.POLL_MS/1000}s`;
    btn.textContent  = 'Pause';
    btn.className    = 'mom-ctrl-btn mom-btn-pause';
  } else {
    dot.className  = 'mom-dot mom-dot-paused';
    text.textContent = 'Paused';
    btn.textContent  = 'Start';
    btn.className    = 'mom-ctrl-btn mom-btn-start';
  }
}

function momRenderDiscoveryStatus() {
  const el = document.getElementById('mom-discovery-status');
  if (!el) return;
  const count = mom.trendingTickers.length;
  const ago   = mom.lastDiscoveryAt ? momFmtAgo(mom.lastDiscoveryAt) : 'never';
  if (mom.discoveryStatus === 'loading') {
    el.innerHTML = `<span class="mom-disc-loading">⟳ Scanning market…</span>`;
  } else if (mom.discoveryStatus === 'ok') {
    el.innerHTML = `<span class="mom-disc-ok">✓ ${count} trending tickers · updated ${ago}</span>`;
  } else if (mom.discoveryStatus === 'error') {
    el.innerHTML = `<span class="mom-disc-err">⚠ Discovery unavailable · manual tickers still active</span>`;
  } else {
    el.innerHTML = `<span class="mom-disc-idle">Start screener to fetch trending tickers</span>`;
  }
}

function momRenderSignals() {
  const el = document.getElementById('mom-signals-list');
  if (!el) return;
  if (mom.signals.length === 0) {
    el.innerHTML = `<div class="mom-empty">No signals yet. Start the screener to begin monitoring.</div>`;
    return;
  }
  el.innerHTML = mom.signals.map(s => `
    <div class="mom-signal-card mom-sev-${s.severity}${s.type === 'COMBO' ? ' mom-combo' : ''}">
      <div class="mom-sig-top">
        <span class="mom-sig-ticker">${s.ticker}</span>
        <span class="mom-sig-badge mom-badge-${s.type.toLowerCase()}">${
          s.type === 'PRICE'  ? '📈 Price' :
          s.type === 'VOLUME' ? '📊 Volume' : '⚡ Combo'
        }</span>
        <span class="mom-sig-time">${momFmtAgo(s.firedAt)}</span>
      </div>
      <div class="mom-sig-label">${s.label}</div>
      <div class="mom-sig-meta">
        <span>Price: <strong>${momFmtPrice(s.price)}</strong></span>
        <span>Change: <strong class="${(s.changePct??0) >= 0 ? 'mom-up' : 'mom-down'}">${momFmtPct(s.changePct)}</strong></span>
        ${s.volume ? `<span>Vol: <strong>${momFmtVol(s.volume)}</strong></span>` : ''}
      </div>
    </div>`).join('');
}

function momSourceBadge(source) {
  if (!source || source === 'Manual') return `<span class="mom-src mom-src-manual">Manual</span>`;
  if (source.includes('+'))           return `<span class="mom-src mom-src-both">Yahoo+Finviz</span>`;
  if (source.includes('Yahoo'))       return `<span class="mom-src mom-src-yahoo">Yahoo</span>`;
  if (source.includes('Finviz'))      return `<span class="mom-src mom-src-finviz">Finviz</span>`;
  return `<span class="mom-src mom-src-manual">${source}</span>`;
}

function momRowHTML(item) {
  const { ticker, source } = item;
  const q        = mom.quoteCache[ticker];
  const baseline = mom.volBaseline[ticker];
  const isManual = source === 'Manual';

  const price    = q ? momFmtPrice(q.price) : '—';
  const pct      = q ? momFmtPct(q.changePct) : '—';
  const pctCls   = q ? ((q.changePct ?? 0) >= 0 ? 'mom-up' : 'mom-down') : '';
  const vol      = q ? momFmtVol(q.volume) : '—';

  let volRatio = '—', volCls = '';
  if (q?.volume != null && baseline) {
    const r = (q.volume / baseline) * 100;
    volRatio = `${r.toFixed(0)}%`;
    volCls = r >= mom.settings.volSpike * 2 ? 'mom-spike-high'
           : r >= mom.settings.volSpike     ? 'mom-spike-med' : '';
  } else if (mom.histLoading.has(ticker)) {
    volRatio = '…';
  }

  const hasRecentSignal = mom.signals.some(s =>
    s.ticker === ticker && (Date.now() - s.firedAt) < 10 * 60_000);

  return `
    <tr id="mom-row-${ticker}" class="mom-row${hasRecentSignal ? ' mom-row-active' : ''}">
      <td class="mom-td-ticker">
        ${hasRecentSignal ? '<span class="mom-flash">⚡</span>' : ''}
        <span class="mom-tkr">${ticker}</span>
        ${momSourceBadge(source)}
      </td>
      <td class="mom-td-num">${price}</td>
      <td class="mom-td-num ${pctCls}">${pct}</td>
      <td class="mom-td-num mom-muted">${vol}</td>
      <td class="mom-td-num ${volCls}">${volRatio}</td>
      <td class="mom-td-action">
        ${isManual
          ? `<button class="mom-rm-btn" onclick="momRemoveTicker('${ticker}')" title="Remove">×</button>`
          : '<span class="mom-auto-label">auto</span>'}
      </td>
    </tr>`;
}

function momUpdateRow(ticker) {
  const row = document.getElementById(`mom-row-${ticker}`);
  if (!row) return;
  const item = mom.hotList.find(t => t.ticker === ticker)
            || { ticker, source: 'Manual' };
  row.outerHTML = momRowHTML(item);
}

function momRenderHotList() {
  const tbody = document.getElementById('mom-hot-body');
  if (!tbody) return;
  if (mom.hotList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="mom-empty-row">Start screener to populate hot list</td></tr>`;
    return;
  }
  tbody.innerHTML = mom.hotList.map(momRowHTML).join('');
}

function momUpdateBadge() {
  const badge = document.getElementById('badge-momentum');
  if (!badge) return;
  const n = mom.signals.filter(s => (Date.now() - s.firedAt) < MOM.SIGNAL_TTL_MS).length;
  badge.textContent = n > 9 ? '9+' : String(n);
  badge.style.display = n > 0 ? 'block' : 'none';
}

// ─── Full page render (called by navigateTo) ──────────────────────────────────
function renderMomentumPage() {
  const page = document.getElementById('page-momentum');
  if (!page) return;

  page.innerHTML = `

    <!-- Status bar -->
    <div class="mom-status-bar">
      <div class="mom-status-left">
        <span id="mom-dot" class="mom-dot mom-dot-paused"></span>
        <span id="mom-status-text" class="mom-status-label">Paused</span>
        <span id="mom-last-poll" class="mom-last-poll"></span>
      </div>
      <div class="mom-status-right">
        <button id="mom-toggle-btn" class="mom-ctrl-btn mom-btn-start" onclick="momToggle()">Start</button>
        <button class="mom-ctrl-btn mom-btn-ghost" onclick="momClearSignals()">Clear</button>
      </div>
    </div>

    <!-- Discovery status -->
    <div class="mom-disc-bar">
      <span class="mom-disc-label">Discovery:</span>
      <span id="mom-discovery-status"><span class="mom-disc-idle">Start screener to fetch trending tickers</span></span>
    </div>

    <!-- Signal cards -->
    <div class="section">
      <div class="section-label">Live Signals</div>
      <div id="mom-signals-list">
        <div class="mom-empty">No signals yet. Start the screener to begin monitoring.</div>
      </div>
    </div>

    <!-- Hot list table -->
    <div class="section">
      <div class="mom-hot-header">
        <div class="section-label" style="margin:0">Hot List <span class="mom-hot-count">${mom.hotList.length}/${MOM.MAX_HOT_LIST}</span></div>
        <span class="mom-hot-sub">Auto-populated from Yahoo Trending + Finviz Gainers · manual tickers always included</span>
      </div>
      <div class="mom-table-wrap">
        <table class="mom-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Price</th><th>Change</th>
              <th>Volume</th><th title="vs ${MOM.HIST_DAYS}d avg">Vol%</th><th></th>
            </tr>
          </thead>
          <tbody id="mom-hot-body"></tbody>
        </table>
      </div>

      <!-- Manual add -->
      <div class="mom-add-row">
        <input id="mom-ticker-input" class="mom-input" type="text"
          placeholder="Pin tickers: AAPL, GME, AMC…"
          onkeydown="if(event.key==='Enter') momHandleAdd()"/>
        <button class="mom-add-btn" onclick="momHandleAdd()">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          Pin
        </button>
      </div>
      <div class="mom-manual-hint">Pinned tickers are always monitored. Auto tickers refresh every 5 min.</div>
    </div>

    <!-- Thresholds -->
    <div class="section">
      <div class="section-label">Signal Thresholds</div>
      <div class="settings-card">
        <div class="settings-row">
          <div>
            <div class="settings-label">Volume spike</div>
            <div class="settings-sub">Alert when vol ≥ X% of ${MOM.HIST_DAYS}d average</div>
          </div>
          <input class="settings-input" id="mom-vol-thresh" type="number"
            value="${mom.settings.volSpike}" style="width:70px"/>
          <span style="color:var(--text3);font-size:14px;margin-left:4px">%</span>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">Price move</div>
            <div class="settings-sub">Alert when intraday move ≥ this</div>
          </div>
          <input class="settings-input" id="mom-price-thresh" type="number"
            value="${mom.settings.priceMove}" style="width:70px"/>
          <span style="color:var(--text3);font-size:14px;margin-left:4px">%</span>
        </div>
        <div class="settings-row" style="justify-content:center">
          <button onclick="momApplySettings()"
            style="background:var(--bg4);border:0.5px solid var(--border2);border-radius:10px;padding:8px 18px;color:var(--text2);font-size:13px;cursor:pointer">
            Save thresholds
          </button>
        </div>
      </div>
    </div>

    <!-- Info -->
    <div class="section" style="padding-bottom:40px">
      <div class="settings-card">
        <div class="settings-row"><div class="settings-label">Schwab calls</div>
          <div style="font-size:13px;color:var(--text3)">1 batch call / ${MOM.POLL_MS/1000}s (all tickers)</div></div>
        <div class="settings-row"><div class="settings-label">Discovery</div>
          <div style="font-size:13px;color:var(--text3)">Yahoo Trending + Finviz · free · every 5 min</div></div>
        <div class="settings-row"><div class="settings-label">Vol baseline</div>
          <div style="font-size:13px;color:var(--text3)">${MOM.HIST_DAYS}d avg from /history · loaded once per ticker</div></div>
        <div class="settings-row"><div><div class="settings-label">Disclaimer</div>
          <div class="settings-sub" style="max-width:220px">Momentum signals are informational only. Not financial advice.</div></div></div>
      </div>
    </div>
  `;

  momRenderStatusBar();
  momRenderDiscoveryStatus();
  momRenderHotList();
  momRenderSignals();
  momUpdatePollTime();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initMomentum() {
  momLoad();
  momUpdateBadge();

  // Pre-load vol baselines for pinned tickers
  mom.manualTickers.forEach(({ ticker }) => momLoadVolBaseline(ticker));

  // Pause when tab hidden, don't auto-resume (user must press Start)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mom.isPolling) momStopPolling();
  });
}
