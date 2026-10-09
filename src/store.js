// Persistence for the watchlist and settings. Everything lives in ./data as
// plain JSON so it is easy to inspect, back up or edit by hand.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');

const DEFAULT_WATCHLIST = [
  'XAUUSD',
  'XAGUSD',
  'BTCUSD',
  'ETHUSD',
  'EURUSD',
  'GBPUSD',
  'US500',
  'NAS100',
  'SOLUSD',
];

const DEFAULT_SETTINGS = {
  twelvedataKey: '',
  refreshSeconds: 60,
  defaultTimeframe: '1d',
  strongRatio: 0.25,
  providers: { yahoo: true, stooq: true },
};

function read(file, fallback) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value, null, 2));
}

export function getWatchlist() {
  const list = read('watchlist.json', DEFAULT_WATCHLIST);
  return Array.isArray(list) && list.length ? list : [...DEFAULT_WATCHLIST];
}

export function setWatchlist(list) {
  const clean = [...new Set(list.map((s) => String(s).toUpperCase()))].slice(0, 60);
  write('watchlist.json', clean);
  return clean;
}

export function addToWatchlist(symbol) {
  const list = getWatchlist();
  const upper = String(symbol).toUpperCase();
  if (!list.includes(upper)) list.push(upper);
  return setWatchlist(list);
}

export function removeFromWatchlist(symbol) {
  const upper = String(symbol).toUpperCase();
  return setWatchlist(getWatchlist().filter((s) => s !== upper));
}

export function getSettings() {
  const stored = read('settings.json', {});
  const merged = { ...DEFAULT_SETTINGS, ...stored, providers: { ...DEFAULT_SETTINGS.providers, ...(stored.providers || {}) } };
  // Environment variables win so the app can be configured without the UI.
  if (process.env.TWELVEDATA_API_KEY) merged.twelvedataKey = process.env.TWELVEDATA_API_KEY;
  if (process.env.REFRESH_SECONDS) merged.refreshSeconds = Number(process.env.REFRESH_SECONDS) || merged.refreshSeconds;
  if (process.env.STRONG_RATIO) merged.strongRatio = Number(process.env.STRONG_RATIO) || merged.strongRatio;
  return merged;
}

export function updateSettings(patch = {}) {
  const current = read('settings.json', {});
  const next = {
    ...DEFAULT_SETTINGS,
    ...current,
    ...patch,
    providers: { ...DEFAULT_SETTINGS.providers, ...(current.providers || {}), ...(patch.providers || {}) },
  };
  write('settings.json', next);
  return getSettings();
}

export function publicSettings() {
  const s = getSettings();
  return {
    refreshSeconds: s.refreshSeconds,
    defaultTimeframe: s.defaultTimeframe,
    strongRatio: s.strongRatio,
    providers: s.providers,
    twelvedataKeySet: Boolean(s.twelvedataKey),
    twelvedataKeySource: process.env.TWELVEDATA_API_KEY ? 'env' : s.twelvedataKey ? 'settings' : null,
  };
}

export { ROOT, DATA_DIR };
