// Turns raw candles into an investing.com-style technical analysis block:
// oscillator rows, moving-average rows, per-section summaries and one overall
// rating / score used to drive the gauge.

import * as ti from './indicators.js';

const RATINGS = ['strong_sell', 'sell', 'neutral', 'buy', 'strong_buy'];

// Net-vote ratio (|buy-sell| / total) at or above this turns Buy/Sell into
// Strong Buy/Strong Sell. Configurable from settings.
let strongRatio = 0.25;
export function setStrongRatio(ratio) {
  const n = Number(ratio);
  if (Number.isFinite(n) && n > 0 && n <= 1) strongRatio = n;
}
export function getStrongRatio() {
  return strongRatio;
}

const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Number(v));

function row(name, rawValue, signal) {
  return {
    name,
    value: num(rawValue),
    signal: signal || 'neutral',
  };
}

function rateByLevels(value, buyBelow, sellAbove) {
  if (value === null) return 'neutral';
  if (value < buyBelow) return 'buy';
  if (value > sellAbove) return 'sell';
  return 'neutral';
}

function signSignal(value) {
  if (value === null) return 'neutral';
  if (value > 0) return 'buy';
  if (value < 0) return 'sell';
  return 'neutral';
}

function rateSummary(buy, sell, neutral) {
  const total = buy + sell + neutral;
  if (!total || buy === sell) return 'neutral';
  const ratio = Math.abs(buy - sell) / total;
  if (buy > sell) return ratio >= strongRatio ? 'strong_buy' : 'buy';
  return ratio >= strongRatio ? 'strong_sell' : 'sell';
}

function summarize(rows) {
  let buy = 0;
  let sell = 0;
  let neutral = 0;
  for (const r of rows) {
    if (r.signal === 'buy') buy++;
    else if (r.signal === 'sell') sell++;
    else neutral++;
  }
  return { buy, sell, neutral, rating: rateSummary(buy, sell, neutral) };
}

export function analyze(candles, meta = {}, timeframe = '1d') {
  if (!Array.isArray(candles) || candles.length < 30) {
    throw new Error(`Not enough candles to analyze (${candles ? candles.length : 0})`);
  }

  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const prevClose = closes.length > 1 ? closes[closes.length - 2] : price;
  const change = price - prevClose;
  const changePct = prevClose === 0 ? 0 : (change / prevClose) * 100;

  const rsi14 = ti.rsi(closes, 14);
  const stoch = ti.stochastic(candles, 9, 6, 3);
  const stochRsi = ti.stochRsi(closes, 14, 14, 3, 3);
  const macd = ti.macd(closes, 12, 26, 9);
  const adx = ti.adx(candles, 14);
  const wr = ti.williamsR(candles, 14);
  const cci = ti.cci(candles, 20);
  const atr14 = ti.atr(candles, 14);
  const hl = ti.highsLows(candles, 14);
  const uo = ti.ultimateOscillator(candles, 7, 14, 28);
  const roc14 = ti.roc(closes, 14);
  const bbp = ti.bullBearPower(candles, 13);

  const lastRsi = ti.last(rsi14);
  const lastK = ti.last(stoch.k);
  const lastStochRsi = ti.last(stochRsi.k);
  const lastMacd = ti.last(macd.macd);
  const lastSignal = ti.last(macd.signal);
  const lastAdx = ti.last(adx.adx);
  const lastPlus = ti.last(adx.plusDI);
  const lastMinus = ti.last(adx.minusDI);
  const lastWr = ti.last(wr);
  const lastCci = ti.last(cci);
  const lastAtr = ti.last(atr14);
  const lastHl = ti.last(hl);
  const lastUo = ti.last(uo);
  const lastRoc = ti.last(roc14);
  const lastBbp = ti.last(bbp);

  const macdSignal =
    lastMacd === null || lastSignal === null
      ? 'neutral'
      : lastMacd > lastSignal
        ? 'buy'
        : 'sell';

  // ADX is a trend-strength filter: only acts when the trend is meaningful.
  const adxSignal =
    lastAdx === null || lastPlus === null || lastMinus === null
      ? 'neutral'
      : lastAdx < 20
        ? 'neutral'
        : lastPlus > lastMinus
          ? 'buy'
          : 'sell';

  const oscillators = [
    row('RSI(14)', lastRsi, rateByLevels(lastRsi, 30, 70)),
    row('STOCH(9,6)', lastK, rateByLevels(lastK, 20, 80)),
    row('STOCHRSI(14)', lastStochRsi, rateByLevels(lastStochRsi, 20, 80)),
    row('MACD(12,26)', lastMacd, macdSignal),
    row('ADX(14)', lastAdx, adxSignal),
    row('Williams %R', lastWr, rateByLevels(lastWr, -80, -20)),
    row('CCI(20)', lastCci, rateByLevels(lastCci, -100, 100)),
    row('ATR(14)', lastAtr, 'neutral'),
    row('Highs/Lows(14)', lastHl, signSignal(lastHl)),
    row('Ultimate Oscillator', lastUo, rateByLevels(lastUo, 30, 70)),
    row('ROC', lastRoc, signSignal(lastRoc)),
    row('Bull/Bear Power(13)', lastBbp, signSignal(lastBbp)),
  ];

  const periods = [5, 10, 20, 50, 100, 200];
  const movingAverages = [];
  for (const p of periods) {
    const v = ti.last(ti.sma(closes, p));
    movingAverages.push(row(`MA${p}`, v, v === null ? 'neutral' : price > v ? 'buy' : 'sell'));
  }
  for (const p of periods) {
    const v = ti.last(ti.ema(closes, p));
    movingAverages.push(row(`EMA${p}`, v, v === null ? 'neutral' : price > v ? 'buy' : 'sell'));
  }

  const oscillatorSummary = summarize(oscillators);
  const maSummary = summarize(movingAverages);
  const overall = summarize([...oscillators, ...movingAverages]);

  const score = overall.buy + overall.sell + overall.neutral
    ? (overall.buy - overall.sell) / (overall.buy + overall.sell + overall.neutral)
    : 0;

  return {
    symbol: meta.symbol,
    name: meta.name || meta.symbol,
    type: meta.type || 'unknown',
    timeframe,
    price,
    change,
    changePct,
    high: candles[candles.length - 1].high,
    low: candles[candles.length - 1].low,
    open: candles[candles.length - 1].open,
    previousClose: prevClose,
    atr: lastAtr,
    candles: candles.length,
    summary: { ...overall, score, rating: overall.rating },
    oscillators: { ...oscillatorSummary, rows: oscillators },
    movingAverages: { ...maSummary, rows: movingAverages },
    sparkline: closes.slice(-120),
    series: candles.slice(-180).map((c) => ({ t: c.time, c: c.close })),
    updatedAt: Date.now(),
  };
}

export { RATINGS };
