# StockPulse — Schwab API Cloudflare Worker

Secure OAuth 2.0 proxy between your StockPulse PWA and the Charles Schwab API.
Your Schwab credentials never touch the browser.

---

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [Node.js](https://nodejs.org) installed
- Wrangler CLI: `npm install -g wrangler`
- Your Schwab Developer app **Client ID** and **Client Secret**

---

## Step 1 — Generate your PWA secret

This is a shared secret between the Worker and your PWA. It prevents
unauthorized access to your Worker endpoints.

```bash
openssl rand -hex 32
```

Save this output — you'll need it in Step 3 and in the PWA settings.

---

## Step 2 — Create the KV namespace

Tokens are stored encrypted in Cloudflare KV.

```bash
wrangler login
wrangler kv:namespace create SCHWAB_TOKENS
```

Copy the `id` from the output and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SCHWAB_TOKENS"
id = "YOUR_ID_HERE"   # ← paste here
```

---

## Step 3 — Set secrets (never put these in wrangler.toml)

```bash
wrangler secret put SCHWAB_CLIENT_ID
# paste your Schwab Client ID when prompted

wrangler secret put SCHWAB_CLIENT_SECRET
# paste your Schwab Client Secret when prompted

wrangler secret put SCHWAB_REDIRECT_URI
# paste: https://stockpulse-schwab-proxy.YOUR-SUBDOMAIN.workers.dev/auth/callback

wrangler secret put PWA_SECRET
# paste the hex string from Step 1
```

---

## Step 4 — Register the callback URL with Schwab

In the [Schwab Developer Portal](https://developer.schwab.com):

1. Open your app → Edit
2. Add this exact URL to **Callback URLs**:
   `https://stockpulse-schwab-proxy.YOUR-SUBDOMAIN.workers.dev/auth/callback`
3. Save (may require re-approval)

The URL must match **exactly** including no trailing slash.

---

## Step 5 — Deploy

```bash
wrangler deploy
```

Your Worker will be live at:
`https://stockpulse-schwab-proxy.YOUR-SUBDOMAIN.workers.dev`

---

## Step 6 — Initial authentication

Open this URL in your browser to connect your Schwab account:

```
https://stockpulse-schwab-proxy.YOUR-SUBDOMAIN.workers.dev/auth/login
```

This redirects you to Schwab's login page. After approving access, you'll
be redirected back with a success message showing the re-auth deadline.

---

## Step 7 — Add Worker URL to PWA Settings

In StockPulse → Settings:
- **Schwab Worker URL**: `https://stockpulse-schwab-proxy.YOUR-SUBDOMAIN.workers.dev`
- **PWA Secret**: the hex string from Step 1

---

## Weekly re-authentication

Schwab refresh tokens expire after **7 days**. The app will show a warning
banner when re-auth is due. Simply revisit:

```
https://stockpulse-schwab-proxy.YOUR-SUBDOMAIN.workers.dev/auth/login
```

**Recommended:** Set a weekly calendar reminder.

---

## Worker endpoints

| Method | Path | Auth required | Description |
|--------|------|---------------|-------------|
| GET | `/health` | None | Worker health check |
| GET | `/auth/login` | None | Start Schwab OAuth flow |
| GET | `/auth/callback` | None | OAuth callback (Schwab redirects here) |
| GET | `/auth/status` | None | Check connection + days until re-auth |
| GET | `/quotes?symbols=AAPL,MSFT` | X-PWA-Secret | Batch quotes |
| GET | `/history?symbol=AAPL&days=210` | X-PWA-Secret | OHLCV for indicators |
| GET | `/accounts` | X-PWA-Secret | Portfolio positions (stubbed) |

---

## Security notes

- Schwab credentials live **only** in Cloudflare encrypted secrets — never in code or config files
- Tokens stored in KV are **AES-GCM encrypted** using your PWA secret as the key
- All data endpoints require the `X-PWA-Secret` header
- Schwab app is registered with **read-only** scope — no trading permissions
- Lock down your Cloudflare account with a strong password and hardware 2FA

---

## Troubleshooting

**401 on data endpoints** — check that PWA secret in Settings matches `wrangler secret put PWA_SECRET`

**`NOT_AUTHENTICATED`** — visit `/auth/login` to connect your Schwab account

**`REFRESH_TOKEN_EXPIRED`** — visit `/auth/login` to re-authenticate (weekly)

**Callback URL mismatch** — the URL in Schwab portal must match `SCHWAB_REDIRECT_URI` secret exactly

**KV not found** — make sure the namespace ID in `wrangler.toml` matches `wrangler kv:namespace list`
