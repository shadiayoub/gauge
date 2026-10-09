// Twelve Data (https://twelvedata.com). One free API key covers forex, metals,
// indices, stocks and crypto. Best single source for everything that is not a
// Binance-listed crypto pair.

import { fetchJson } from './fetchjson.js';

const BASE = 'https://api.twelvedata.com/time_series';

export const id = 'twelvedata';

export function supports(meta, settings = {}) {
  return Boolean(meta.providers?.twelvedata && getKey(settings));
}

function getKey(settings) {
  return settings.twelvedataKey || process.env.TWELVEDATA_API_KEY || '';
}

export async function fetchCandles(meta, tf, { settings = {} } = {}) {
  const symbol = meta.providers.twelvedata;
  const interval = tf.twelvedata;
  if (!interval) throw new Error(`Twelve Data does not support ${tf.id}`);
  const apikey = getKey(settings);
  if (!apikey) throw new Error('No Twelve Data API key configured');

  const limit = Math.min(tf.limit || 480, 5000);
  const url =
    `${BASE}?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${interval}&outputsize=${limit}` +
    `&apikey=${encodeURIComponent(apikey)}&order=ASC&timezone=UTC`;

  const data = await fetchJson(url, { timeout: 15000 });
  if (data.status === 'error' || !Array.isArray(data.values)) {
    throw new Error(data.message || 'Unexpected Twelve Data response');
  }

  return data.values
    .map((v) => ({
      time: parseTime(v.datetime),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: v.volume ? Number(v.volume) : 0,
    }))
    .filter((c) => Number.isFinite(c.close));
}

function parseTime(datetime) {
  if (!datetime) return Date.now();
  const iso = datetime.includes(' ') ? datetime.replace(' ', 'T') + 'Z' : datetime;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Date.parse(datetime);
}
