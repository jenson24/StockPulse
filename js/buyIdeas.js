// ─── AI Buy Ideas Engine ──────────────────────────────────────────────────────

const DEFAULT_WATCHLIST = 'AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,JPM,BRK.B,XLV,V,UNH,HD,PG,JNJ';

// How many days of recommendation history to remember (prevents repeat picks)
const RECO_HISTORY_DAYS = 7;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function loadCachedBuys() {
  try {
    const raw = localStorage.getItem('sp-buy-cache');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.date === todayStr()) return parsed.ideas;
  } catch(e) {}
  return null;
}

function saveBuyCache(ideas) {
  localStorage.setItem('sp-buy-cache', JSON.stringify({ date: todayStr(), ideas }));
}

// ─── Recommendation history (prevents same tickers repeating) ─────────────────

function loadRecoHistory() {
  try {
    const raw = localStorage.getItem('sp-reco-history');
    if (!raw) return [];
    const hist = JSON.parse(raw); // [{ date, tickers: [] }]
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RECO_HISTORY_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return hist.filter(h => h.date >= cutoffStr);
  } catch(e) { return []; }
}

function saveRecoHistory(tickers) {
  const hist = loadRecoHistory();
  // Remove today's entry if exists, then prepend fresh one
  const filtered = hist.filter(h => h.date !== todayStr());
  filtered.unshift({ date: todayStr(), tickers: tickers.map(t => t.toUpperCase()) });
  localStorage.setItem('sp-reco-history', JSON.stringify(filtered.slice(0, RECO_HISTORY_DAYS + 1)));
}

function recentlyRecommendedTickers() {
  const hist = loadRecoHistory();
  const today = todayStr();
  // Exclude today's own entry so a manual refresh can still show today's picks
  const tickers = new Set();
  hist.filter(h => h.date !== today).forEach(h => h.tickers.forEach(t => tickers.add(t)));
  return [...tickers];
}

// ─── MACD trough detection ────────────────────────────────────────────────────
// Returns an object describing whether MACD has recently bottomed and is rising.
// "Trough" = local minimum in MACD histogram within the last N bars, with
// positive slope since then. This is computed locally so Claude receives
// a precise, actionable signal rather than a blunt ▲/▼.

function detectMACDTrough(indicators, lookback = 8) {
  // indicators is the object returned by computeAllIndicators()
  // We need the raw MACD series — stored in indicatorCache
  const cached = indicatorCache[indicators._ticker];
  if (!cached || !cached.raw) return null;

  const closes = cached.raw.map(c => c.c).filter(v => v != null);
  if (closes.length < 35) return null;

  // Compute MACD histogram series for the last (lookback + 5) bars
  const window = lookback + 5;
  const slice = closes.slice(-Math.min(closes.length, 60 + window));

  const histSeries = [];
  for (let i = 35; i <= slice.length; i++) {
    const seg = slice.slice(0, i);
    const e12 = calcEMA(seg, 12);
    const e26 = calcEMA(seg, 26);
    if (e12 === null || e26 === null) continue;
    const macdLine = e12 - e26;
    // Signal: EMA(9) of last 9 MACD values
    const macdSeg = [];
    for (let j = Math.max(0, histSeries.length - 8); j < histSeries.length; j++) {
      macdSeg.push(histSeries[j].macd);
    }
    macdSeg.push(macdLine);
    const signal = macdSeg.reduce((a, b) => a + b, 0) / macdSeg.length;
    histSeries.push({ macd: macdLine, signal, hist: macdLine - signal });
  }

  if (histSeries.length < lookback) return null;

  const recent = histSeries.slice(-lookback);

  // Find the minimum histogram value and its position
  let minVal = Infinity, minIdx = -1;
  recent.forEach((b, i) => {
    if (b.hist < minVal) { minVal = b.hist; minIdx = i; }
  });

  if (minIdx < 0 || minIdx >= recent.length - 1) return null; // trough must not be the last bar

  // Slope since trough: average change per bar
  const barsAfterTrough = recent.length - 1 - minIdx;
  const valueAtTrough   = recent[minIdx].hist;
  const valueNow        = recent[recent.length - 1].hist;
  const slopePerBar     = barsAfterTrough > 0 ? (valueNow - valueAtTrough) / barsAfterTrough : 0;

  // Qualifying conditions:
  // 1. The trough value was negative (came from below zero or was a dip)
  // 2. The slope since trough is positive
  // 3. Trough occurred within the last 1–6 bars (fresh signal)
  const isTrough = valueAtTrough < 0 && slopePerBar > 0 && barsAfterTrough >= 1 && barsAfterTrough <= 6;

  return {
    isTrough,
    barsAgo: barsAfterTrough,
    troughValue: parseFloat(valueAtTrough.toFixed(4)),
    currentHist: parseFloat(valueNow.toFixed(4)),
    slopePerBar: parseFloat(slopePerBar.toFixed(4)),
    summary: isTrough
      ? `MACD trough ${barsAfterTrough}bar${barsAfterTrough !== 1 ? 's' : ''} ago (${valueAtTrough.toFixed(3)}), slope +${slopePerBar.toFixed(3)}/bar`
      : null,
  };
}

// ─── Local pre-filter ─────────────────────────────────────────────────────────
// Runs before passing tickers to Claude, removing obviously poor setups.
// Returns a scored+sorted subset ready for the AI scoring step.

function preFilterUniverse(universe, universeIndicators) {
  return universe
    .map(ticker => {
      const ind = universeIndicators[ticker] || null;
      if (!ind) return { ticker, preScore: 0, ind, macdTrough: null };

      let preScore = 50;
      const macdTrough = ind._ticker ? detectMACDTrough(ind) : null;

      // Hard disqualifiers — skip overbought / broken-down names
      if (ind.rsi !== null && ind.rsi > 72)      preScore -= 30; // overbought
      if (ind.bb && ind.bb.pct > 90)             preScore -= 20; // at upper band
      if (ind.sma50 && ind.sma200 && ind.sma50 < ind.sma200) preScore -= 15; // death cross

      // Positive signals
      if (ind.rsi !== null && ind.rsi < 45)      preScore += 20; // approaching oversold
      if (ind.rsi !== null && ind.rsi < 35)      preScore += 10; // oversold bonus
      if (ind.bb && ind.bb.pct < 25)             preScore += 15; // near lower band
      if (ind.sma50 && ind.sma200 && ind.sma50 > ind.sma200) preScore += 10; // golden cross
      if (macdTrough?.isTrough)                  preScore += 25; // MACD trough — best signal
      if (ind.volRatio && ind.volRatio > 1.3)    preScore += 8;  // volume confirmation

      return { ticker, preScore, ind, macdTrough };
    })
    .filter(x => x.preScore >= 40) // drop the worst candidates
    .sort((a, b) => b.preScore - a.preScore);
}

// ─── Portfolio sector summary ─────────────────────────────────────────────────

function portfolioSectorSummary() {
  if (!positions || positions.length === 0) return '';
  const totalVal = positions.reduce((s, p) => s + p.shares * p.price, 0);
  if (totalVal === 0) return '';

  const bySector = {};
  positions.forEach(p => {
    const sec = getSector(p.ticker);
    const val = p.shares * p.price;
    bySector[sec] = (bySector[sec] || 0) + val;
  });

  return Object.entries(bySector)
    .sort((a, b) => b[1] - a[1])
    .map(([sec, val]) => `${sec}: ${((val / totalVal) * 100).toFixed(0)}%`)
    .join(', ');
}

function overweightedSectors(threshold = 20) {
  if (!positions || positions.length === 0) return [];
  const totalVal = positions.reduce((s, p) => s + p.shares * p.price, 0);
  if (totalVal === 0) return [];

  const bySector = {};
  positions.forEach(p => {
    const sec = getSector(p.ticker);
    const val = p.shares * p.price;
    bySector[sec] = (bySector[sec] || 0) + val;
  });

  return Object.entries(bySector)
    .filter(([, val]) => (val / totalVal) * 100 >= threshold)
    .map(([sec]) => sec);
}

// ─── AI: generate universe of candidates ─────────────────────────────────────

async function askAIForUniverse(portfolioTickers, portfolioIndicators) {
  if (!settings.anthropicKey) return null;

  const sectorSummary  = portfolioSectorSummary();
  const heavySectors   = overweightedSectors(20);
  const recentRecs     = recentlyRecommendedTickers();
  const watchlistTickers = (settings.watchlist || DEFAULT_WATCHLIST)
    .split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  // All tickers to exclude
  const excluded = [...new Set([
    ...portfolioTickers,
    ...watchlistTickers,
    ...recentRecs,
  ])];

  const portSummary = portfolioTickers.map(t => {
    const ind = portfolioIndicators[t] || {};
    return `${t} (RSI ${ind.rsi ?? 'N/A'})`;
  }).join(', ');

  const prompt = `You are a portfolio analyst selecting a diverse universe of US stocks to scan for buy opportunities today.

Current portfolio: ${portSummary || 'none'}
Portfolio sector weights: ${sectorSummary || 'unknown'}
${heavySectors.length ? `AVOID these already-overweighted sectors: ${heavySectors.join(', ')}` : ''}

Return exactly 40 tickers as a JSON array of strings. Rules:
- DO NOT include any of these (already held, on watchlist, or recommended recently): ${excluded.join(', ') || 'none'}
- Maximum 2 tickers per sector — enforce diversity
- ${heavySectors.length ? `Zero tickers from: ${heavySectors.join(', ')}` : 'Balance across all sectors'}
- Include a mix of: large-cap blue chips, mid-cap growth, sector ETFs, dividend payers
- Bias toward stocks that may be setting up technically (pullbacks, sector rotation, recent underperformance relative to fundamentals)
- Include sectors like: Technology, Healthcare, Financials, Consumer Staples, Energy, Real Estate, Communication Services, Materials, Utilities
- No ADRs, no penny stocks, US-listed only

Respond with ONLY a JSON array: ["TICK1","TICK2",...]. No markdown, no explanation.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      })
    });
    if (!res.ok) { console.error('Universe API error', res.status); return null; }
    const data = await res.json();
    const text = data.content?.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    return parsed.map(t => t.toUpperCase());
  } catch(e) {
    console.warn('Universe generation failed:', e);
    return null;
  }
}

// ─── AI: score and select final picks ────────────────────────────────────────

async function generateBuyIdeasWithAI(candidates, portfolioTickers, universeIndicators) {
  if (!settings.anthropicKey) return null;

  const heavySectors = overweightedSectors(20);
  const sectorSummary = portfolioSectorSummary();
  const excluded = [...new Set([
    ...portfolioTickers,
    ...(settings.watchlist || DEFAULT_WATCHLIST).split(',').map(t => t.trim().toUpperCase()),
    ...recentlyRecommendedTickers(),
  ])];

  const marketSummary = candidates.map(({ ticker, ind, macdTrough, preScore }) => {
    const price  = universeIndicators[ticker]?._price?.toFixed(2) ?? 'N/A';
    const rsi    = ind?.rsi    != null ? `RSI ${ind.rsi}` : '';
    const bb     = ind?.bb     != null ? `BB%B ${ind.bb.pct}%` : '';
    const ma     = (ind?.sma50 && ind?.sma200)
      ? (ind.sma50 > ind.sma200 ? 'golden cross' : 'death cross') : '';
    const vol    = ind?.volRatio != null ? `vol ${(ind.volRatio * 100).toFixed(0)}% of avg` : '';
    const buys   = ind?.buySignals?.length  ? `buy: ${ind.buySignals.join(', ')}` : '';
    const sells  = ind?.sellSignals?.length ? `⚠ sell: ${ind.sellSignals.join(', ')}` : '';

    // MACD: precise trough info instead of blunt ▲/▼
    const macdStr = macdTrough?.isTrough
      ? `MACD TROUGH (${macdTrough.summary})`
      : ind?.macd?.histogram != null
        ? `MACD hist ${ind.macd.histogram > 0 ? '▲' : '▼'} ${ind.macd.histogram.toFixed(3)}`
        : '';

    const parts = [rsi, bb, macdStr, ma, vol, buys, sells].filter(Boolean).join(' | ');
    return `${ticker} [pre-score ${preScore}]: $${price}${parts ? ' — ' + parts : ''}`;
  }).join('\n');

  const prompt = `You are a technical stock analyst. Select exactly 10 buy opportunities from the candidates below.

Portfolio sector weights: ${sectorSummary || 'unknown'}
${heavySectors.length ? `Do NOT recommend any stock from these overweighted sectors: ${heavySectors.join(', ')}` : ''}
Do NOT recommend: ${excluded.join(', ') || 'none'}
Enforce maximum 1 pick per sector across your 10 selections.

Candidates (pre-scored by local technical filters, higher = better setup):
${marketSummary || 'No live data — use training knowledge.'}

Scoring:
- 85–100: MACD trough confirmed + RSI < 50 + near lower BB + golden cross or strong fundamentals
- 70–84: 2+ confirming buy signals, no major sell signals
- 55–69: 1 buy signal or neutral setup with sector/value case
- Penalise: RSI > 65, upper BB > 80%, death cross, multiple sell signals
- Bonus: MACD trough (most important timing signal), volume confirmation, RSI < 40

Respond with ONLY a valid JSON array, no markdown, no preamble:
[{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "sector": "Technology",
  "price": 178.50,
  "change": "+1.2%",
  "score": 82,
  "tag": "Momentum",
  "reason": "2–3 sentences citing specific indicator values. If MACD trough detected, explain the setup."
}]

Tag must be one of: Momentum, Value, Dividend, Growth, Turnaround
Use "Turnaround" when the primary signal is a MACD trough or RSI recovery from oversold.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      })
    });
    if (!res.ok) {
      console.error('Anthropic scoring error', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = data.content?.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch(e) {
    console.error('AI scoring failed:', e);
    return null;
  }
}

// ─── Main load function ───────────────────────────────────────────────────────

async function loadBuyIdeas(forceRefresh = false) {
  const el = $('buysList');

  const cached = loadCachedBuys();
  if (!forceRefresh && cached) {
    cachedBuyIdeas = cached;
    renderBuyCards(cached);
    return;
  }

  if (!forceRefresh && !cached) {
    el.innerHTML = `
      <div style="text-align:center;padding:50px 20px">
        <div style="font-size:32px;margin-bottom:12px">🤖</div>
        <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:8px">Ready to generate today's picks</div>
        <div style="font-size:13px;color:var(--text3);margin-bottom:24px;line-height:1.6">
          Claude selects a diverse 40-stock universe, filters by RSI, Bollinger Bands, and MACD trough detection,
          then scores the best setups — avoiding your current holdings, watchlist, and recent recommendations.
        </div>
        <button onclick="loadBuyIdeas(true)" style="background:var(--accent);color:#fff;border:none;border-radius:14px;padding:14px 28px;font-size:15px;font-weight:600;cursor:pointer">
          Generate today's picks
        </button>
      </div>`;
    return;
  }

  // ── Loading UI ──
  const setStatus = (step, total, msg) => {
    const stepEl = document.getElementById('buyLoadStep');
    const msgEl  = document.getElementById('buyLoadMsg');
    if (stepEl) stepEl.textContent = `Step ${step}/${total}`;
    if (msgEl)  msgEl.textContent  = msg;
  };

  el.innerHTML = `
    <div style="text-align:center;padding:40px 20px">
      <div id="buyLoadStep" style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:6px">Step 1/4</div>
      <div id="buyLoadMsg" style="font-size:12px;color:var(--text3);margin-bottom:20px">Asking Claude to select a diverse universe…</div>
      <div style="display:flex;justify-content:center;gap:6px">
        <div style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1.2s ease-in-out infinite"></div>
        <div style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1.2s ease-in-out 0.4s infinite"></div>
        <div style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1.2s ease-in-out 0.8s infinite"></div>
      </div>
    </div>
    <style>@keyframes pulse{0%,100%{opacity:0.2}50%{opacity:1}}</style>`;

  const portfolioTickers = positions.map(p => p.ticker.toUpperCase());
  const watchlistTickers = (settings.watchlist || DEFAULT_WATCHLIST)
    .split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  // ── Step 1: AI universe selection ──
  let universe = await askAIForUniverse(portfolioTickers, currentIndicators);
  if (!universe || universe.length === 0) {
    // Fallback: a broad hard-coded list excluding portfolio + watchlist
    const excluded = new Set([...portfolioTickers, ...watchlistTickers]);
    universe = [
      'ABBV','ACN','ADBE','ADI','ADP','AFL','AIG','AIZ','ALB','ALL',
      'AMAT','AMD','AME','AMGN','AMT','ANET','ANSS','AON','APD','APH',
      'ARE','AVB','AVGO','AXP','AZO','BAC','BAX','BDX','BIIB','BK',
      'BKNG','BLK','BMY','BR','BRO','BSX','BX','C','CB','CDNS',
      'CDW','CFG','CHD','CHRW','CI','CINF','CL','CLX','CMA','CME',
      'CMG','CMS','CNC','CNP','COF','CPRT','CRM','CSCO','CSX','CTAS',
      'CVS','DFS','DG','DHI','DHR','DLR','DLTR','DOV','DPZ','DRI',
      'DTE','DUK','DVN','EA','ECL','ED','EFX','EIX','ELV','EMN',
      'EMR','EOG','EQIX','EQR','ES','ESS','ETN','ETR','EVRG','EW',
      'EXC','EXPD','EXPE','EXR','F','FAST','FCX','FDS','FE','FFIV',
      'FIS','FITB','FLT','FMC','FNF','FOX','FOXA','FRC','FTNT','GD',
      'GE','GEHC','GEN','GIS','GL','GLW','GM','GPC','GPN','GRMN',
      'HAL','HAS','HBAN','HCA','HES','HIG','HII','HLT','HOLX','HPE',
      'HPQ','HRL','HSIC','HST','HSY','HUM','HWM','IBM','ICE','IDXX',
      'IEX','IFF','ILMN','INCY','IQV','IR','IRM','ISRG','ITW','IVZ',
      'J','JBHT','JCI','JKHY','JNPR','K','KEY','KEYS','KHC','KIM',
      'KLAC','KMB','KMX','KR','L','LEN','LH','LHX','LKQ','LLY',
      'LMT','LNC','LNT','LOW','LRCX','LUMN','LUV','LVS','LW','LYB',
      'LYV','MAA','MAR','MAS','MCD','MCK','MCO','MCHP','MET','MGM',
      'MHK','MKC','MKTX','MLM','MMC','MMM','MNST','MOH','MOS','MPC',
      'MPWR','MRK','MRNA','MS','MSCI','MTB','MTCH','MTD','MU','NDAQ',
      'NEE','NEM','NI','NKE','NOC','NOW','NRG','NSC','NTAP','NTRS',
      'NUE','NVR','NWL','NWS','NWSA','O','ODFL','OKE','OMC','ORCL',
      'ORLY','OXY','PARA','PAYC','PAYX','PCAR','PCG','PEAK','PEG',
      'PFE','PFG','PGR','PH','PHM','PKG','PKI','PLD','PM','PNC',
      'PNR','PNW','POOL','PPG','PPL','PRU','PSA','PSX','PTC','PVH',
      'PWR','QCOM','QRVO','RCL','RE','REG','REGN','RF','RHI','RJF',
      'RL','RMD','ROK','ROL','ROP','ROST','RSG','RTX','SBAC','SHW',
      'SJM','SLB','SNA','SNPS','SO','SPG','STE','STT','STX','STZ',
      'SWK','SWKS','SYF','SYK','SYY','T','TAP','TDG','TDY','TECH',
      'TEL','TER','TFC','TFX','TGT','TJX','TMO','TMUS','TPR','TRMB',
      'TROW','TRV','TSCO','TT','TTWO','TXN','TXT','TYL','UAL','UDR',
      'UHS','ULTA','UNM','UPS','URI','USB','VFC','VLO','VMC','VNO',
      'VRSK','VRSN','VRTX','VTR','WAB','WAT','WBA','WBD','WDC','WEC',
      'WELL','WFC','WHR','WM','WMB','WRB','WRK','WST','WY','XEL','XOM',
      'XYL','YUM','ZBH','ZBRA','ZION','ZTS',
    ].filter(t => !excluded.has(t));
  }

  // Deduplicate and exclude held/watchlist/recently recommended
  const excluded = new Set([
    ...portfolioTickers,
    ...watchlistTickers,
    ...recentlyRecommendedTickers(),
  ]);
  universe = [...new Set(universe)].filter(t => !excluded.has(t)).slice(0, 40);

  setStatus(2, 4, `Fetching live data for ${universe.length} stocks…`);

  // ── Step 2: Fetch market data + indicators ──
  let marketData = [];
  let universeIndicators = {};

  if (settings.apiKey && settings.pwaSecret) {
    marketData = await fetchMarketDataForWatchlist(universe);
    universeIndicators = await fetchAllIndicators(universe);
    // Attach ticker to each indicator object so detectMACDTrough can look up cache
    Object.keys(universeIndicators).forEach(t => {
      if (universeIndicators[t]) universeIndicators[t]._ticker = t;
    });
  }

  setStatus(3, 4, 'Pre-filtering by RSI, Bollinger, MACD trough…');

  // ── Step 3: Local pre-filter ──
  const allCandidates = universe.map(ticker => {
    const ind = universeIndicators[ticker] || null;
    const trough = ind ? detectMACDTrough({ ...ind, _ticker: ticker }) : null;
    return { ticker, ind, macdTrough: trough };
  });

  const preFiltered = preFilterUniverse(allCandidates.map(c => c.ticker), universeIndicators)
    .map(pf => ({
      ...pf,
      macdTrough: allCandidates.find(c => c.ticker === pf.ticker)?.macdTrough || null,
    }));

  // Pass top 20 pre-filtered candidates to AI (or all if < 20 pass)
  const topCandidates = preFiltered.slice(0, 20);

  // If fewer than 10 pass pre-filter, relax and use unfiltered
  const candidatesForAI = topCandidates.length >= 10
    ? topCandidates
    : allCandidates.slice(0, 20).map(c => ({ ...c, preScore: 50 }));

  setStatus(4, 4, 'Claude scoring top candidates…');

  // ── Step 4: AI scoring ──
  let ideas = null;
  if (settings.anthropicKey) {
    ideas = await generateBuyIdeasWithAI(candidatesForAI, portfolioTickers, universeIndicators);
  }

  if (ideas && ideas.length > 0) {
    // Filter out any excluded tickers the AI may have slipped in
    ideas = ideas.filter(i => !excluded.has(i.ticker.toUpperCase()));

    // Attach local indicators + MACD trough info
    const fundamentals = settings.apiKey ? await fetchFundamentals(ideas.map(i => i.ticker)) : {};
    ideas = ideas.map(idea => {
      const t = idea.ticker.toUpperCase();
      const ind = universeIndicators[t] || null;
      const trough = allCandidates.find(c => c.ticker === t)?.macdTrough || null;
      return {
        ...idea,
        indicators: ind,
        macdTrough: trough,
        fundamentals: fundamentals[t] || null,
      };
    });

    // Save recommended tickers to history
    saveRecoHistory(ideas.map(i => i.ticker));

    saveBuyCache(ideas);
    cachedBuyIdeas = ideas;
    renderBuyCards(ideas);
    showToast(`${ideas.length} buy ideas ready ✓`);
  } else {
    el.innerHTML = `<div class="empty">
      <div class="empty-icon">🤖</div>
      <div class="empty-title">Add API keys to enable AI picks</div>
      <div class="empty-sub">Go to Settings and add your Anthropic API key (for AI analysis) and configure your Schwab Worker URL to enable live market data.</div>
    </div>`;
  }
}

function renderBuys() { loadBuyIdeas(false); }

function renderBuyCards(ideas) {
  const el = $('buysList');
  const cached = loadCachedBuys();
  const isToday = !!cached;
  const lastUpdated = isToday ? `Today · ${new Date().toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit'})}` : 'Cached';

  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <span style="font-size:11px;color:var(--text3)">Generated ${lastUpdated}</span>
    <button onclick="loadBuyIdeas(true)" style="background:var(--bg3);border:0.5px solid var(--border2);border-radius:99px;padding:4px 12px;color:var(--text2);font-size:11px;cursor:pointer">↻ Refresh</button>
  </div>` + ideas.map((b, idx) => {
    const score = Math.round(b.score);
    const c = score >= 80 ? '#00c97a' : score >= 65 ? '#f5a623' : '#999';
    const arc = 2 * Math.PI * 16;
    const dash = (score / 100) * arc;
    const chgColor = (b.change || '').startsWith('+') ? 'var(--green)' : 'var(--red)';
    const tagClass = b.tag === 'Momentum' || b.tag === 'Growth' || b.tag === 'Turnaround' ? 'pill-green' : b.tag === 'Value' || b.tag === 'Dividend' ? 'pill-amber' : 'pill-blue';
    const priceStr = b.price ? '$' + parseFloat(b.price).toFixed(2) : 'N/A';
    return `<div class="buy-card" onclick="openBuyDetail(${idx})" style="cursor:pointer">
      <div class="buy-top">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="buy-ticker">${b.ticker}</span>
            <span class="pill ${tagClass}" style="font-size:10px">${b.tag}</span>
          </div>
          <div class="buy-name">${b.name}</div>
          <div class="buy-price">${priceStr}</div>
          ${b.change ? `<div class="buy-chg" style="color:${chgColor}">${b.change} today</div>` : ''}
        </div>
        <svg class="score-circle" viewBox="0 0 42 42" role="img" aria-label="Score ${score} out of 100">
          <circle cx="21" cy="21" r="16" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3.5"/>
          <circle cx="21" cy="21" r="16" fill="none" stroke="${c}" stroke-width="3.5"
            stroke-dasharray="${dash.toFixed(1)} ${arc.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 21 21)"/>
          <text x="21" y="26" text-anchor="middle" font-size="11" font-weight="700" fill="${c}">${score}</text>
        </svg>
      </div>
      <div class="buy-reason">${b.reason}</div>
      <div style="margin-top:10px;font-size:11px;color:var(--text3);text-align:right">Tap for details →</div>
    </div>`;
  }).join('');
}

function renderBuys() { loadBuyIdeas(false); }

// ─── Buy Detail Modal ─────────────────────────────────────────────────────────
let currentBuyIdea = null;

function openBuyDetail(idx) {
  const ideas = cachedBuyIdeas;
  if (!ideas || !ideas[idx]) return;
  const b = ideas[idx];
  currentBuyIdea = b;
  buyChartTicker = b.ticker?.toUpperCase();
  buyChartRange = 1; buyChartMom = 'rsi';

  const ind = b.indicators || indicatorCache[b.ticker?.toUpperCase()]?.indicators || null;
  const fund = b.fundamentals || null;
  const score = Math.round(b.score);
  const scoreColor = score >= 80 ? '#00c97a' : score >= 65 ? '#f5a623' : '#999';
  const priceStr = b.price ? '$' + parseFloat(b.price).toFixed(2) : 'N/A';
  const chgColor = (b.change || '').startsWith('+') ? 'var(--green)' : 'var(--red)';

  const buySignals = ind?.buySignals || [];
  const sellSignals = ind?.sellSignals || [];

  let divHTML = '';
  if (fund) {
    const divYield = fund.dividendYield != null ? fund.dividendYield.toFixed(2) + '%' : null;
    const divAmt = fund.dividendAmount != null ? '$' + parseFloat(fund.dividendAmount).toFixed(2) + '/yr' : null;
    const divPay = fund.dividendPayAmount != null ? '$' + parseFloat(fund.dividendPayAmount).toFixed(2) + '/payment' : null;
    const divFreq = fund.dividendFrequency || null;
    const fmtDate = s => s ? new Date(s).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}) : null;
    const exDiv = fmtDate(fund.dividendDate);
    const payDate = fmtDate(fund.dividendPayDate);
    const nextExDiv = fmtDate(fund.nextDividendDate);

    if (divYield || divAmt) {
      divHTML = `<div class="detail-section">
        <div class="detail-section-title">Dividend</div>
        ${divYield ? `<div class="detail-row"><span class="label">Yield</span><span class="val" style="color:var(--green)">${divYield}</span></div>` : ''}
        ${divAmt ? `<div class="detail-row"><span class="label">Annual amount</span><span class="val">${divAmt}</span></div>` : ''}
        ${divPay ? `<div class="detail-row"><span class="label">Per payment</span><span class="val">${divPay}</span></div>` : ''}
        ${divFreq ? `<div class="detail-row"><span class="label">Frequency</span><span class="val">${divFreq}</span></div>` : ''}
        ${exDiv ? `<div class="detail-row"><span class="label">Last ex-div date</span><span class="val">${exDiv}</span></div>` : ''}
        ${payDate ? `<div class="detail-row"><span class="label">Next pay date</span><span class="val" style="color:var(--green)">${payDate}</span></div>` : ''}
        ${nextExDiv ? `<div class="detail-row"><span class="label">Next ex-div date</span><span class="val">${nextExDiv}</span></div>` : ''}
      </div>`;
    } else {
      divHTML = `<div class="detail-section">
        <div class="detail-section-title">Dividend</div>
        <div style="font-size:12px;color:var(--text3)">No dividend — growth/non-dividend stock</div>
      </div>`;
    }
  }

  let fundHTML = '';
  if (fund) {
    const pe   = fund.peRatio != null ? fund.peRatio.toFixed(1) : '—';
    const peg  = fund.pegRatio != null ? fund.pegRatio.toFixed(2) : '—';
    const eps  = fund.eps != null ? '$' + parseFloat(fund.eps).toFixed(2) : '—';
    const beta = fund.beta != null ? fund.beta.toFixed(2) : '—';
    const mcap = fund.marketCap != null
      ? (fund.marketCap >= 1e12 ? '$' + (fund.marketCap/1e12).toFixed(2) + 'T'
      : fund.marketCap >= 1e9  ? '$' + (fund.marketCap/1e9).toFixed(1) + 'B'
      : '$' + (fund.marketCap/1e6).toFixed(0) + 'M') : '—';
    const high52 = fund.high52 != null ? '$' + fund.high52.toFixed(2) : (ind?.high52 ? '$' + ind.high52.toFixed(2) : '—');
    const low52  = fund.low52  != null ? '$' + fund.low52.toFixed(2)  : (ind?.low52  ? '$' + ind.low52.toFixed(2)  : '—');
    fundHTML = `<div class="detail-section"> <div class="detail-section-title">Fundamentals</div> <div class="detail-row"><span class="label">Market cap</span><span class="val">${mcap}</span></div> <div class="detail-row"><span class="label">P/E ratio</span><span class="val">${pe}</span></div> <div class="detail-row"><span class="label">PEG ratio</span><span class="val">${peg}</span></div> <div class="detail-row"><span class="label">EPS (TTM)</span><span class="val">${eps}</span></div> <div class="detail-row"><span class="label">Beta</span><span class="val">${beta}</span></div> <div class="detail-row"><span class="label">52-week range</span><span class="val">${low52} – ${high52}</span></div> </div>`;
  }

  $('buyDetailContent').innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
    <div>
      <div style="font-size:22px;font-weight:700;color:var(--text)">${b.ticker}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:2px">${b.name || ''}</div>
      <div style="font-size:18px;font-weight:600;margin-top:6px">${priceStr} <span style="font-size:13px;color:${chgColor}">${b.change || ''}</span></div>
    </div>
    <div style="text-align:center">
      <div style="font-size:28px;font-weight:700;color:${scoreColor}">${score}</div>
      <div style="font-size:10px;color:var(--text3)">score</div>
    </div>
  </div>

  <div class="detail-section">
    <div class="detail-section-title">AI rationale</div>
    <div style="font-size:13px;color:var(--text2);line-height:1.6">${b.reason}</div>
  </div>

  <div class="detail-section">
    <div class="detail-section-title">Technical signals</div>
    ${buySignals.length ? `<div style="margin-bottom:8px">${buySignals.map(s =>
      `<span style="display:inline-block;background:var(--green-bg);color:var(--green);border-radius:99px;padding:3px 10px;font-size:11px;font-weight:500;margin:2px">✓ ${s}</span>`
    ).join('')}</div>` : '<div style="font-size:12px;color:var(--text3);margin-bottom:8px">No buy signals detected</div>'}
    ${sellSignals.length ? `<div>${sellSignals.map(s =>
      `<span style="display:inline-block;background:var(--red-bg);color:var(--red);border-radius:99px;padding:3px 10px;font-size:11px;font-weight:500;margin:2px">⚠ ${s}</span>`
    ).join('')}</div>` : ''}
    ${ind ? `<div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <div style="background:var(--bg3);border-radius:8px;padding:8px 10px"><div style="font-size:10px;color:var(--text3)">RSI (14)</div><div style="font-size:14px;font-weight:600;color:${rsiColor(ind.rsi)}">${ind.rsi ?? '—'}</div></div>
      <div style="background:var(--bg3);border-radius:8px;padding:8px 10px"><div style="font-size:10px;color:var(--text3)">Bollinger %B</div><div style="font-size:14px;font-weight:600;color:${ind.bb ? (ind.bb.pct > 80 ? 'var(--red)' : ind.bb.pct < 20 ? 'var(--green)' : 'var(--text2)') : 'var(--text3)'}">${ind.bb ? ind.bb.pct + '%' : '—'}</div></div>
      <div style="background:var(--bg3);border-radius:8px;padding:8px 10px"><div style="font-size:10px;color:var(--text3)">MACD</div><div style="font-size:14px;font-weight:600;color:${ind.macd?.histogram != null ? (ind.macd.histogram > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)'}">${ind.macd?.histogram != null ? (ind.macd.histogram > 0 ? '▲ Bullish' : '▼ Bearish') : '—'}</div></div>
      <div style="background:var(--bg3);border-radius:8px;padding:8px 10px"><div style="font-size:10px;color:var(--text3)">MA trend</div><div style="font-size:14px;font-weight:600;color:${ind.sma50 && ind.sma200 ? (ind.sma50 > ind.sma200 ? 'var(--green)' : 'var(--red)') : 'var(--text3)'}">${ind.sma50 && ind.sma200 ? (ind.sma50 > ind.sma200 ? '✓ Golden' : '✗ Death') : '—'}</div></div>
    </div>` : '<div style="font-size:12px;color:var(--text3)">Indicator data unavailable</div>'}
  </div>

  ${divHTML}
  ${fundHTML}

  <div class="detail-section">
    <div class="detail-section-title">Charts</div>
    ${chartControlsHTML('buy')}
  </div>

  ${b.macdTrough?.isTrough ? `
        <div style="margin-top:10px;background:var(--green-bg);border:0.5px solid rgba(0,201,122,0.25);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--green)">
          ↗ <strong>MACD Trough Detected</strong> — ${b.macdTrough.summary}. Histogram rising from low, potential momentum shift.
        </div>` : ''}

      <button class="btn-watchlist ${isOnWatchlist(b.ticker) ? 'added' : ''}" onclick="openWlAddModal('${b.ticker}','${b.name}','${b.fundamentals?.sector || ''}','${ind}')">
    ${isOnWatchlist(b.ticker) ? '✓ On Watchlist' : '+ Add to Watchlist'}
  </button>

  <button class="btn-secondary" onclick="$('buyDetailModal').classList.remove('open')" style="margin-top:8px">Close</button>
  `;

  $('buyDetailModal').classList.add('open');
  $('buyDetailModal').onclick = e => { if (e.target === $('buyDetailModal')) $('buyDetailModal').classList.remove('open'); };

  renderTwoPanel(buyChartTicker, buyChartRange, buyChartMom, 'buy');
}
