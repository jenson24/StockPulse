// ─── Sector & Concentration Engine ───────────────────────────────────────────
const SECTOR_COLORS = [
  '#4a9eff','#00c97a','#f5a623','#ff4d4d','#a78bfa',
  '#38bdf8','#fb923c','#34d399','#f472b6','#facc15'
];

const SECTOR_MAP = {};

const STATIC_SECTORS = {
  AAPL:'Technology',MSFT:'Technology',NVDA:'Technology',GOOGL:'Communication Services',
  GOOG:'Communication Services',META:'Communication Services',AMZN:'Consumer Discretionary',
  TSLA:'Consumer Discretionary',JPM:'Financials',BAC:'Financials',WFC:'Financials',
  GS:'Financials',MS:'Financials',V:'Financials',MA:'Financials',
  JNJ:'Healthcare',UNH:'Healthcare',PFE:'Healthcare',ABBV:'Healthcare',MRK:'Healthcare',
  LLY:'Healthcare',XLV:'Healthcare',
  XOM:'Energy',CVX:'Energy',COP:'Energy',
  HD:'Consumer Discretionary',NKE:'Consumer Discretionary',MCD:'Consumer Discretionary',
  PG:'Consumer Staples',KO:'Consumer Staples',PEP:'Consumer Staples',WMT:'Consumer Staples',
  COST:'Consumer Staples',
  NEE:'Utilities',DUK:'Utilities',SO:'Utilities',
  AMT:'Real Estate',PLD:'Real Estate',SPG:'Real Estate',
  CAT:'Industrials',BA:'Industrials',HON:'Industrials',UPS:'Industrials',GE:'Industrials',
  LIN:'Materials',FCX:'Materials',NEM:'Materials',
  BRK:'Financials','BRK.B':'Financials','BRK.A':'Financials',
  SPY:'ETF - Broad',QQQ:'ETF - Broad',IWM:'ETF - Broad',VTI:'ETF - Broad',
  XLK:'ETF - Technology',XLF:'ETF - Financials',XLE:'ETF - Energy',XLI:'ETF - Industrials',
  GLD:'Commodities',SLV:'Commodities',TLT:'Fixed Income',AGG:'Fixed Income',
};

async function fetchSectorForTicker(ticker) {
  const up = ticker.toUpperCase();
  if (STATIC_SECTORS[up]) return STATIC_SECTORS[up];
  if (!settings.apiKey || !settings.pwaSecret) return null;
  try {
    const data = await workerGet(`/fundamentals?symbols=${encodeURIComponent(up)}`);
    if (data.ok && data.fundamentals && data.fundamentals[up]) {
      const sector = data.fundamentals[up].sector || data.fundamentals[up].assetType || null;
      return sector || null;
    }
  } catch(e) { console.warn('fetchSector failed for', up, e); }
  return null;
}

function getSector(ticker) {
  const up = ticker.toUpperCase();
  const pos = positions.find(p => p.ticker.toUpperCase() === up);
  if (pos?.sector) return pos.sector;
  return STATIC_SECTORS[up] || 'Other';
}

function computeConcentration() {
  if (positions.length === 0) return { totalVal: 0, bySector: {}, byPosition: [], sectorColors: {} };
  const totalVal = positions.reduce((s, p) => s + p.shares * p.price, 0);
  const bySector = {};
  const byPosition = positions.map((p, i) => {
    const val = p.shares * p.price;
    const pct = totalVal > 0 ? val / totalVal * 100 : 0;
    const sector = getSector(p.ticker);
    bySector[sector] = (bySector[sector] || 0) + pct;
    return { i, ticker: p.ticker, name: p.name, val, pct, sector };
  }).sort((a, b) => b.pct - a.pct);

  const sectorsSorted = Object.entries(bySector).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const sectorColors = {};
  sectorsSorted.forEach((s, i) => { sectorColors[s] = SECTOR_COLORS[i % SECTOR_COLORS.length]; });

  return { totalVal, bySector, byPosition, sectorColors };
}

async function enrichPositionSector(ticker) {
  const up = ticker.toUpperCase();
  const pos = positions.find(p => p.ticker.toUpperCase() === up);
  if (!pos || pos.sector) return;
  const sector = await fetchSectorForTicker(up);
  if (sector) {
    pos.sector = sector;
    save();
  }
}
