// Lightweight assertions for the indicator + analysis engine.
// Run with: npm test
import assert from 'node:assert/strict';
import * as ti from '../src/indicators.js';
import { analyze, RATINGS } from '../src/analysis.js';
import { resolveSymbol } from '../src/symbols.js';
import * as simulated from '../src/providers/simulated.js';

const tests = [];
const section = (name) => console.log(`\n${name}`);
const check = (name, fn) => tests.push([name, fn]);

check('sma computes trailing average', () => {
  const out = ti.sma([1, 2, 3, 4, 5], 3);
  assert.equal(out[4], 4);
  assert.equal(out[3], 3);
  assert.equal(out[0], null);
});

check('ema seeds with sma then smooths', () => {
  const out = ti.ema([1, 2, 3, 4, 5], 3);
  assert.equal(out[2], 2);
  assert.equal(Math.round(out[4] * 1000) / 1000, 4);
});

check('rsi stays within 0..100', () => {
  const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
  for (const v of ti.rsi(values, 14).filter((x) => x !== null)) {
    assert.ok(v >= 0 && v <= 100, `rsi out of range: ${v}`);
  }
});

check('rsi is 100 for a strictly rising series', () => {
  const values = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.equal(ti.last(ti.rsi(values, 14)), 100);
});

check('macd/atr/adx produce finite latest values', () => {
  const candles = makeCandles(300);
  assert.ok(Number.isFinite(ti.last(ti.macd(candles.map((c) => c.close)).macd)));
  assert.ok(Number.isFinite(ti.last(ti.atr(candles, 14))));
  assert.ok(Number.isFinite(ti.last(ti.adx(candles, 14).adx)));
});

check('remaining oscillators are defined', () => {
  const candles = makeCandles(300);
  const closes = candles.map((c) => c.close);
  assert.ok(Number.isFinite(ti.last(ti.stochastic(candles).k)));
  assert.ok(Number.isFinite(ti.last(ti.stochRsi(closes).k)));
  assert.ok(Number.isFinite(ti.last(ti.cci(candles, 20))));
  assert.ok(Number.isFinite(ti.last(ti.ultimateOscillator(candles))));
  assert.ok(Number.isFinite(ti.last(ti.roc(closes, 14))));
  assert.ok(Number.isFinite(ti.last(ti.highsLows(candles, 14))));
  assert.ok(Number.isFinite(ti.last(ti.bullBearPower(candles, 13))));
});

check('roc math is correct', () => {
  assert.equal(ti.last(ti.roc([1, 2, 4], 2)), 300);
});

check('williams %R within -100..0', () => {
  for (const v of ti.williamsR(makeCandles(120), 14)) {
    if (v !== null) assert.ok(v >= -100 && v <= 0, `wr out of range: ${v}`);
  }
});

check('aggregate resamples candles', () => {
  const candles = makeCandles(8);
  const agg = ti.aggregate(candles, 4);
  assert.equal(agg.length, 2);
  assert.equal(agg[0].open, candles[0].open);
  assert.equal(agg[0].close, candles[3].close);
});

check('analysis returns 12 oscillators + 12 MAs and a valid rating', () => {
  const result = analyze(makeCandles(320), { symbol: 'TEST', name: 'Test', type: 'crypto' }, '1d');
  assert.equal(result.oscillators.rows.length, 12);
  assert.equal(result.movingAverages.rows.length, 12);
  assert.ok(RATINGS.includes(result.summary.rating), `bad rating ${result.summary.rating}`);
  assert.ok(result.summary.score >= -1 && result.summary.score <= 1);
  assert.equal(result.summary.buy + result.summary.sell + result.summary.neutral, 24);
});

check('analysis rejects too little data', () => {
  assert.throws(() => analyze(makeCandles(10), { symbol: 'X' }, '1d'));
});

check('resolves forex, metals, crypto, index and stock', () => {
  assert.equal(resolveSymbol('EUR/USD').type, 'forex');
  assert.equal(resolveSymbol('eurusd').providers.twelvedata, 'EUR/USD');
  assert.equal(resolveSymbol('XAUUSD').type, 'commodity');
  assert.equal(resolveSymbol('XAUUSD').providers.binance, 'PAXGUSDT');
  assert.equal(resolveSymbol('BTC/USDT').symbol, 'BTCUSD');
  assert.equal(resolveSymbol('btcusdt').providers.binance, 'BTCUSDT');
  assert.equal(resolveSymbol('US500').type, 'index');
  assert.equal(resolveSymbol('AAPL').type, 'stock');
});

check('simulated provider produces a valid, analysable series', async () => {
  const tf = { id: '1d', ms: 86400000, limit: 320 };
  const candles = await simulated.fetchCandles({ symbol: 'XAUUSD', type: 'commodity' }, tf);
  assert.equal(candles.length, 320);
  const result = analyze(candles, { symbol: 'XAUUSD', type: 'commodity' }, '1d');
  assert.ok(result.price > 0);
  assert.ok(RATINGS.includes(result.summary.rating));
});

let passed = 0;
section('indicators + analysis + symbols + providers');
for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} checks passed\n`);

function makeCandles(n) {
  const out = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    price += Math.sin(i / 5) * 1.5 + Math.cos(i / 11) * 0.8 + 0.1;
    const high = Math.max(open, price) + Math.abs(Math.sin(i)) * 0.6;
    const low = Math.min(open, price) - Math.abs(Math.cos(i)) * 0.6;
    out.push({ time: i * 86400000, open, high, low, close: price, volume: 1000 });
  }
  return out;
}
