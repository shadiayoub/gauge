// Yahoo Finance chart endpoint. No API key. Great coverage for forex, metals
// (as futures), indices and stocks, but it rate-limits datacenter IPs, so it is
// used as a fallback behind Twelve Data.

import { fetchJson } from './fetchjson.js';
import { aggregate } from '../indicators.js';

export const id = 'yahoo';

export function supports(meta) {
  return Boolean(meta.providers?.yahoo);
}

export async function fetchCandles(meta, tf) {
  const symbol = meta.providers.yahoo;
  let interval = tf.yahoo;
  let range = tf.yahooRange;
  let factor = 1;

  // Yahoo has no native 4h interval: pull 1h and aggregate 4:1.
  if (!interval && tf.id === '4h') {
    interval = '60m';
    range = '1y';
    factor = 4;
  }
  if (!interval) throw new Error(`Yahoo does not support ${tf.id}`);

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=false`;

  const data = await fetchJson(url, { timeout: 15000 });
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || 'Empty Yahoo response');

  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close === null || close === undefined) continue;
    candles.push({
      time: ts[i] * 1000,
      open: q.open?.[i] ?? close,
      high: q.high?.[i] ?? close,
      low: q.low?.[i] ?? close,
      close,
      volume: q.volume?.[i] || 0,
    });
  }
  if (candles.length < 30) throw new Error('Yahoo returned too few candles');
  return factor > 1 ? aggregate(candles, factor) : candles;
}
