// ─── API: Schwab via Cloudflare Worker ───────────────────────────────────────
function workerHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-PWA-Secret': settings.pwaSecret || '',
  };
}

function workerUrl(path) {
  const base = (settings.apiKey || '').replace(/\/+$/, '');
  return base + path;
}

async function workerGet(path) {
  if (!settings.apiKey || !settings.pwaSecret) throw new Error('Worker not configured');
  const res = await fetch(workerUrl(path), { headers: workerHeaders() });
  if (res.status === 401) throw new Error('NOT_AUTHENTICATED');
  if (!res.ok) throw new Error(`Worker error ${res.status}`);
  return res.json();
}

async function checkWorkerStatus() {
  const msgEl = $('workerStatusMsg');
  const authLink = $('authLink');
  if (!settings.apiKey) {
    if (msgEl) msgEl.textContent = 'Enter your Worker URL first.';
    return;
  }
  try {
    const health = await fetch(workerUrl('/health'));
    if (!health.ok) throw new Error('Worker unreachable');
    const statusRes = await fetch(workerUrl('/auth/status'));
    const status = await statusRes.json();
    if (status.connected) {
      const warn = status.daysRemaining <= 1;
      if (msgEl) msgEl.innerHTML = `<span style="color:${warn ? 'var(--amber)' : 'var(--green)'}">✓ Connected · Re-auth in ${status.daysRemaining} day${status.daysRemaining !== 1 ? 's' : ''}</span>`;
      updateApiStatus(true);
      if (authLink) authLink.style.display = 'none';
    } else {
      if (msgEl) msgEl.innerHTML = `<span style="color:var(--amber)">⚠ ${status.reason === 'REFRESH_TOKEN_EXPIRED' ? 'Token expired — re-authenticate' : 'Not connected — click Connect Schwab'}</span>`;
      if (authLink) { authLink.href = workerUrl('/auth/login'); authLink.style.display = 'inline-block'; }
      updateApiStatus(false);
    }
  } catch(e) {
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`;
    updateApiStatus(false);
  }
}

async function testAnthropicConnection() {
  const msgEl = $('anthropicStatusMsg');
  if (!msgEl) return;

  const key = $('anthropicKeyInput')?.value.trim() || settings.anthropicKey;
  if (!key) {
    msgEl.innerHTML = '<span style="color:var(--amber)">⚠ Enter an API key first</span>';
    return;
  }

  msgEl.innerHTML = '<span style="color:var(--text3)">Testing…</span>';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 20,
        messages: [{ role: 'user', content: 'Reply with just the word CONNECTED.' }]
      })
    });

    const raw = await res.text();
    console.log('Anthropic test response:', res.status, raw);

    if (res.status === 401) {
      msgEl.innerHTML = '<span style="color:var(--red)">✗ Invalid API key (401) — check the key and try again</span>';
      return;
    }
    if (res.status === 403) {
      msgEl.innerHTML = '<span style="color:var(--red)">✗ Forbidden (403) — browser calls may not be enabled for this key. Check your Anthropic console settings.</span>';
      return;
    }
    if (!res.ok) {
      msgEl.innerHTML = `<span style="color:var(--red)">✗ API error ${res.status}: ${raw.slice(0, 120)}</span>`;
      return;
    }

    let data;
    try { data = JSON.parse(raw); } catch(e) {
      msgEl.innerHTML = `<span style="color:var(--red)">✗ Could not parse response: ${raw.slice(0, 120)}</span>`;
      return;
    }

    if (data.error) {
      msgEl.innerHTML = `<span style="color:var(--red)">✗ ${data.error.type}: ${data.error.message}</span>`;
      return;
    }

    const reply = data.content?.[0]?.text || '';
    msgEl.innerHTML = `<span style="color:var(--green)">✓ Connected — model replied: "${reply}"</span>`;

  } catch(e) {
    if (e.message.includes('fetch') || e.name === 'TypeError') {
      msgEl.innerHTML = '<span style="color:var(--red)">✗ Network/CORS error — the request was blocked before reaching Anthropic. Make sure you\'re on HTTPS.</span>';
    } else {
      msgEl.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`;
    }
    console.error('Anthropic test error:', e);
  }
}

async function fetchPrices(tickers) {
  if (!settings.apiKey || !settings.pwaSecret || tickers.length === 0) return {};
  try {
    const data = await workerGet(`/quotes?symbols=${tickers.join(',')}`);
    if (!data.ok || !data.quotes) return {};
    const out = {};
    Object.entries(data.quotes).forEach(([sym, q]) => {
      if (q.price != null) out[sym.toUpperCase()] = q.price;
    });
    return out;
  } catch(e) {
    console.error('fetchPrices failed:', e);
    if (e.message === 'NOT_AUTHENTICATED') showToast('Schwab auth expired — re-authenticate in Settings');
    return {};
  }
}

async function refreshPrices() {
  if (!settings.apiKey || !settings.pwaSecret) { showToast('Configure Worker URL & secret in Settings'); return; }
  const icon = $('refreshIcon');
  icon.classList.add('spinning');
  const tickers = [...new Set(positions.map(p => p.ticker.toUpperCase()))];
  const prices = await fetchPrices(tickers);
  icon.classList.remove('spinning');
  if (Object.keys(prices).length > 0) {
    positions = positions.map(p => ({ ...p, price: prices[p.ticker.toUpperCase()] ?? p.price }));
    save();
    renderAll();
    showToast('Prices updated ✓');
    updateApiStatus(true);
  } else {
    showToast('Could not fetch prices — check Worker URL & Schwab auth');
    updateApiStatus(false);
  }
}

function updateApiStatus(ok) {
  const el = $('apiStatus');
  if (!settings.apiKey || !settings.pwaSecret) {
    el.className = 'api-status api-none'; el.textContent = 'Worker not configured — prices are manually entered.';
  } else if (ok === true) {
    el.className = 'api-status api-ok'; el.textContent = '✓ Schwab connected — prices auto-refresh on open.';
  } else if (ok === false) {
    el.className = 'api-status api-err'; el.textContent = '✗ Not connected — authenticate in Settings.';
  } else {
    el.className = 'api-status api-none'; el.textContent = 'Worker URL saved — tap "Test connection".';
  }
}

async function fetchFundamentals(tickers) {
  if (!settings.apiKey || !settings.pwaSecret || tickers.length === 0) return {};
  try {
    const data = await workerGet(`/fundamentals?symbols=${tickers.join(',')}`);
    if (!data.ok || !data.fundamentals) return {};
    return data.fundamentals;
  } catch(e) {
    console.warn('fetchFundamentals failed:', e);
    return {};
  }
}

async function fetchMarketDataForWatchlist(tickers) {
  if (!settings.apiKey || !settings.pwaSecret || tickers.length === 0) return [];
  try {
    const data = await workerGet(`/quotes?symbols=${tickers.join(',')}`);
    if (!data.ok || !data.quotes) return [];
    return Object.entries(data.quotes).flatMap(([sym, q]) => {
      if (q.price == null || q.price <= 0) return [];
      const pct = q.changePct != null
        ? (q.changePct > 0 ? '+' : '') + q.changePct.toFixed(2) + '%' : '0%';
      return [{
        ticker: sym.toUpperCase(),
        name: sym.toUpperCase(),
        price: q.price,
        change: pct,
        high: q.high,
        low: q.low,
        prevClose: q.prevClose,
        open: q.openPrice,
      }];
    }).filter(s => s.price > 0);
  } catch(e) {
    console.warn('fetchMarketDataForWatchlist failed:', e);
    return [];
  }
}
