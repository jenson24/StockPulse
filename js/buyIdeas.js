// ─── AI Buy Ideas Engine ──────────────────────────────────────────────────────
const DEFAULT_WATCHLIST = 'AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,JPM,BRK.B,XLV,V,UNH,HD,PG,JNJ';

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

async function generateBuyIdeasWithAI(marketData, portfolioTickers, universeIndicators = {}) {
  if (!settings.anthropicKey) return null;

  const portfolioContext = portfolioTickers.length > 0
    ? `The user currently holds: ${portfolioTickers.join(', ')}. Do NOT recommend any of these.`
    : 'The user has no current positions.';

  const marketSummary = marketData.map(s => {
    const ind = universeIndicators[s.ticker] || {};
    const price = s.price?.toFixed(2) ?? 'N/A';
    const rsi = ind.rsi != null ? `RSI ${ind.rsi}` : '';
    const bb = ind.bb != null ? `BB%B ${ind.bb.pct}%` : '';
    const macd = ind.macd?.histogram != null ? `MACD ${ind.macd.histogram > 0 ? '▲' : '▼'}` : '';
    const ma = (ind.sma50 && ind.sma200) ? (ind.sma50 > ind.sma200 ? 'golden cross' : 'death cross') : '';
    const vol = ind.volRatio != null ? `vol ${(ind.volRatio * 100).toFixed(0)}% of avg` : '';
    const buys = ind.buySignals?.length ? `buy signals: ${ind.buySignals.join(', ')}` : '';
    const sells = ind.sellSignals?.length ? `sell signals: ${ind.sellSignals.join(', ')}` : '';
    const indicators = [rsi, bb, macd, ma, vol, buys, sells].filter(Boolean).join(' | ');
    return `${s.ticker}: $${price} (${s.change})${indicators ? ' — ' + indicators : ''}`;
  }).join('\n');

  const prompt = `You are a technical stock analyst. Select the 5 best buy opportunities from the list below based on the computed technical indicators.

${portfolioContext}

Today's technical data:
${marketSummary || 'No live data available — use your training knowledge for these tickers.'}

Scoring rules:
- 80–100: Multiple confirming buy signals (e.g. RSI oversold + near lower BB + MACD bullish + golden cross)
- 65–79: 1–2 buy signals, no major sell signals
- 50–64: Speculative or mixed signals
- Penalise heavily for sell signals (RSI overbought, near upper BB, death cross)
- Reward for volume confirmation of a move

Respond with ONLY a valid JSON array, no markdown, no preamble:
[
  {
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "price": 178.50,
    "change": "+1.2%",
    "score": 82,
    "tag": "Momentum",
    "reason": "2-3 sentence rationale citing the specific indicator values above."
  }
]

Tag must be one of: Momentum, Value, Sector, Dividend, Growth`;

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
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error('Anthropic API error in generateBuyIdeasWithAI:', res.status, errBody);
      return null;
    }
    const data = await res.json();
    const text = data.content?.map(c => c.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    console.error('AI generation failed:', e);
    return null;
  }
}

async function askAIForUniverse(portfolioTickers, portfolioIndicators) {
  if (!settings.anthropicKey) return null;
  const portSummary = portfolioTickers.map(t => {
    const ind = portfolioIndicators[t] || {};
    return `${t} (RSI ${ind.rsi ?? 'N/A'}, ${ind.sma50 && ind.sma200 ? (ind.sma50 > ind.sma200 ? 'golden cross' : 'death cross') : 'MA N/A'})`;
  }).join(', ');

  const prompt = `You are a portfolio analyst. A user holds: ${portSummary || 'no positions yet'}.

Pick exactly 20 US stock tickers that would be worth scanning for buy opportunities today. Consider:
- Sectors not already represented in the portfolio (diversification)
- Stocks with current momentum or value setups based on your knowledge
- Mix of large-cap, mid-cap, and sector ETFs
- Avoid any tickers already held: ${portfolioTickers.join(', ') || 'none'}

Respond with ONLY a JSON array of ticker strings, e.g. ["AAPL","MSFT",...]. No markdown, no explanation.`;

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
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error('Anthropic API error in askAIForUniverse:', res.status, errBody);
      return null;
    }
    const data = await res.json();
    const text = data.content?.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch(e) {
    console.warn('Universe generation failed:', e);
    return null;
  }
}

async function loadBuyIdeas(forceRefresh = false) {
  const el = $('buysList');

  const cached = loadCachedBuys();
  if (!forceRefresh && cached) {
    cachedBuyIdeas = cached;
    renderBuyCards(cached);
    return;
  }

  if (!forceRefresh && !cached) {
    el.innerHTML = `<div style="text-align:center;padding:50px 20px">
      <div style="font-size:32px;margin-bottom:12px">🤖</div>
      <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:8px">Ready to generate today's picks</div>
      <div style="font-size:13px;color:var(--text3);margin-bottom:24px;line-height:1.6">Claude will select a universe of stocks to scan based on your portfolio, fetch live data, and score each one using RSI, Bollinger Bands, MACD, and momentum.</div>
      <button onclick="loadBuyIdeas(true)" style="background:var(--accent);color:#fff;border:none;border-radius:14px;padding:14px 28px;font-size:15px;font-weight:600;cursor:pointer">Generate today's picks</button>
    </div>`;
    return;
  }

  el.innerHTML = `<div style="text-align:center;padding:40px 20px">
    <div style="font-size:13px;color:var(--text3);margin-bottom:6px">Step 1/3 — AI selecting universe…</div>
    <div id="buyLoadStatus" style="font-size:11px;color:var(--text3);margin-bottom:16px">Asking Claude which stocks to scan</div>
    <div style="display:flex;justify-content:center;gap:6px">
      <div style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1.2s ease-in-out infinite"></div>
      <div style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1.2s ease-in-out 0.4s infinite"></div>
      <div style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1.2s ease-in-out 0.8s infinite"></div>
    </div>
  </div>
  <style>@keyframes pulse{0%,100%{opacity:0.2}50%{opacity:1}}</style>`;

  const setStatus = (step, msg) => {
    const el2 = $('buyLoadStatus');
    if (el2) { el2.previousElementSibling.textContent = `Step ${step}/3 — ${msg}`; }
  };

  const portfolioTickers = positions.map(p => p.ticker.toUpperCase());

  let universe = await askAIForUniverse(portfolioTickers, currentIndicators);
  if (!universe || universe.length === 0) {
    universe = (settings.watchlist || DEFAULT_WATCHLIST).split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  }
  universe = universe.slice(0, 20);
  setStatus(2, `Fetching live data for ${universe.length} stocks…`);

  let marketData = [];
  let universeIndicators = {};
  if (settings.apiKey) {
    marketData = await fetchMarketDataForWatchlist(universe);
    const indResults = await fetchAllIndicators(universe);
    universeIndicators = indResults;
  }

  setStatus(3, 'Scoring picks with AI…');

  let ideas = null;
  if (settings.anthropicKey) {
    ideas = await generateBuyIdeasWithAI(marketData, portfolioTickers, universeIndicators);
  }

  if (ideas && ideas.length > 0) {
    setStatus(3, 'Fetching fundamentals…');
    const pickedTickers = ideas.map(i => i.ticker);
    const fundamentals = settings.apiKey ? await fetchFundamentals(pickedTickers) : {};

    ideas = ideas.map(idea => ({
      ...idea,
      indicators: universeIndicators[idea.ticker] || null,
      fundamentals: fundamentals[idea.ticker] || null,
    }));

    saveBuyCache(ideas);
    cachedBuyIdeas = ideas;
    renderBuyCards(ideas);
    showToast('Buy ideas ready ✓');
  } else {
    el.innerHTML = `<div class="empty"> <div class="empty-icon">🤖</div> <div class="empty-title">Add API keys to enable AI picks</div> <div class="empty-sub">Go to Settings and add your Anthropic API key (for AI analysis) and configure your Schwab Worker URL to enable live market data.</div> </div>`;
  }
}

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
    const tagClass = b.tag === 'Momentum' || b.tag === 'Growth' ? 'pill-green' : b.tag === 'Value' || b.tag === 'Dividend' ? 'pill-amber' : 'pill-blue';
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

  <button class="btn-watchlist ${isOnWatchlist(b.ticker) ? 'added' : ''}" onclick="openWlAddModal('${b.ticker}','${b.name}','${b.fundamentals?.sector || ''}','${ind}')">
    ${isOnWatchlist(b.ticker) ? '✓ On Watchlist' : '+ Add to Watchlist'}
  </button>

  <button class="btn-secondary" onclick="$('buyDetailModal').classList.remove('open')" style="margin-top:8px">Close</button>
  `;

  $('buyDetailModal').classList.add('open');
  $('buyDetailModal').onclick = e => { if (e.target === $('buyDetailModal')) $('buyDetailModal').classList.remove('open'); };

  renderTwoPanel(buyChartTicker, buyChartRange, buyChartMom, 'buy');
}
