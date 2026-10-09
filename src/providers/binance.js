// Binance public spot API. No API key required, real intraday + daily OHLC.
// Best source for crypto; also serves a gold proxy (PAXGUSDT) for XAUUSD.

import { fetchJson } from './fetchjson.js';

const BASE = 'https://api.binance.com/api/v3';

export const id = 'binance';

export function supports(meta) {
  return Boolean(meta.providers?.binance);
}

export async function fetchCandles(meta, tf) {
  const symbol = meta.providers.binance;
  const interval = tf.binance;
  if (!interval) throw new Error(`Binance does not support ${tf.id}`);
  const limit = Math.min(tf.limit || 480, 1000);
  const url = `${BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const data = await fetchJson(url);
  if (!Array.isArray(data)) {
    throw new Error(data?.msg || 'Unexpected Binance response');
  }
  return data.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}
