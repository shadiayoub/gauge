# Gauge — personal multi-market technical analysis dashboard

Gauge is a small, self-hosted dashboard that computes **technical analysis
summaries** for any mix of **forex, metals, indices, crypto and stocks** — the
same 5-level verdicts you see on
[investing.com](https://www.investing.com/crypto/bitcoin/technical):
`Strong Sell · Sell · Neutral · Buy · Strong Buy`, with a needle gauge, an
oscillator breakdown and a moving-average breakdown for every market.

It runs on plain Node.js with **zero npm dependencies**.

```
┌────────────┐   ┌───────────────┐   ┌──────────────────────────────┐
│  Providers │ → │  Indicators   │ → │  Rating (SS/S/N/B/SB) + gauge │
│ Binance    │   │ RSI STOCH MACD│   │  oscillators / MA summaries   │
│ TwelveData │   │ ADX CCI WR ATR│   │                               │
│ Yahoo/Stooq│   │ UO ROC BBP …  │   │                               │
└────────────┘   └───────────────┘   └──────────────────────────────┘
```

---

## Quick start

Requirements: **Node.js 18+** (uses the built-in global `fetch`). No install step.

```bash
node server.js
# or: npm start
```

Then open **http://localhost:4317**.

Out of the box:

- **Crypto** (BTCUSD, ETHUSD, SOLUSD …) streams live from **Binance** — no key.
- **XAUUSD** uses Binance's gold-backed **PAXG** token as a proxy when no spot
  feed is configured (clearly labelled in the UI).
- Everything else tries Yahoo / Stooq, and falls back to a **clearly-labelled
  simulator** so the dashboard always renders.

### Recommended: add a free Twelve Data key

One key lights up **XAUUSD, XAGUSD, indices, stocks and crypto** from a single
real source (exact coverage depends on your Twelve Data plan). Get a free key in
~10 seconds at <https://twelvedata.com/pricing>, then either:

1. Open **⚙ Settings** in the app and paste it, or
2. Set an env var:

```bash
TWELVEDATA_API_KEY=your_key_here node server.js
```

Or copy `.env.example` to `.env` — the server has a tiny built-in `.env` loader
(no dependency), and real environment variables always take precedence.

---

## Features

- **Watchlist** persisted to `data/watchlist.json`; add any symbol with the
  input box (with autocomplete) and remove with the hover **×**.
- **Timeframes**: 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M — switch globally or per
  market in the detail view.
- **Detail modal** per market with the full oscillator and moving-average
  tables (value + action per indicator), a rating gauge and buy/sell/neutral
  counts.
- **Multiple providers with automatic fallback** and a visible source badge, so
  you always know whether data is live, proxied or simulated.
- **Server-side caching** with per-timeframe TTLs to respect free-tier limits.
- **Auto-refresh** on a configurable interval.
- **Configurable "Strong" sensitivity** (see methodology).

---

## Data sources & priority

| Asset class            | Priority                                                             |
| ---------------------- | -------------------------------------------------------------------- |
| Crypto                 | `Binance` → `Twelve Data` → `Yahoo` → `Simulated`                    |
| Forex / Metals / Indices / Stocks | `Twelve Data` → `Yahoo` → `Stooq` → `Binance` (gold proxy) → `Simulated` |

- **Binance** — public spot REST API, no key, real intraday + daily OHLC.
- **Twelve Data** — free tier (800 requests/day, 8/min). Covers everything.
  Order size is capped at 480 candles so a 200-period MA can be computed.
- **Yahoo Finance** — no key; broad coverage. Can rate-limit datacenter IPs.
- **Stooq** — no key; daily OHLC CSV; some networks receive a JS challenge.
- **Simulated** — deterministic pseudo-random walk seeded by symbol, used only
  as a last resort and always badged **Simulated data**.

The source used for each card appears in the card footer.

---

## Indicator methodology

For every market Gauge computes **24 indicators** and turns each into
`Buy` / `Sell` / `Neutral`, then aggregates them the way investing.com does.

### Oscillators (12)

| Indicator            | Buy            | Sell            | Notes                                  |
| -------------------- | -------------- | --------------- | -------------------------------------- |
| RSI(14)              | `< 30`         | `> 70`          | Wilder smoothing                       |
| STOCH(9,6) `%K`      | `< 20`         | `> 80`          | slow stochastic (%K smoothed by 3)     |
| STOCHRSI(14)         | `< 20`         | `> 80`          |                                        |
| MACD(12,26)          | line > signal  | line < signal   | EMA9 signal                            |
| ADX(14)              | `+DI > -DI`    | `-DI > +DI`     | Neutral when `ADX < 20`                |
| Williams %R          | `< -80`        | `> -20`         |                                        |
| CCI(20)              | `< -100`       | `> 100`         |                                        |
| ATR(14)              | —              | —               | always Neutral (volatility, not trend) |
| Highs/Lows(14)       | `> 0`          | `< 0`           | close − range midpoint                 |
| Ultimate Oscillator  | `< 30`         | `> 70`          | 7,14,28                                |
| ROC(14)              | `> 0`          | `< 0`           |                                        |
| Bull/Bear Power(13)  | `> 0`          | `< 0`           | (high−EMA13)+(low−EMA13)               |

### Moving averages (12)

SMA **and** EMA over 5, 10, 20, 50, 100, 200. **Buy** if price is above the
average, **Sell** if below.

### Overall rating

Votes across all 24 indicators produce `buy`, `sell`, `neutral` counts.

```
ratio = |buy - sell| / (buy + sell + neutral)

buy  > sell : ratio >= STRONG_RATIO ? Strong Buy  : Buy
sell > buy  : ratio >= STRONG_RATIO ? Strong Sell : Sell
otherwise   : Neutral
```

`STRONG_RATIO` defaults to **0.25** and is adjustable in Settings (or the
`STRONG_RATIO` env var). The needle position on the gauge is derived from
`scores = (buy - sell) / total` and aligned to the five coloured zones.

The indicator formulas follow the standard Wilder / MetaTrader definitions used
by investing.com and TradingView. Exact values can differ by a tick or two from
any other site because it depends on the precise candles and market hours.

---

## Configuration

| Variable             | Default | Purpose                                             |
| -------------------- | ------- | --------------------------------------------------- |
| `PORT`               | `4317`  | HTTP port                                           |
| `TWELVEDATA_API_KEY` | —       | Enables all asset classes via Twelve Data           |
| `REFRESH_SECONDS`    | `60`    | UI auto-refresh interval                            |
| `STRONG_RATIO`       | `0.25`  | Strong Buy/Sell sensitivity                         |

Everything except the port and API key is also editable from the **Settings**
panel, stored in `data/settings.json`.

---

## HTTP API

| Method   | Path                                  | Description                          |
| -------- | ------------------------------------- | ------------------------------------ |
| `GET`    | `/api/config`                         | Timeframes, settings, full catalog   |
| `GET`    | `/api/search?q=`                      | Catalog search                       |
| `GET`    | `/api/watchlist`                      | Saved symbols                        |
| `POST`   | `/api/watchlist`                      | `{ "symbol": "xauusd" }` add         |
| `DELETE` | `/api/watchlist?symbol=XAUUSD`        | Remove                               |
| `GET`    | `/api/analysis?timeframe=1d`          | Analysis for all watchlist symbols   |
| `GET`    | `/api/analysis/BTCUSD?timeframe=4h`   | Analysis for one symbol              |
| `GET`    | `/api/settings` · `POST /api/settings`| Read / update settings               |

---

## Project layout

```
server.js                 HTTP server + JSON API (no dependencies)
src/
  indicators.js           indicator math (SMA, EMA, RSI, MACD, ADX, …)
  analysis.js             rating rules + 24-indicator assembly
  symbols.js              instrument catalog + symbol resolution
  timeframes.js           timeframe definitions per provider
  store.js                watchlist/settings persistence (data/*.json)
  providers/
    index.js              orchestration, fallback, caching
    binance.js twelvedata.js yahoo.js stooq.js simulated.js
public/
  index.html styles.css app.js   dashboard UI
test/indicators.test.js   indicator + analysis assertions (npm test)
data/                     created at runtime
```

## Tests

```bash
npm test
```

Runs 13 assertions over the indicator math, the rating engine, symbol
resolution and the simulator.

## Adding a market

Type it in the search box. Recognised automatically:

- **Forex**: `EURUSD`, `GBP/JPY`, `usdcad`
- **Metals**: `XAUUSD`, `XAGUSD`, `XPTUSD`, `XPDUSD`
- **Crypto**: `BTCUSD`, `BTC/USDT`, `ethusdt`, or any Binance base (`SUI`, `INJ`)
- **Indices**: `US500`, `NAS100`, `GER40`, `JP225`, `DXY`, `VIX`, …
- **Stocks**: `AAPL`, `TSLA`, `NVDA`, … (needs a key/Yahoo)

Anything else is treated as a ticker and passed to the providers.

---

_Not financial advice. For personal research and education._
