/* Chart-type transforms and scale helpers. Pure functions — unit tested.
 * Non-time-based charts (Renko, Range, Kagi, P&F) are derived from OHLC bars.
 */

const round = (n, d = 8) => Number(n.toFixed(d));

/** Heikin Ashi: smoothed candles (HA close = OHLC average of the bar). */
export function heikinAshi(candles = []) {
  const out = [];
  let prevOpen = null;
  let prevClose = null;
  candles.forEach((c, i) => {
    const haClose = (c.o + c.h + c.l + c.c) / 4;
    const haOpen = i === 0 || prevOpen == null ? (c.o + c.c) / 2 : (prevOpen + prevClose) / 2;
    const haHigh = Math.max(c.h, haOpen, haClose);
    const haLow = Math.min(c.l, haOpen, haClose);
    out.push({ t: c.t, o: round(haOpen), h: round(haHigh), l: round(haLow), c: round(haClose), v: c.v, ha: true });
    prevOpen = haOpen;
    prevClose = haClose;
  });
  return out;
}

/** Series for line/area/baseline renderers. */
export function toSeries(candles = [], field = 'c') {
  return candles.map((c) => ({ t: c.t, v: c[field] ?? c.c }));
}

/** Renko bricks: a new brick only when price moves a full box size. */
export function renko(candles = [], { boxSize } = {}) {
  if (!candles.length) return [];
  const size = boxSize || Math.max(1e-8, (Math.max(...candles.map((c) => c.h)) - Math.min(...candles.map((c) => c.l))) / 40);
  const bricks = [];
  let base = candles[0].c;
  candles.forEach((c) => {
    let price = c.c;
    while (Math.abs(price - base) >= size) {
      const dir = price > base ? 1 : -1;
      const open = base;
      const close = round(base + dir * size);
      bricks.push({ t: c.t, o: open, c: close, h: Math.max(open, close), l: Math.min(open, close), dir, v: c.v });
      base = close;
    }
  });
  return bricks;
}

/** Range bars: a new bar whenever the high-low range of the current bar is filled. */
export function rangeBars(candles = [], { rangeSize } = {}) {
  if (!candles.length) return [];
  const size = rangeSize || Math.max(1e-8, (Math.max(...candles.map((c) => c.h)) - Math.min(...candles.map((c) => c.l))) / 40);
  const bars = [];
  let cur = null;
  candles.forEach((c) => {
    if (!cur) {
      cur = { t: c.t, o: c.c, h: c.c, l: c.c, c: c.c, v: c.v || 0, dir: 1 };
    }
    cur.h = Math.max(cur.h, c.c);
    cur.l = Math.min(cur.l, c.c);
    cur.c = c.c;
    cur.v += c.v || 0;
    cur.dir = cur.c >= cur.o ? 1 : -1;
    if (cur.h - cur.l >= size) {
      bars.push(cur);
      cur = { t: c.t, o: c.c, h: c.c, l: c.c, c: c.c, v: 0, dir: 1 };
    }
  });
  if (cur && (cur.h !== cur.l || cur.v)) bars.push(cur);
  return bars;
}

/** Kagi: alternating thick (yang) / thin (yin) lines on a reversal threshold. */
export function kagi(candles = [], { reversalPct = 4 } = {}) {
  if (!candles.length) return [];
  const segments = [];
  let dir = 1;
  let pivot = candles[0].c;
  let extreme = pivot;
  segments.push({ t: candles[0].t, price: pivot, dir, yang: true });
  candles.forEach((c) => {
    const p = c.c;
    const reversal = (Math.abs(p - extreme) / (extreme || 1)) * 100;
    if (dir === 1 && p > extreme) {
      extreme = p;
      segments[segments.length - 1].price = p;
    } else if (dir === -1 && p < extreme) {
      extreme = p;
      segments[segments.length - 1].price = p;
    } else if (reversal >= reversalPct) {
      dir = dir === 1 ? -1 : 1;
      pivot = extreme;
      extreme = p;
      segments.push({ t: c.t, price: pivot, dir, yang: dir === 1 });
      segments.push({ t: c.t, price: p, dir, yang: dir === 1 });
    }
  });
  return segments;
}

/** Point & Figure columns built from fixed box sizes with a reversal count. */
export function pointAndFigure(candles = [], { boxSize, reversal = 3 } = {}) {
  if (!candles.length) return [];
  const size = boxSize || Math.max(1e-8, (Math.max(...candles.map((c) => c.h)) - Math.min(...candles.map((c) => c.l))) / 40);
  const columns = [];
  let dir = 0;
  let level = candles[0].c;
  let col = null;
  candles.forEach((c) => {
    let price = c.c;
    if (dir === 1 && price >= level + size) {
      const steps = Math.floor((price - level) / size);
      for (let i = 0; i < steps; i++) {
        level += size;
        col.boxes.push({ price: level, t: c.t });
      }
    } else if (dir === -1 && price <= level - size) {
      const steps = Math.floor((level - price) / size);
      for (let i = 0; i < steps; i++) {
        level -= size;
        col.boxes.push({ price: level, t: c.t });
      }
    } else if (dir >= 0 && price <= level - size * reversal) {
      dir = -1;
      level -= size;
      col = { dir, boxes: [{ price: level, t: c.t }] };
      columns.push(col);
    } else if (dir <= 0 && price >= level + size * reversal) {
      dir = 1;
      level += size;
      col = { dir, boxes: [{ price: level, t: c.t }] };
      columns.push(col);
    }
    if (!col) {
      dir = dir || 1;
      col = { dir, boxes: [] };
      columns.push(col);
    }
  });
  return columns.filter((c) => c.boxes.length);
}

/** Volume profile: volume distributed across price buckets (buy vs sell by bar direction). */
export function volumeProfile(candles = [], { bins = 24 } = {}) {
  if (!candles.length) return { rows: [], poc: null, valueArea: null };
  const min = Math.min(...candles.map((c) => c.l));
  const max = Math.max(...candles.map((c) => c.h));
  const span = max - min || 1;
  const bucket = span / bins;
  const rows = Array.from({ length: bins }, (_, i) => ({
    price: min + bucket * (i + 0.5),
    buy: 0,
    sell: 0,
    total: 0,
    count: 0
  }));
  candles.forEach((c) => {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((c.c + c.o) / 2 - min) / bucket)));
    const row = rows[idx];
    const vol = c.v || 0;
    if (c.c >= c.o) row.buy += vol;
    else row.sell += vol;
    row.total += vol;
    row.count += 1;
  });
  const pocRow = rows.reduce((a, b) => (b.total > a.total ? b : a), rows[0]);
  // Value area: expand from POC until 70% of volume is covered.
  const totalVol = rows.reduce((a, r) => a + r.total, 0);
  const sortedByDist = [...rows].sort((a, b) => Math.abs(a.price - pocRow.price) - Math.abs(b.price - pocRow.price));
  let covered = 0;
  const area = [];
  for (const r of sortedByDist) {
    area.push(r);
    covered += r.total;
    if (totalVol && covered / totalVol >= 0.7) break;
  }
  const prices = area.map((r) => r.price).sort((a, b) => a - b);
  return {
    rows,
    poc: pocRow.price,
    valueArea: prices.length ? { low: prices[0], high: prices[prices.length - 1] } : null
  };
}

/** Market profile (TPO): how many bars touched each price bucket. */
export function marketProfile(candles = [], { bins = 24 } = {}) {
  if (!candles.length) return [];
  const min = Math.min(...candles.map((c) => c.l));
  const max = Math.max(...candles.map((c) => c.h));
  const bucket = (max - min || 1) / bins;
  const rows = Array.from({ length: bins }, () => ({ tpo: 0 }));
  candles.forEach((c) => {
    const from = Math.min(bins - 1, Math.max(0, Math.floor((c.l - min) / bucket)));
    const to = Math.min(bins - 1, Math.max(0, Math.floor((c.h - min) / bucket)));
    for (let i = from; i <= to; i++) rows[i].tpo += 1;
  });
  return rows.map((r, i) => ({ price: min + bucket * (i + 0.5), tpo: r.tpo }));
}

/** Value mapping for linear / logarithmic / percentage scales. */
export function scaleValue(value, { mode = 'linear', base = null } = {}) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (mode === 'log') return Math.log10(value);
  if (mode === 'percent' && base) return ((value - base) / base) * 100;
  return value;
}
