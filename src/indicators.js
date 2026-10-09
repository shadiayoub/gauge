// Technical indicator math. All functions accept arrays of numbers (or arrays
// of OHLC candle objects) and return arrays aligned 1:1 with the input, using
// `null` for positions where the indicator is not yet defined. That makes it
// trivial to grab the latest value with `last()`.
//
// Implementations follow the standard (Wilder / MetaTrader) definitions so the
// results line up with what investing.com and TradingView display.

/** Simple moving average. */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average seeded with an SMA of the first `period` values. */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      seed += values[i];
      if (i === period - 1) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** SMA that tolerates leading nulls (used to smooth other indicators). */
export function smaNullable(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j];
      if (v === null || v === undefined || Number.isNaN(v)) { ok = false; break; }
      sum += v;
    }
    if (ok) out[i] = sum / period;
  }
  return out;
}

/** EMA that tolerates leading nulls. */
export function emaNullable(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || Number.isNaN(v)) {
      prev = null;
      seed = 0;
      count = 0;
      continue;
    }
    if (prev === null) {
      seed += v;
      count++;
      if (count === period) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        out[i] = toRsi(avgGain, avgLoss);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = toRsi(avgGain, avgLoss);
    }
  }
  return out;
}

function toRsi(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** True range (Wilder). */
export function trueRange(candles) {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
}

/** Average True Range (Wilder). */
export function atr(candles, period = 14) {
  const tr = trueRange(candles);
  const out = new Array(candles.length).fill(null);
  let prev = null;
  let seed = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      seed += tr[i];
      if (i === period - 1) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
  }
  return out;
}

/** Slow stochastic. MetaTrader convention STOCH(k, d, slowing). */
export function stochastic(candles, kPeriod = 9, dPeriod = 6, slowing = 3) {
  const rawK = candles.map((c, i) => {
    if (i < kPeriod - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    const range = hh - ll;
    return range === 0 ? 50 : ((c.close - ll) / range) * 100;
  });
  const k = smaNullable(rawK, slowing);
  const d = smaNullable(k, dPeriod);
  return { k, d };
}

/** Stochastic RSI. */
export function stochRsi(values, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dPeriod = 3) {
  const r = rsi(values, rsiPeriod);
  const raw = r.map((v, i) => {
    if (v === null || i < stochPeriod - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (r[j] === null) return null;
      if (r[j] > hh) hh = r[j];
      if (r[j] < ll) ll = r[j];
    }
    const range = hh - ll;
    return range === 0 ? 50 : ((v - ll) / range) * 100;
  });
  const k = smaNullable(raw, kSmooth);
  const d = smaNullable(k, dPeriod);
  return { k, d };
}

/** MACD line, signal line and histogram. */
export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] === null || emaSlow[i] === null ? null : emaFast[i] - emaSlow[i],
  );
  const signal = emaNullable(macdLine, signalPeriod);
  const hist = macdLine.map((v, i) =>
    v === null || signal[i] === null ? null : v - signal[i],
  );
  return { macd: macdLine, signal, hist };
}

/** Wilder ADX with +DI / -DI. */
export function adx(candles, period = 14) {
  const n = candles.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    const pc = candles[i - 1].close;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - pc),
      Math.abs(candles[i].low - pc),
    );
  }

  const smooth = (arr) => {
    const s = new Array(n).fill(null);
    let sum = 0;
    for (let i = 1; i < n; i++) {
      if (i <= period) {
        sum += arr[i];
        if (i === period) s[i] = sum;
      } else {
        s[i] = s[i - 1] - s[i - 1] / period + arr[i];
      }
    }
    return s;
  };

  const sTR = smooth(tr);
  const sPlus = smooth(plusDM);
  const sMinus = smooth(minusDM);

  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);
  const dx = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (sTR[i]) {
      plusDI[i] = (100 * sPlus[i]) / sTR[i];
      minusDI[i] = (100 * sMinus[i]) / sTR[i];
      const sum = plusDI[i] + minusDI[i];
      dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
    }
  }

  const adxLine = new Array(n).fill(null);
  let prev = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (dx[i] === null) continue;
    if (prev === null) {
      seed += dx[i];
      count++;
      if (count === period) {
        prev = seed / period;
        adxLine[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + dx[i]) / period;
      adxLine[i] = prev;
    }
  }

  return { adx: adxLine, plusDI, minusDI };
}

/** Williams %R (range -100..0). */
export function williamsR(candles, period = 14) {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    const range = hh - ll;
    return range === 0 ? -50 : ((hh - c.close) / range) * -100;
  });
}

/** Commodity Channel Index. */
export function cci(candles, period = 20) {
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const ma = sma(tp, period);
  return candles.map((_, i) => {
    if (ma[i] === null) return null;
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(tp[j] - ma[i]);
    meanDev /= period;
    return meanDev === 0 ? 0 : (tp[i] - ma[i]) / (0.015 * meanDev);
  });
}

/** Williams' Ultimate Oscillator. */
export function ultimateOscillator(candles, p1 = 7, p2 = 14, p3 = 28) {
  const n = candles.length;
  const bp = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const pc = candles[i - 1].close;
    bp[i] = candles[i].close - Math.min(candles[i].low, pc);
    tr[i] = Math.max(candles[i].high, pc) - Math.min(candles[i].low, pc);
  }
  const sumBack = (arr, period, end) => {
    let s = 0;
    for (let j = end - period + 1; j <= end; j++) if (j >= 0) s += arr[j];
    return s;
  };
  const out = new Array(n).fill(null);
  for (let i = p3; i < n; i++) {
    const t1 = sumBack(tr, p1, i);
    const t2 = sumBack(tr, p2, i);
    const t3 = sumBack(tr, p3, i);
    if (!t1 || !t2 || !t3) { out[i] = 50; continue; }
    const a1 = sumBack(bp, p1, i) / t1;
    const a2 = sumBack(bp, p2, i) / t2;
    const a3 = sumBack(bp, p3, i) / t3;
    out[i] = (100 * (4 * a1 + 2 * a2 + a3)) / 7;
  }
  return out;
}

/** Rate of Change (%). */
export function roc(values, period = 14) {
  return values.map((v, i) => {
    if (i < period) return null;
    const prev = values[i - period];
    return prev === 0 ? 0 : ((v - prev) / prev) * 100;
  });
}

/**
 * Investing.com "Highs/Lows(14)" oscillator: distance of the close from the
 * midpoint of the 14-period high/low range. Positive = bullish.
 */
export function highsLows(candles, period = 14) {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    return c.close - (hh + ll) / 2;
  });
}

/**
 * Elder / investing.com "Bull/Bear Power(13)": bull power (high - EMA13) plus
 * bear power (low - EMA13). The sign tells you which side of the EMA midpoint
 * the market is trading.
 */
export function bullBearPower(candles, period = 13) {
  const closes = candles.map((c) => c.close);
  const e = ema(closes, period);
  return candles.map((c, i) => (e[i] === null ? null : c.high - e[i] + (c.low - e[i])));
}

/** Latest non-null value of an indicator array. */
export function last(arr) {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined && !Number.isNaN(arr[i])) return arr[i];
  }
  return null;
}

/**
 * Resample candles into a larger timeframe by aggregating `factor` consecutive
 * candles (used for Yahoo, which has no 4h interval).
 */
export function aggregate(candles, factor) {
  const out = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (!chunk.length) continue;
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + (c.volume || 0), 0),
    });
  }
  return out;
}
