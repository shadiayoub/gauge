// Stooq (https://stooq.com) CSV download. No API key, daily OHLC for forex,
// indices and commodities. Some networks get a JS challenge, in which case the
// orchestrator simply moves on to the next provider.

import { fetchText } from './fetchjson.js';

export const id = 'stooq';

export function supports(meta, _settings, tf) {
  return Boolean(meta.providers?.stooq) && (!tf || tf.id === '1d');
}

export async function fetchCandles(meta, tf) {
  if (tf.id !== '1d') throw new Error(`Stooq only used for daily data`);
  const symbol = meta.providers.stooq;
  if (!symbol) throw new Error('No Stooq symbol');
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const csv = await fetchText(url);
  return parseCsv(csv);
}

function parseCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2 || !/date/i.test(lines[0])) {
    throw new Error('Stooq did not return CSV data');
  }
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, open, high, low, close, volume] = lines[i].split(',');
    const c = Number(close);
    if (!date || !Number.isFinite(c)) continue;
    candles.push({
      time: Date.parse(date),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: c,
      volume: Number(volume) || 0,
    });
  }
  if (candles.length < 30) throw new Error('Stooq returned too few candles');
  return candles;
}
