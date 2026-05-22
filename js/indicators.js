// ─── Technical Indicator Engine ──────────────────────────────────────────────
const indicatorCache = {};  // { AAPL: { indicators: {...}, ts: Date.now() } }

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcMACD(closes) {
  if (closes.length < 35) return null;
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (ema12 === null || ema26 === null) return null;
  const macdLine = ema12 - ema26;

  // Build MACD line series for the last 9 bars (for signal) + extra bars for momentum
  const lookback = Math.min(closes.length - 26, 20); // up to 20 bars of MACD history
  const macdSeries = [];
  for (let i = closes.length - lookback; i <= closes.length - 1; i++) {
    const e12 = calcEMA(closes.slice(0, i + 1), 12);
    const e26 = calcEMA(closes.slice(0, i + 1), 26);
    if (e12 !== null && e26 !== null) macdSeries.push(e12 - e26);
  }

  // Signal line = 9-period EMA of MACD (proper EMA, not simple average)
  let signal = null;
  if (macdSeries.length >= 9) {
    signal = calcEMA(macdSeries, 9);
  } else if (macdSeries.length > 0) {
    signal = macdSeries.reduce((a, b) => a + b, 0) / macdSeries.length;
  }
  const histogram = signal !== null ? macdLine - signal : null;

  // ── Momentum metrics ──────────────────────────────────────────────────────

  // Slope: rate of change of the MACD line over the last 3 bars
  let slope = null;
  if (macdSeries.length >= 3) {
    const recent = macdSeries.slice(-3);
    slope = (recent[2] - recent[0]) / 2; // average rise per bar
  }

  // Divergence: compare MACD direction vs price direction over last 5 bars
  // Positive = bullish divergence (price falling, MACD rising)
  // Negative = bearish divergence (price rising, MACD falling)
  let divergence = null;
  let divergenceType = null;
  if (macdSeries.length >= 5 && closes.length >= 5) {
    const priceDelta = closes[closes.length - 1] - closes[closes.length - 5];
    const macdDelta = macdSeries[macdSeries.length - 1] - macdSeries[macdSeries.length - 5];
    // Divergence exists when price and MACD move in opposite directions
    if (priceDelta < 0 && macdDelta > 0) {
      divergence = Math.abs(macdDelta); // bullish
      divergenceType = 'bullish';
    } else if (priceDelta > 0 && macdDelta < 0) {
      divergence = -Math.abs(macdDelta); // bearish
      divergenceType = 'bearish';
    } else {
      divergence = 0;
      divergenceType = 'none';
    }
  }

  // Rate of change: % change in MACD line vs 5 bars ago
  let roc = null;
  if (macdSeries.length >= 5) {
    const prev = macdSeries[macdSeries.length - 5];
    const curr = macdSeries[macdSeries.length - 1];
    // Avoid division by near-zero; use price scale instead
    const priceRef = Math.abs(closes[closes.length - 1]);
    roc = priceRef > 0 ? ((curr - prev) / priceRef) * 100 : null;
  }

  // Momentum strength label
  let momentumLabel = null;
  if (slope !== null) {
    const absSlope = Math.abs(slope);
    const priceScale = closes[closes.length - 1] * 0.001; // 0.1% of price as threshold
    if (absSlope > priceScale * 2) momentumLabel = slope > 0 ? 'Accelerating ↑' : 'Accelerating ↓';
    else if (absSlope > priceScale) momentumLabel = slope > 0 ? 'Building ↑' : 'Fading ↓';
    else momentumLabel = 'Flat';
  }

  return { macdLine, signal, histogram, slope, divergence, divergenceType, roc, momentumLabel };
}

function calcBollinger(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = sma + multiplier * stdDev;
  const lower = sma - multiplier * stdDev;
  const price = closes[closes.length - 1];
  const pct = (price - lower) / (upper - lower);
  return { upper, lower, mid: sma, pct: Math.round(pct * 100) };
}

function computeAllIndicators(candles) {
  const c = candles.c;
  const v = candles.v || [];
  if (!c || c.length < 20) return null;

  const rsi = calcRSI(c, 14);
  const sma50 = calcSMA(c, Math.min(50, c.length));
  const sma200 = calcSMA(c, Math.min(200, c.length));
  const macd = calcMACD(c);
  const bb = calcBollinger(c, 20, 2);
  const price = c[c.length - 1];

  const avgVol20 = v.length >= 20
    ? v.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const lastVol = v.length > 0 ? v[v.length - 1] : null;
  const volRatio = (avgVol20 && lastVol) ? lastVol / avgVol20 : null;

  const high52 = Math.max(...c);
  const low52 = Math.min(...c);
  const rangePos = high52 > low52
    ? Math.round(((price - low52) / (high52 - low52)) * 100) : null;

  const sellSignals = [];
  const buySignals = [];

  if (rsi !== null) {
    if (rsi > 70) sellSignals.push(`RSI ${rsi} overbought`);
    else if (rsi > 62) sellSignals.push(`RSI ${rsi} elevated`);
    if (rsi < 30) buySignals.push(`RSI ${rsi} oversold`);
    else if (rsi < 40) buySignals.push(`RSI ${rsi} low`);
  }
  if (bb !== null) {
    if (bb.pct >= 90) sellSignals.push('Near upper Bollinger Band');
    if (bb.pct <= 10) buySignals.push('Near lower Bollinger Band');
  }
  if (sma50 !== null && price < sma50) sellSignals.push('Below 50-day MA');
  if (sma50 !== null && price > sma50) buySignals.push('Above 50-day MA');
  if (sma50 !== null && sma200 !== null) {
    if (sma50 < sma200) sellSignals.push('Death cross (50MA < 200MA)');
    if (sma50 > sma200) buySignals.push('Golden cross (50MA > 200MA)');
  }
  if (macd !== null && macd.histogram !== null) {
    if (macd.histogram < 0 && macd.macdLine < 0) {
      const extra = macd.divergenceType === 'bullish' ? ' (bullish divergence)' : macd.momentumLabel && macd.momentumLabel !== 'Flat' ? ` · ${macd.momentumLabel}` : '';
      sellSignals.push(`MACD bearish${extra}`);
    }
    if (macd.histogram > 0 && macd.macdLine > 0) {
      const extra = macd.divergenceType === 'bearish' ? ' (bearish divergence)' : macd.momentumLabel && macd.momentumLabel !== 'Flat' ? ` · ${macd.momentumLabel}` : '';
      buySignals.push(`MACD bullish${extra}`);
    }
    if (macd.divergenceType === 'bullish' && !(macd.histogram < 0 && macd.macdLine < 0)) {
      buySignals.push('MACD bullish divergence');
    }
    if (macd.divergenceType === 'bearish' && !(macd.histogram > 0 && macd.macdLine > 0)) {
      sellSignals.push('MACD bearish divergence');
    }
  }
  if (volRatio !== null && volRatio > 1.5) {
    if (sellSignals.length > 0) sellSignals.push('High volume confirms');
    if (buySignals.length > 0) buySignals.push('High volume confirms');
  }

  return { rsi, sma50, sma200, macd, bb, price, high52, low52, rangePos,
           volRatio, sellSignals, buySignals };
}

async function fetchIndicators(ticker) {
  const upper = ticker.toUpperCase();
  const cached = indicatorCache[upper];
  if (cached && Date.now() - cached.ts < 3600000) return cached.indicators;
  if (!settings.apiKey || !settings.pwaSecret) return null;
  try {
    const data = await workerGet(`/history?symbol=${encodeURIComponent(upper)}&days=210`).catch(() => null);
    if (!data || !data.ok || !data.c || data.c.length < 20) return null;
    const indicators = computeAllIndicators(data);
    if (indicators) {
      const raw = data.c.map((c, i) => ({ c, h: data.h?.[i], l: data.l?.[i], o: data.o?.[i], v: data.v?.[i], t: data.t?.[i] }));
      indicatorCache[upper] = { indicators, raw, ts: Date.now() };
    }
    return indicators;
  } catch(e) {
    console.warn('Indicator fetch failed for', ticker, e);
    return null;
  }
}

async function fetchAllIndicators(tickers) {
  const results = await Promise.all(tickers.map(t => fetchIndicators(t)));
  const map = {};
  tickers.forEach((t, i) => { if (results[i] !== null) map[t.toUpperCase()] = results[i]; });
  return map;
}

function rsiColor(v) { return v > 70 ? '#ff4d4d' : v < 30 ? '#00c97a' : '#999'; }
function rsiLabel(v) { return v > 70 ? 'Overbought' : v < 30 ? 'Oversold' : 'Neutral'; }
function indColor(val, goodHigh) {
  return val === null ? 'var(--text3)' : goodHigh
    ? (val > 60 ? 'var(--green)' : val < 40 ? 'var(--red)' : 'var(--text2)')
    : (val > 60 ? 'var(--red)' : val < 40 ? 'var(--green)' : 'var(--text2)');
}
