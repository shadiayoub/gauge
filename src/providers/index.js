// Provider orchestrator: walks providers in priority order until one returns
// usable candles, caches the result, and reports which provider was used.

import * as binance from './binance.js';
import * as twelvedata from './twelvedata.js';
import * as yahoo from './yahoo.js';
import * as stooq from './stooq.js';
import * as simulated from './simulated.js';
import { getTimeframe } from '../timeframes.js';

const REGISTRY = { binance, twelvedata, yahoo, stooq, simulated };

const CRYPTO_ORDER = ['binance', 'twelvedata', 'yahoo', 'simulated'];
const GENERAL_ORDER = ['twelvedata', 'yahoo', 'stooq', 'binance', 'simulated'];

const DEFAULT_LIMIT = 480;
const cache = new Map();

function providerOrder(meta) {
  return meta.type === 'crypto' ? CRYPTO_ORDER : GENERAL_ORDER;
}

/**
 * Fetch candles for a market/timeframe, trying each provider in turn.
 * @returns {Promise<{candles:Array, provider:string, simulated:boolean, proxy?:string, warnings:Array, cached:boolean}>}
 */
export async function getCandles(meta, timeframeId, settings = {}, { force = false } = {}) {
  const tf = { ...getTimeframe(timeframeId), limit: DEFAULT_LIMIT };
  const order = providerOrder(meta).filter((pid) => {
    const p = REGISTRY[pid];
    return p && p.supports(meta, settings, tf);
  });

  const warnings = [];
  for (const pid of order) {
    const p = REGISTRY[pid];
    const key = `${pid}:${meta.symbol}:${tf.id}`;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < tf.ttl * 1000) {
      return { ...hit.value, warnings, cached: true };
    }
    try {
      const candles = await p.fetchCandles(meta, tf, { settings });
      if (!Array.isArray(candles) || candles.length < 30) {
        throw new Error(`only ${candles ? candles.length : 0} candles`);
      }
      const value = {
        candles,
        provider: pid,
        simulated: pid === 'simulated',
        proxy: pid === 'binance' && meta.proxy ? meta.proxy : undefined,
      };
      cache.set(key, { at: Date.now(), value });
      return { ...value, warnings, cached: false };
    } catch (err) {
      warnings.push({ provider: pid, message: String(err.message || err) });
    }
  }

  throw new Error(
    `No data source available. ${warnings.map((w) => `${w.provider}: ${w.message}`).join('; ')}`,
  );
}

export function clearCache() {
  cache.clear();
}
