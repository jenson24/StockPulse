# StockPulse — iPhone Stock Portfolio Tracker

A Progressive Web App (PWA) for tracking your stock portfolio with live prices, RSI/moving average sell signals, daily buy ideas, and tax implications.

## Features

- **Portfolio tracking** — Add positions with ticker, shares, cost basis, and purchase date
- **Live prices** — Auto-refresh via Yahoo Finance API (RapidAPI)
- **Sell signals** — RSI (14) and P&L-based alerts flag overbought positions
- **Tax calculator** — Long vs. short-term capital gains based on your purchase date and personal tax rates
- **Buy ideas** — Daily curated picks across momentum, value, and sector categories
- **Offline support** — Works without internet via service worker caching

---

## Deploy to GitHub Pages (5 minutes)

### Step 1 — Create a new GitHub repository

1. Go to [github.com/new](https://github.com/new)
2. Name it `stockpulse` (or anything you like)
3. Set it to **Public**
4. Click **Create repository**

### Step 2 — Upload the files

**Option A: GitHub web interface (easiest)**
1. In your new repo, click **Add file → Upload files**
2. Upload everything in this folder (drag the whole folder contents)
3. Click **Commit changes**

**Option B: Git CLI**
```bash
cd portfolio-pwa
git init
git add .
git commit -m "Initial StockPulse PWA"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/stockpulse.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. The included `.github/workflows/deploy.yml` will auto-deploy on every push

Your app will be live at: `https://YOUR_USERNAME.github.io/stockpulse/`

---

## Add to iPhone Home Screen

1. Open the URL above in **Safari** on your iPhone
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add**

The app will appear on your home screen and behave like a native app — full screen, no browser chrome.

---

## Yahoo Finance API Setup

1. Go to [rapidapi.com](https://rapidapi.com)
2. Search for **"Yahoo Finance"** — subscribe to the **yahoo-finance15** API (free tier available)
3. Copy your **RapidAPI Key**
4. Open StockPulse → tap **Settings** → paste your key → **Save settings**

Prices will now auto-refresh when you open the app and when you add a new position.

---

## Tax Settings

In **Settings**, enter your:
- **Short-term rate** — your federal income tax bracket (e.g. 22%, 24%, 32%)
- **Long-term rate** — your capital gains bracket (0%, 15%, or 20%)
- **State rate** — your state capital gains rate (e.g. CA = 13.3%, TX = 0%)

The app determines long vs. short-term treatment based on your purchase date (>1 year = long-term). Each position detail view shows both scenarios side-by-side and alerts you if waiting longer would save on taxes.

---

## Updating the App

Any time you push a change to the `main` branch, GitHub Actions re-deploys automatically within ~60 seconds.

---

*Not financial advice. For informational use only.*
