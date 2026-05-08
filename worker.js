/**
 * StockPulse — Schwab API Proxy Worker
 * 
 * Environment variables (set in Cloudflare dashboard, never in code):
 *   SCHWAB_CLIENT_ID      — from Schwab Developer Portal
 *   SCHWAB_CLIENT_SECRET  — from Schwab Developer Portal
 *   SCHWAB_REDIRECT_URI   — must match exactly what's registered in Schwab portal
 *                           e.g. https://your-worker.your-subdomain.workers.dev/auth/callback
 *   PWA_SECRET            — random string you generate; PWA sends this on every request
 *                           Generate with: openssl rand -hex 32
 *
 * KV namespace (bind in wrangler.toml):
 *   SCHWAB_TOKENS         — stores encrypted access + refresh tokens
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const SCHWAB_AUTH_URL   = 'https://api.schwabapi.com/v1/oauth/authorize';
const SCHWAB_TOKEN_URL  = 'https://api.schwabapi.com/v1/oauth/token';
const SCHWAB_API_BASE   = 'https://api.schwabapi.com/marketdata/v1';
const TOKEN_KV_KEY      = 'schwab_tokens';
const ACCESS_TOKEN_TTL  = 25 * 60 * 1000;  // refresh 5min before 30min expiry

// ─── CORS headers (restrict to your GitHub Pages origin in production) ────────
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  // In production, replace '*' with your exact GitHub Pages URL:
  // e.g. 'https://yourusername.github.io'
  const allowed = 'https://jenson24.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-PWA-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

// ─── Response helpers ─────────────────────────────────────────────────────────
function json(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

function error(msg, status = 400, request) {
  return json({ error: msg }, status, request);
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
}

// ─── Token encryption using AES-GCM (Web Crypto API) ─────────────────────────
// We derive an encryption key from the PWA_SECRET so tokens are encrypted at
// rest in KV — even if someone gains KV access they can't use the tokens.
async function getEncryptionKey(secret) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret.slice(0, 32).padEnd(32, '0')),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  return keyMaterial;
}

async function encryptTokens(tokens, secret) {
  const key = await getEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(tokens));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // Combine iv + encrypted and base64 encode
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

async function decryptTokens(encryptedStr, secret) {
  const key = await getEncryptionKey(secret);
  const combined = Uint8Array.from(atob(encryptedStr), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// ─── Token storage ────────────────────────────────────────────────────────────
async function saveTokens(env, tokens) {
  if (!env.SCHWAB_TOKENS) {
    console.error('saveTokens: SCHWAB_TOKENS KV binding is undefined — check wrangler.toml');
    throw new Error('KV binding SCHWAB_TOKENS not found');
  }
  const encrypted = await encryptTokens(tokens, env.PWA_SECRET);
  await env.SCHWAB_TOKENS.put(TOKEN_KV_KEY, encrypted);
  console.log('saveTokens: tokens saved to KV successfully');
}

async function loadTokens(env) {
  if (!env.SCHWAB_TOKENS) {
    console.error('loadTokens: SCHWAB_TOKENS KV binding is undefined — check wrangler.toml');
    return null;
  }
  const encrypted = await env.SCHWAB_TOKENS.get(TOKEN_KV_KEY);
  console.log('loadTokens: KV get result present:', !!encrypted);
  if (!encrypted) return null;
  try {
    const tokens = await decryptTokens(encrypted, env.PWA_SECRET);
    console.log('loadTokens: decryption succeeded');
    return tokens;
  } catch(e) {
    console.error('loadTokens: decryption failed —', e.message,
      '— this usually means PWA_SECRET changed since tokens were saved. Clear KV and re-authenticate.');
    return null;
  }
}

// ─── OAuth token management ───────────────────────────────────────────────────
function basicAuth(clientId, clientSecret) {
  return 'Basic ' + btoa(`${clientId}:${clientSecret}`);
}

async function exchangeCodeForTokens(env, code) {
  const res = await fetch(SCHWAB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(env.SCHWAB_CLIENT_ID, env.SCHWAB_CLIENT_SECRET),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.SCHWAB_REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${body}`);
  }
  const tokens = await res.json();
  tokens.obtained_at = Date.now();
  return tokens;
}

async function refreshAccessToken(env, refreshToken) {
  const res = await fetch(SCHWAB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(env.SCHWAB_CLIENT_ID, env.SCHWAB_CLIENT_SECRET),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${body}`);
  }
  const tokens = await res.json();
  tokens.obtained_at = Date.now();
  return tokens;
}

async function getValidAccessToken(env) {
  const tokens = await loadTokens(env);
  if (!tokens) {
    console.log('getValidAccessToken: no tokens found in KV');
    throw new Error('NOT_AUTHENTICATED');
  }

  console.log('getValidAccessToken: tokens loaded, access_token present:', !!tokens.access_token);

  // Use refresh_obtained_at (set at initial auth) for the 7-day refresh token check.
  // obtained_at is reset on every access token refresh, so it can't be used here.
  const refreshObtainedAt = tokens.refresh_obtained_at || tokens.obtained_at || 0;
  const refreshAge = Date.now() - refreshObtainedAt;
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  if (refreshAge > SEVEN_DAYS - 60 * 60 * 1000) {
    console.log('getValidAccessToken: refresh token expired or near expiry, age ms:', refreshAge);
    throw new Error('REFRESH_TOKEN_EXPIRED');
  }

  // Use obtained_at (reset on each access token refresh) for the 30-min access token check
  const accessAge = Date.now() - (tokens.obtained_at || 0);
  console.log('getValidAccessToken: access token age ms:', accessAge, 'TTL ms:', ACCESS_TOKEN_TTL);
  if (accessAge > ACCESS_TOKEN_TTL) {
    console.log('getValidAccessToken: refreshing access token');
    const refreshed = await refreshAccessToken(env, tokens.refresh_token);
    refreshed.obtained_at = Date.now();
    refreshed.refresh_obtained_at = refreshObtainedAt; // preserve original refresh token timestamp
    await saveTokens(env, refreshed);
    return refreshed.access_token;
  }

  return tokens.access_token;
}

// ─── Schwab API proxy helpers ─────────────────────────────────────────────────
async function schwabGet(env, path, params = {}) {
  const accessToken = await getValidAccessToken(env);
  const url = new URL(SCHWAB_API_BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Schwab API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── Security: validate PWA secret on every data request ─────────────────────
function validatePwaSecret(request, env) {
  const secret = request.headers.get('X-PWA-Secret');
  return secret === env.PWA_SECRET;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

// GET /auth/login — redirect browser to Schwab OAuth consent page
function handleAuthLogin(env) {
  const params = new URLSearchParams({
    client_id: env.SCHWAB_CLIENT_ID,
    redirect_uri: env.SCHWAB_REDIRECT_URI,
    response_type: 'code',
    scope: 'readonly',  // read-only: no trading permissions
  });
  return Response.redirect(`${SCHWAB_AUTH_URL}?${params}`, 302);
}

// GET /auth/callback — Schwab redirects here after user approves
async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return html(`
      <html><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#f0f0f0">
        <h2>❌ Auth failed</h2>
        <p>Schwab returned: ${errorParam}</p>
        <p>${url.searchParams.get('error_description') || ''}</p>
      </body></html>
    `, 400);
  }

  if (!code) {
    return html(`
      <html><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#f0f0f0">
        <h2>❌ No code received</h2>
        <p>Schwab did not return an authorization code.</p>
      </body></html>
    `, 400);
  }

  try {
    const tokens = await exchangeCodeForTokens(env, code);
    tokens.refresh_obtained_at = Date.now();
    await saveTokens(env, tokens);

    // Calculate refresh token expiry for display
    const expiresDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });

    return html(`
      <html><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#f0f0f0;max-width:480px;margin:0 auto">
        <h2 style="color:#00c97a">✅ Authenticated successfully</h2>
        <p>StockPulse is now connected to your Schwab account.</p>
        <div style="background:#141414;border-radius:12px;padding:16px;margin:20px 0;font-size:14px">
          <p style="color:#999;margin:0 0 8px">⚠️ Re-authentication required by:</p>
          <p style="color:#f5a623;font-weight:600;margin:0">${expiresDate}</p>
        </div>
        <p style="color:#666;font-size:13px">Set a calendar reminder to revisit 
          <strong style="color:#4a9eff">${env.SCHWAB_REDIRECT_URI.replace('/auth/callback', '/auth/login')}</strong>
          before this date to avoid disruption.</p>
        <p style="color:#666;font-size:13px">You can close this window and return to StockPulse.</p>
      </body></html>
    `);
  } catch(e) {
    return html(`
      <html><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#f0f0f0">
        <h2>❌ Token exchange failed</h2>
        <p style="color:#ff4d4d">${e.message}</p>
      </body></html>
    `, 500);
  }
}

// GET /auth/status — PWA polls this to check connection state
async function handleAuthStatus(request, env) {
  const tokens = await loadTokens(env);
  if (!tokens) return json({ connected: false, reason: 'NOT_AUTHENTICATED' }, 200, request);

  const refreshAge = Date.now() - (tokens.refresh_obtained_at || tokens.obtained_at || 0);
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const daysRemaining = Math.max(0, Math.floor((SEVEN_DAYS - refreshAge) / 86400000));

  if (refreshAge > SEVEN_DAYS) {
    return json({ connected: false, reason: 'REFRESH_TOKEN_EXPIRED', daysRemaining: 0 }, 200, request);
  }

  return json({
    connected: true,
    daysRemaining,
    expiresAt: new Date(Date.now() + (SEVEN_DAYS - refreshAge)).toISOString(),
    warning: daysRemaining <= 1,
  }, 200, request);
}

// GET /quotes?symbols=AAPL,MSFT,TSLA
// Schwab accepts comma-separated symbols in a single call — very efficient
async function handleQuotes(request, env) {
  const url = new URL(request.url);
  const symbols = url.searchParams.get('symbols');
  if (!symbols) return error('symbols parameter required', 400, request);

  const symbolList = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (symbolList.length === 0) return error('No valid symbols provided', 400, request);
  if (symbolList.length > 50) return error('Max 50 symbols per request', 400, request);

  try {
    // Schwab /quotes endpoint accepts all symbols in one call
    const data = await schwabGet(env, '/quotes', {
      symbols: symbolList.join(','),
      fields: 'quote',
      indicative: false,
    });

    // Normalize to a flat { AAPL: { price, change, changePct, high, low, prevClose, volume } } map
    const normalized = {};
    for (const [symbol, v] of Object.entries(data)) {
      const q = v.quote || v;
      normalized[symbol] = {
        price:      q.lastPrice ?? q.mark ?? null,
        change:     q.netChange ?? null,
        changePct:  q.netPercentChange ?? null,
        high:       q.highPrice ?? null,
        low:        q.lowPrice ?? null,
        prevClose:  q.closePrice ?? null,
        volume:     q.totalVolume ?? null,
        openPrice:  q.openPrice ?? null,
        fiftyTwoWeekHigh: q['52WeekHigh'] ?? null,
        fiftyTwoWeekLow:  q['52WeekLow'] ?? null,
      };
    }

    return json({ ok: true, quotes: normalized }, 200, request);
  } catch(e) {
    if (e.message === 'NOT_AUTHENTICATED' || e.message === 'REFRESH_TOKEN_EXPIRED') {
      return json({ ok: false, error: e.message }, 401, request);
    }
    return error(e.message, 500, request);
  }
}

// GET /history?symbol=AAPL&days=210
// Returns OHLCV arrays for indicator calculation
async function handleHistory(request, env) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol')?.toUpperCase();
  const days = Math.min(parseInt(url.searchParams.get('days') || '210'), 365);

  if (!symbol) return error('symbol parameter required', 400, request);

  try {
    const data = await schwabGet(env, `/pricehistory`, {
      symbol,
      periodType:    'month',
      period:        Math.ceil(days / 30),
      frequencyType: 'daily',
      frequency:     1,
      needExtendedHoursData: false,
    });

    if (!data.candles || data.candles.length === 0) {
      return json({ ok: false, error: 'No history data returned' }, 404, request);
    }

    // Normalize to the same { c, h, l, o, v, t } shape the PWA already uses
    const candles = data.candles;
    return json({
      ok: true,
      symbol,
      c: candles.map(c => c.close),
      h: candles.map(c => c.high),
      l: candles.map(c => c.low),
      o: candles.map(c => c.open),
      v: candles.map(c => c.volume),
      t: candles.map(c => c.datetime),
    }, 200, request);
  } catch(e) {
    if (e.message === 'NOT_AUTHENTICATED' || e.message === 'REFRESH_TOKEN_EXPIRED') {
      return json({ ok: false, error: e.message }, 401, request);
    }
    return error(e.message, 500, request);
  }
}

// GET /auth/debug — diagnose KV binding and token state (no secret needed)
// Remove or restrict this in production once everything is working
async function handleAuthDebug(request, env) {
  const kvBound = !!env.SCHWAB_TOKENS;
  const pwaSecretSet = !!env.PWA_SECRET;
  const clientIdSet = !!env.SCHWAB_CLIENT_ID;
  const clientSecretSet = !!env.SCHWAB_CLIENT_SECRET;
  const redirectUriSet = !!env.SCHWAB_REDIRECT_URI;

  let kvReadResult = 'not attempted';
  let tokenPresent = false;
  let decryptOk = false;
  let tokenFields = null;

  if (kvBound) {
    try {
      const raw = await env.SCHWAB_TOKENS.get(TOKEN_KV_KEY);
      kvReadResult = raw ? `found (${raw.length} chars)` : 'empty (null)';
      if (raw && pwaSecretSet) {
        try {
          const tokens = await decryptTokens(raw, env.PWA_SECRET);
          decryptOk = true;
          tokenPresent = !!tokens.access_token;
          tokenFields = {
            has_access_token: !!tokens.access_token,
            has_refresh_token: !!tokens.refresh_token,
            obtained_at: tokens.obtained_at ? new Date(tokens.obtained_at).toISOString() : null,
            refresh_obtained_at: tokens.refresh_obtained_at
              ? new Date(tokens.refresh_obtained_at).toISOString() : null,
            access_token_age_min: tokens.obtained_at
              ? Math.round((Date.now() - tokens.obtained_at) / 60000) : null,
            refresh_token_age_days: tokens.refresh_obtained_at
              ? Math.round((Date.now() - tokens.refresh_obtained_at) / 86400000) : null,
          };
        } catch(e) {
          kvReadResult += ' — decryption failed: ' + e.message;
        }
      }
    } catch(e) {
      kvReadResult = 'KV read error: ' + e.message;
    }
  }

  const body = {
    bindings: { SCHWAB_TOKENS: kvBound, PWA_SECRET: pwaSecretSet,
                SCHWAB_CLIENT_ID: clientIdSet, SCHWAB_CLIENT_SECRET: clientSecretSet,
                SCHWAB_REDIRECT_URI: redirectUriSet },
    kv: { bound: kvBound, readResult: kvReadResult, decryptOk, tokenPresent },
    token: tokenFields,
    hint: !kvBound
      ? 'KV binding missing — check wrangler.toml [[kv_namespaces]] id and redeploy'
      : !tokenPresent
      ? 'KV bound but no token — visit /auth/login to authenticate'
      : 'Everything looks good',
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}

// GET /accounts — STUBBED: returns empty until user enables it
async function handleAccounts(request, env) {
  // Intentionally stubbed — enable after testing is complete
  return json({
    ok: true,
    stubbed: true,
    message: 'Account sync not yet enabled. Add positions manually in the app.',
    positions: [],
  }, 200, request);
}

// ─── Main router ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ── Auth routes (no PWA secret needed — these are browser-visited pages) ──
    if (path === '/auth/login')    return handleAuthLogin(env);
    if (path === '/auth/callback') return handleAuthCallback(request, env);
    if (path === '/auth/status')   return handleAuthStatus(request, env);
    if (path === '/auth/debug')    return handleAuthDebug(request, env);

    // ── Health check ──────────────────────────────────────────────────────────
    if (path === '/health') {
      return json({ ok: true, version: '1.0.0', ts: Date.now() }, 200, request);
    }

    // ── All data routes require PWA secret header ─────────────────────────────
    if (!validatePwaSecret(request, env)) {
      return error('Unauthorized', 401, request);
    }

    if (path === '/quotes')   return handleQuotes(request, env);
    if (path === '/history')  return handleHistory(request, env);
    if (path === '/accounts') return handleAccounts(request, env);

    return error('Not found', 404, request);
  }
};
