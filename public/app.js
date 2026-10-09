'use strict';

// ── rating metadata ─────────────────────────────────────────────────────────
const RATINGS = {
  strong_sell: { label: 'Strong Sell', color: '#dc2626' },
  sell: { label: 'Sell', color: '#f87171' },
  neutral: { label: 'Neutral', color: '#94a3b8' },
  buy: { label: 'Buy', color: '#34d399' },
  strong_buy: { label: 'Strong Buy', color: '#16a34a' },
};
const SIGNALS = { buy: 'Buy', sell: 'Sell', neutral: 'Neutral' };
const SEG_COLORS = ['#dc2626', '#f87171', '#94a3b8', '#34d399', '#16a34a'];
const SEG_LABELS = ['strong_sell', 'sell', 'neutral', 'buy', 'strong_buy'];
const PROVIDERS = {
  binance: 'Binance',
  twelvedata: 'Twelve Data',
  yahoo: 'Yahoo Finance',
  stooq: 'Stooq',
  simulated: 'Simulated',
};

// ── state ───────────────────────────────────────────────────────────────────
const state = {
  config: null,
  settings: null,
  timeframe: '1d',
  watchlist: [],
  analyses: [],
  updatedAt: 0,
  loading: false,
  modal: null,
  requestId: 0,
  modalRequestId: 0,
};

let refreshTimer = null;
let countdownTimer = null;
let secondsLeft = 0;

// ── dom ─────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  timeframes: $('timeframes'),
  grid: $('grid'),
  empty: $('empty'),
  status: $('status-text'),
  refreshInfo: $('refresh-info'),
  addForm: $('add-form'),
  symbolInput: $('symbol-input'),
  suggestions: $('symbol-suggestions'),
  refreshBtn: $('refresh-btn'),
  settingsBtn: $('settings-btn'),
  banner: $('setup-banner'),
  bannerAction: $('banner-action'),
  modal: $('modal'),
  toast: $('toast'),
};

// ── utilities ───────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtFixed(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(d);
}

function fmtChange(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function changeClass(v) {
  if (v == null || Math.abs(v) < 1e-9) return 'flat';
  return v > 0 ? 'up' : 'down';
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3200);
}

// ── gauge + sparkline svg ───────────────────────────────────────────────────
function gaugeSvg(score, rating, strongRatio) {
  const cx = 100, cy = 100, r = 78;
  const ratio = strongRatio || 0.25;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const pos = (angle) => {
    const rad = (angle * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };

  // position on the -1..1 scale, aligned with the 5 coloured zones
  const centers = { strong_sell: -0.8, sell: -0.4, neutral: 0, buy: 0.4, strong_buy: 0.8 };
  let d = centers[rating] ?? 0;
  if (rating === 'neutral') {
    d += clamp(score || 0, -0.18, 0.18) * 0.9;
  } else {
    const mag = Math.abs(score || 0);
    const extra = Math.max(0, mag - ratio);
    const span = Math.max(0.0001, 1 - ratio);
    d += Math.sign(score || 1) * (extra / span) * 0.18;
  }
  d = clamp(d, -1, 1);
  const angle = 90 - d * 90;

  let segs = '';
  for (let i = 0; i < 5; i++) {
    const a0 = 180 - 36 * i;
    const a1 = 180 - 36 * (i + 1);
    const [x0, y0] = pos(a0);
    const [x1, y1] = pos(a1);
    const active = SEG_LABELS[i] === rating;
    segs += `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${SEG_COLORS[i]}" stroke-width="${active ? 17 : 12}" fill="none" stroke-linecap="round" opacity="${active ? 1 : 0.3}" />`;
  }
  const rad = (angle * Math.PI) / 180;
  const nx = cx + (r - 14) * Math.cos(rad);
  const ny = cy - (r - 14) * Math.sin(rad);
  const color = RATINGS[rating]?.color || '#94a3b8';
  const needle = `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" /><circle cx="${cx}" cy="${cy}" r="5.5" fill="#ffffff" /><circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="${color}" stroke-width="2" opacity="0.5" />`;
  const ticks = `<text x="12" y="117" fill="#dc2626" font-size="10" font-weight="700">SS</text><text x="180" y="117" fill="#16a34a" font-size="10" font-weight="700">SB</text>`;
  return `<svg viewBox="0 0 200 124" role="img" aria-label="${RATINGS[rating]?.label || rating}">${segs}${needle}${ticks}</svg>`;
}

function sparkline(values, color) {
  if (!values || values.length < 2) return '';
  const w = 250, h = 40, pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const id = `sg-${Math.random().toString(36).slice(2, 8)}`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark" width="100%" height="34">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${pad},${h - pad} ${pts.join(' ')} ${w - pad},${h - pad}" fill="url(#${id})"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// ── rendering: watchlist cards ──────────────────────────────────────────────
function providerChip(a) {
  if (a.simulated) {
    return `<span class="provider-chip"><span class="dot sim"></span>Simulated data</span>`;
  }
  const name = PROVIDERS[a.provider] || a.provider;
  const label = a.proxy ? `${name} · ${a.proxy}` : name;
  return `<span class="provider-chip"><span class="dot${a.cached ? '' : ' warn'}"></span>${escapeHtml(label)}</span>`;
}

function subSummary(title, section) {
  const color = RATINGS[section.rating]?.color || '#94a3b8';
  return `<div class="sub">
    <span class="sub-label">${title}</span>
    <span class="sub-rating" style="color:${color}">${RATINGS[section.rating]?.label || section.rating}</span>
    <span class="sub-counts">${section.buy} buy · ${section.sell} sell · ${section.neutral} neut</span>
  </div>`;
}

function renderCard(a) {
  if (!a.ok) {
    return `<article class="card error" data-symbol="${escapeHtml(a.symbol)}">
      <h3>${escapeHtml(a.symbol)}</h3>
      <p class="muted" style="font-size:12px;margin-top:6px">${escapeHtml(a.error || 'No data')}</p>
      <button class="btn ghost" data-remove="${escapeHtml(a.symbol)}" style="margin-top:12px">Remove</button>
    </article>`;
  }
  const color = RATINGS[a.summary.rating]?.color || '#94a3b8';
  const wr = a.warnings && a.warnings.length ? ` title="${escapeHtml(a.warnings.map((w) => `${w.provider}: ${w.message}`).join(' | '))}"` : '';
  return `<article class="card" data-symbol="${escapeHtml(a.symbol)}"${wr}>
    <div class="card-head">
      <div class="ident">
        <h3>${escapeHtml(a.symbol)}<span class="type-badge">${escapeHtml(a.type)}</span></h3>
        <p class="name">${escapeHtml(a.name)}</p>
      </div>
      <button class="remove" data-remove="${escapeHtml(a.symbol)}" title="Remove from watchlist" aria-label="Remove">×</button>
    </div>
    <div class="price-row">
      <span class="last">${fmtPrice(a.price)}</span>
      <span class="change ${changeClass(a.changePct)}">${fmtChange(a.changePct)}</span>
    </div>
    ${sparkline(a.sparkline, color)}
    <div class="gauge">${gaugeSvg(a.summary.score, a.summary.rating, state.settings?.strongRatio)}</div>
    <div class="rating-label" style="color:${color}">${RATINGS[a.summary.rating]?.label}</div>
    <div class="subsummaries">
      ${subSummary('Oscillators', a.oscillators)}
      ${subSummary('Moving averages', a.movingAverages)}
    </div>
    <div class="card-foot">
      ${providerChip(a)}
      <span>${timeAgo(a.updatedAt)}</span>
    </div>
  </article>`;
}

function renderGrid() {
  if (state.loading && !state.analyses.length) {
    els.grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
    els.empty.classList.add('hidden');
    return;
  }
  if (!state.analyses.length) {
    els.grid.innerHTML = '';
    els.empty.classList.remove('hidden');
    return;
  }
  els.empty.classList.add('hidden');
  els.grid.innerHTML = state.analyses.map(renderCard).join('');
}

function renderStatus() {
  if (state.loading) {
    els.status.textContent = 'Updating…';
  } else {
    const ok = state.analyses.filter((a) => a.ok).length;
    const sim = state.analyses.filter((a) => a.ok && a.simulated).length;
    els.status.textContent = `${ok}/${state.analyses.length} markets analysed${sim ? ` · ${sim} simulated` : ''}`;
  }
}

function updateRefreshInfo() {
  if (state.settings && state.settings.refreshSeconds && secondsLeft > 0) {
    els.refreshInfo.textContent = `Next refresh in ${secondsLeft}s · updated ${timeAgo(state.updatedAt)}`;
  } else {
    els.refreshInfo.textContent = state.updatedAt ? `Updated ${timeAgo(state.updatedAt)}` : '';
  }
}

function renderTimeframes() {
  els.timeframes.innerHTML = state.config.timeframes
    .map(
      (t) =>
        `<button data-tf="${t.id}" class="${t.id === state.timeframe ? 'active' : ''}">${t.label}</button>`,
    )
    .join('');
}

function renderSuggestions() {
  els.suggestions.innerHTML = state.config.catalog
    .map((c) => `<option value="${escapeHtml(c.symbol)}">${escapeHtml(c.name)} (${escapeHtml(c.type)})</option>`)
    .join('');
}

function renderBanner() {
  const show = !state.settings?.twelvedataKeySet;
  els.banner.classList.toggle('hidden', !show);
}

// ── rendering: detail modal ─────────────────────────────────────────────────
function signalCell(signal) {
  const color = RATINGS[signal === 'buy' ? 'buy' : signal === 'sell' ? 'sell' : 'neutral']?.color;
  return `<td class="sig" style="color:${color}">${SIGNALS[signal] || 'Neutral'}</td>`;
}

function indicatorValue(name, value) {
  if (value == null) return '—';
  if (['ATR(14)', 'Highs/Lows(14)', 'Bull/Bear Power(13)'].includes(name)) return fmtPrice(value);
  return fmtFixed(value, 2);
}

function renderTable(rows, heading, section) {
  const color = RATINGS[section.rating]?.color || '#94a3b8';
  return `<div>
    <h4>${heading} <span style="color:${color}">${RATINGS[section.rating]?.label}</span></h4>
    <table>
      <thead><tr><th>Indicator</th><th style="text-align:right">Value</th><th style="text-align:right">Action</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) =>
              `<tr><td>${escapeHtml(r.name)}</td><td class="num">${indicatorValue(r.name, r.value)}</td>${signalCell(r.signal)}</tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </div>`;
}

function bars(section) {
  const total = section.buy + section.sell + section.neutral || 1;
  const seg = (n, c) => `<div class="seg" style="background:${c};flex:${n / total}"></div>`;
  return `<div class="summary-bars">
    ${seg(section.buy, '#34d399')}${seg(section.sell, '#f87171')}${seg(section.neutral, '#475569')}
  </div>`;
}

function renderTfRatings(m) {
  const ratings = m.ratings;
  if (!ratings || !Object.keys(ratings).length) return '';
  const items = state.config.timeframes
    .map((t) => {
      const r = ratings[t.id];
      const active = t.id === m.timeframe ? ' active' : '';
      if (!r || r.error) {
        return `<button class="tf-rat${active}" data-mtf="${t.id}"><span class="tf-rat-tf">${t.label}</span><span class="tf-rat-label muted">—</span></button>`;
      }
      const color = RATINGS[r.rating]?.color || '#94a3b8';
      const title = `${r.buy} buy · ${r.sell} sell · ${r.neutral} neutral${r.simulated ? ' · simulated' : ''}`;
      return `<button class="tf-rat${active}" data-mtf="${t.id}" title="${title}"><span class="tf-rat-tf">${t.label}</span><span class="tf-rat-label" style="color:${color}">${RATINGS[r.rating]?.label || r.rating}</span></button>`;
    })
    .join('');
  return `<div class="tf-ratings" aria-label="Rating by timeframe">${items}</div>`;
}

function renderModal() {
  const m = state.modal;
  if (!m) {
    els.modal.classList.add('hidden');
    els.modal.innerHTML = '';
    return;
  }
  els.modal.classList.remove('hidden');

  const a = m.data;
  const tfStrip = state.config.timeframes
    .map((t) => `<button data-mtf="${t.id}" class="${t.id === m.timeframe ? 'active' : ''}">${t.label}</button>`)
    .join('');
  const tfBlock = `<div class="tf-strip">${tfStrip}</div>${renderTfRatings(m)}`;

  if (!a) {
    els.modal.innerHTML = `<div class="sheet"><div class="sheet-head"><h2>${escapeHtml(m.symbol)}</h2><button class="close-x" data-close>×</button></div>${tfBlock}<p class="muted">Loading analysis…</p></div>`;
    return;
  }
  if (!a.ok) {
    els.modal.innerHTML = `<div class="sheet"><div class="sheet-head"><h2>${escapeHtml(a.symbol || m.symbol)}</h2><button class="close-x" data-close>×</button></div>${tfBlock}<p class="muted">${escapeHtml(a.error || 'No data')}</p></div>`;
    return;
  }

  const color = RATINGS[a.summary.rating]?.color || '#94a3b8';
  const providerName = a.simulated ? 'Simulated data' : PROVIDERS[a.provider] || a.provider;
  const proxyNote = a.proxy ? ` · ${escapeHtml(a.proxy)}` : '';
  const warnNote =
    a.warnings && a.warnings.length
      ? `<div class="legend"><span title="${escapeHtml(a.warnings.map((w) => `${w.provider}: ${w.message}`).join(' | '))}">⚠ ${a.warnings.length} source(s) unavailable — using ${providerName}</span></div>`
      : '';

  els.modal.innerHTML = `<div class="sheet" data-sheet>
    <div class="sheet-head">
      <div>
        <h2>${escapeHtml(a.symbol)}<span class="type-badge">${escapeHtml(a.type)}</span></h2>
        <p class="name">${escapeHtml(a.name)}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn danger" data-remove="${escapeHtml(a.symbol)}">Remove</button>
        <button class="close-x" data-close>×</button>
      </div>
    </div>
    ${tfBlock}

    <div class="detail-top">
      <div class="gauge">${gaugeSvg(a.summary.score, a.summary.rating, state.settings?.strongRatio)}</div>
      <div>
        <div class="detail-price">
          <span class="last">${fmtPrice(a.price)}</span>
          <span class="change ${changeClass(a.changePct)}" style="margin-left:10px">${fmtChange(a.changePct)}</span>
        </div>
        <div style="margin-top:6px;font-size:15px;font-weight:700;color:${color}">${RATINGS[a.summary.rating]?.label}</div>
        <div class="detail-meta">
          <div>Oscillators<strong style="color:${RATINGS[a.oscillators.rating]?.color}">${RATINGS[a.oscillators.rating]?.label}</strong></div>
          <div>Moving averages<strong style="color:${RATINGS[a.movingAverages.rating]?.color}">${RATINGS[a.movingAverages.rating]?.label}</strong></div>
          <div>Buy / Sell / Neutral<strong>${a.summary.buy} / ${a.summary.sell} / ${a.summary.neutral}</strong></div>
          ${a.atr != null ? `<div>ATR(14)<strong>${fmtPrice(a.atr)}</strong></div>` : ''}
        </div>
        ${bars(a.summary)}
      </div>
    </div>

    <div class="tables">
      ${renderTable(a.oscillators.rows, 'Oscillators', a.oscillators)}
      ${renderTable(a.movingAverages.rows, 'Moving averages', a.movingAverages)}
    </div>

    <div class="provider-note">
      <span class="provider-chip"><span class="dot${a.simulated ? ' sim' : ''}"></span>${escapeHtml(providerName)}${proxyNote}</span>
      <span>· ${a.candles} candles · timeframe ${a.timeframe} · updated ${timeAgo(a.updatedAt)}</span>
    </div>
    ${warnNote}
  </div>`;
}

function renderSettings() {
  const s = state.settings;
  els.modal.classList.remove('hidden');
  els.modal.innerHTML = `<div class="sheet narrow" data-sheet>
    <div class="sheet-head">
      <h2>Settings</h2>
      <button class="close-x" data-close>×</button>
    </div>

    <div class="field">
      <label for="set-key">Twelve Data API key</label>
      <input id="set-key" type="password" placeholder="${s.twelvedataKeySet ? '•••••••• (saved)' : 'paste your free key'}" autocomplete="off" />
      <span class="hint">
        Free key unlocks forex, metals, indices &amp; stocks.
        <a href="https://twelvedata.com/pricing" target="_blank" rel="noopener">Get one here</a>.
        ${s.twelvedataKeySource === 'env' ? 'Currently set via TWELVEDATA_API_KEY env var.' : ''}
      </span>
    </div>

    <div class="field">
      <label for="set-refresh">Auto-refresh (seconds)</label>
      <input id="set-refresh" type="number" min="10" max="3600" value="${s.refreshSeconds}" />
    </div>

    <div class="field">
      <label for="set-tf">Default timeframe</label>
      <select id="set-tf">
        ${state.config.timeframes
          .map(
            (t) =>
              `<option value="${t.id}" ${t.id === s.defaultTimeframe ? 'selected' : ''}>${t.label}</option>`,
          )
          .join('')}
      </select>
    </div>

    <div class="field">
      <label for="set-strong">Strong Buy/Sell sensitivity</label>
      <input id="set-strong" type="number" step="0.05" min="0.05" max="1" value="${s.strongRatio}" />
      <span class="hint">Net buy/sell vote ratio that upgrades to Strong. Lower = triggers more easily (default 0.25).</span>
    </div>

    <div class="sheet-actions">
      <button class="btn ghost" data-close>Cancel</button>
      <button class="btn primary" id="save-settings">Save</button>
    </div>
  </div>`;
}

// ── data loading ────────────────────────────────────────────────────────────
async function loadConfig() {
  const config = await api('/api/config');
  state.config = config;
  state.settings = config.settings;
  state.timeframe = config.settings.defaultTimeframe || config.defaultTimeframe || '1d';
  renderTimeframes();
  renderSuggestions();
  renderBanner();
}

async function loadWatchlist() {
  const { symbols } = await api('/api/watchlist');
  state.watchlist = symbols;
}

async function loadAnalyses({ silent = false } = {}) {
  const token = ++state.requestId;
  state.loading = true;
  if (!silent) renderGrid();
  renderStatus();
  try {
    const res = await api(`/api/analysis?timeframe=${encodeURIComponent(state.timeframe)}`);
    if (token !== state.requestId) return;
    state.analyses = res.results;
    state.updatedAt = res.updatedAt;
    state.loading = false;
    resetCountdown();
    renderGrid();
    renderStatus();
  } catch (err) {
    state.loading = false;
    renderStatus();
    toast(err.message);
  }
}

let lastAgoTick = 0;
function resetCountdown() {
  secondsLeft = state.settings?.refreshSeconds || 60;
  updateRefreshInfo();
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  clearInterval(countdownTimer);
  const secs = Math.max(10, state.settings?.refreshSeconds || 60);
  resetCountdown();
  refreshTimer = setInterval(() => loadAnalyses({ silent: true }), secs * 1000);
  countdownTimer = setInterval(() => {
    secondsLeft = Math.max(0, secondsLeft - 1);
    updateRefreshInfo();
    if (Date.now() - lastAgoTick > 15000) {
      lastAgoTick = Date.now();
      renderGrid();
    }
  }, 1000);
}

// ── modal actions ───────────────────────────────────────────────────────────
async function openDetail(symbol, timeframe) {
  const sameSymbol = state.modal && state.modal.symbol === symbol;
  const ratings = sameSymbol ? state.modal.ratings : null;
  state.modal = { symbol, timeframe: timeframe || state.timeframe, data: null, ratings };
  renderModal();
  const token = ++state.modalRequestId;
  try {
    const data = await api(
      `/api/analysis/${encodeURIComponent(symbol)}?timeframe=${encodeURIComponent(state.modal.timeframe)}&all=1`,
    );
    if (token !== state.modalRequestId || !state.modal) return;
    state.modal.data = data;
    state.modal.ratings = data.timeframeRatings || state.modal.ratings;
    renderModal();
  } catch (err) {
    if (token !== state.modalRequestId || !state.modal) return;
    state.modal.data = { ok: false, symbol, error: err.message };
    renderModal();
  }
}

function closeModal() {
  state.modal = null;
  state.modalRequestId++;
  els.modal.innerHTML = '';
  els.modal.classList.add('hidden');
}

async function addSymbol(symbol) {
  if (!symbol || !symbol.trim()) return;
  try {
    const { symbols } = await api('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ symbol: symbol.trim() }),
    });
    state.watchlist = symbols;
    els.symbolInput.value = '';
    toast(`Added ${symbol.toUpperCase()}`);
    await loadAnalyses();
  } catch (err) {
    toast(err.message);
  }
}

async function removeSymbol(symbol) {
  try {
    const { symbols } = await api(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    state.watchlist = symbols;
    state.analyses = state.analyses.filter((a) => (a.symbol || '') !== symbol);
    if (state.modal && state.modal.symbol === symbol) closeModal();
    renderGrid();
    renderStatus();
    toast(`Removed ${symbol}`);
  } catch (err) {
    toast(err.message);
  }
}

async function saveSettings() {
  const key = $('set-key')?.value;
  const patch = {
    refreshSeconds: Number($('set-refresh')?.value || 60),
    defaultTimeframe: $('set-tf')?.value || '1d',
    strongRatio: Number($('set-strong')?.value || 0.25),
  };
  if (key && key.trim()) patch.twelvedataKey = key.trim();
  try {
    state.settings = await api('/api/settings', { method: 'POST', body: JSON.stringify(patch) });
    closeModal();
    state.timeframe = state.settings.defaultTimeframe || state.timeframe;
    renderTimeframes();
    renderBanner();
    scheduleRefresh();
    toast('Settings saved');
    await loadAnalyses();
  } catch (err) {
    toast(err.message);
  }
}

// ── events ──────────────────────────────────────────────────────────────────
function bindEvents() {
  els.timeframes.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tf]');
    if (!btn) return;
    state.timeframe = btn.dataset.tf;
    renderTimeframes();
    loadAnalyses();
  });

  els.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addSymbol(els.symbolInput.value);
  });

  els.refreshBtn.addEventListener('click', () => {
    toast('Refreshing…');
    loadAnalyses();
  });

  els.settingsBtn.addEventListener('click', renderSettings);
  els.bannerAction.addEventListener('click', renderSettings);

  els.grid.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      e.stopPropagation();
      removeSymbol(removeBtn.dataset.remove);
      return;
    }
    const card = e.target.closest('.card');
    if (card && !card.classList.contains('error')) openDetail(card.dataset.symbol);
  });

  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) return closeModal();
    if (e.target.closest('[data-close]')) return closeModal();
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) return removeSymbol(removeBtn.dataset.remove);
    if (e.target.closest('#save-settings')) return saveSettings();
    const mtf = e.target.closest('[data-mtf]');
    if (mtf && state.modal) return openDetail(state.modal.symbol, mtf.dataset.mtf);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.modal) closeModal();
  });
}

// ── boot ────────────────────────────────────────────────────────────────────
async function init() {
  bindEvents();
  try {
    await loadConfig();
    await loadWatchlist();
    scheduleRefresh();
    await loadAnalyses();
  } catch (err) {
    els.status.textContent = 'Failed to start';
    toast(err.message);
  }
}

init();
