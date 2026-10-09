// Gauge server: static frontend + JSON API for watchlist, catalog and
// technical-analysis results. Zero external dependencies.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze, setStrongRatio } from './src/analysis.js';
import { getCandles, clearCache } from './src/providers/index.js';
import { resolveSymbol, catalogList, searchCatalog } from './src/symbols.js';
import { timeframeLabels, DEFAULT_TIMEFRAME, TIMEFRAMES } from './src/timeframes.js';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  publicSettings,
  updateSettings,
} from './src/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

// Minimal .env loader (no dependency). Existing environment variables win.
// Env values are only read lazily by the modules below, so loading here is safe.
(function loadDotEnv() {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!match) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(match[1] in process.env)) process.env[match[1]] = value;
    }
  } catch {
    /* no .env file */
  }
})();

const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4317;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const ANALYSIS_LIMIT = 480;

async function analyzeSymbol(symbol, timeframe) {
  const settings = publicSettings();
  setStrongRatio(settings.strongRatio);
  let meta;
  try {
    meta = resolveSymbol(symbol);
  } catch (err) {
    return { ok: false, symbol, error: String(err.message || err) };
  }
  try {
    const { candles, provider, simulated, proxy, warnings, cached } = await getCandles(
      meta,
      timeframe,
      settings,
    );
    const result = analyze(candles, meta, timeframe);
    return {
      ok: true,
      ...result,
      provider,
      simulated,
      proxy,
      cached,
      warnings,
      meta: { note: meta.note },
    };
  } catch (err) {
    return {
      ok: false,
      symbol: meta.symbol,
      name: meta.name,
      type: meta.type,
      timeframe,
      error: String(err.message || err),
    };
  }
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Compact rating (rating + vote counts) for every timeframe, so the detail
// view can show a "Strong Buy / Buy / Sell …" label under each timeframe tab.
async function ratingsForAllTimeframes(symbol) {
  const settings = publicSettings();
  setStrongRatio(settings.strongRatio);
  let meta;
  try {
    meta = resolveSymbol(symbol);
  } catch {
    return {};
  }
  const entries = await mapPool(TIMEFRAMES, 4, async (tf) => {
    try {
      const { candles, provider, simulated } = await getCandles(meta, tf.id, settings);
      const a = analyze(candles, meta, tf.id);
      return [
        tf.id,
        {
          rating: a.summary.rating,
          score: a.summary.score,
          buy: a.summary.buy,
          sell: a.summary.sell,
          neutral: a.summary.neutral,
          price: a.price,
          provider,
          simulated,
        },
      ];
    } catch (err) {
      return [tf.id, { error: String(err.message || err) }];
    }
  });
  return Object.fromEntries(entries);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (pathname === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      timeframes: timeframeLabels(),
      defaultTimeframe: DEFAULT_TIMEFRAME,
      settings: publicSettings(),
      catalog: catalogList(),
    });
  }

  if (pathname === '/api/catalog' && req.method === 'GET') {
    return sendJson(res, 200, { items: catalogList() });
  }

  if (pathname === '/api/search' && req.method === 'GET') {
    return sendJson(res, 200, { items: searchCatalog(searchParams.get('q') || '') });
  }

  if (pathname === '/api/watchlist' && req.method === 'GET') {
    return sendJson(res, 200, { symbols: getWatchlist() });
  }

  if (pathname === '/api/watchlist' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.symbol) return sendJson(res, 400, { error: 'symbol is required' });
    let meta;
    try {
      meta = resolveSymbol(body.symbol);
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err) });
    }
    const symbols = addToWatchlist(meta.symbol);
    return sendJson(res, 200, { symbols });
  }

  if (pathname === '/api/watchlist' && req.method === 'DELETE') {
    const symbol = searchParams.get('symbol');
    if (!symbol) return sendJson(res, 400, { error: 'symbol is required' });
    return sendJson(res, 200, { symbols: removeFromWatchlist(symbol) });
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, publicSettings());
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    const body = await readBody(req);
    const patch = {};
    if (body.twelvedataKey !== undefined) patch.twelvedataKey = String(body.twelvedataKey).trim();
    if (body.refreshSeconds !== undefined) patch.refreshSeconds = Math.max(10, Number(body.refreshSeconds) || 60);
    if (body.defaultTimeframe !== undefined) patch.defaultTimeframe = String(body.defaultTimeframe);
    if (body.strongRatio !== undefined) patch.strongRatio = Number(body.strongRatio);
    if (body.providers !== undefined) patch.providers = body.providers;
    updateSettings(patch);
    clearCache();
    return sendJson(res, 200, publicSettings());
  }

  if (pathname === '/api/analysis' && req.method === 'GET') {
    const timeframe = searchParams.get('timeframe') || DEFAULT_TIMEFRAME;
    const symbols = searchParams.get('symbols')
      ? searchParams.get('symbols').split(',').map((s) => s.trim()).filter(Boolean)
      : getWatchlist();
    const results = await mapPool(symbols, 4, (symbol) => analyzeSymbol(symbol, timeframe));
    return sendJson(res, 200, { timeframe, results, updatedAt: Date.now() });
  }

  if (pathname.startsWith('/api/analysis/') && req.method === 'GET') {
    const symbol = decodeURIComponent(pathname.slice('/api/analysis/'.length));
    const timeframe = searchParams.get('timeframe') || DEFAULT_TIMEFRAME;
    const result = await analyzeSymbol(symbol, timeframe);
    if (searchParams.get('all') === '1' || searchParams.get('all') === 'true') {
      result.timeframeRatings = await ratingsForAllTimeframes(symbol);
    }
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: 'Unknown API endpoint' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  const settings = publicSettings();
  console.log('');
  console.log('  Gauge — technical analysis dashboard');
  console.log(`  → http://localhost:${PORT}`);
  console.log(
    settings.twelvedataKeySet
      ? '  ✓ Twelve Data key detected (forex, metals, indices, stocks, crypto)'
      : '  ! No Twelve Data key. Crypto uses Binance; add a free key in Settings to enable XAUUSD/XAGUSD/indices.',
  );
  console.log('');
});
