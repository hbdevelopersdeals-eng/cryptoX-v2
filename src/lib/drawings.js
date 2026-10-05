/* Chart drawing tools: pure geometry for every overlay the UI offers.
 *
 * A point is { x, y, price, t? } in CHART space, where x is the bar index and y
 * is the pixel row. Keeping the maths here — separate from the canvas — means
 * every tool is unit-testable without a DOM.
 *
 * Angles and offsets are derived from two anchors, so a drawing keeps its shape
 * when the chart is rescaled or the price range changes.
 */

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXTENSIONS = [1.272, 1.414, 1.618, 2, 2.618];

const p = (v) => (Number.isFinite(v) ? v : null);
const pt = (o) => (o && p(o.x) != null && p(o.y) != null ? { x: o.x, y: o.y, price: o.price, t: o.t } : null);

/* ---------------- primitives ---------------- */

/** Slope/intercept of the line through two points, plus y at any x. */
export function lineFrom(a, b) {
  const A = pt(a); const B = pt(b);
  if (!A || !B) return null;
  if (A.x === B.x) return { vertical: true, x: A.x, yAt: () => null, slope: null, intercept: null };
  const slope = (B.y - A.y) / (B.x - A.x);
  const intercept = A.y - slope * A.x;
  return {
    vertical: false,
    slope,
    intercept,
    yAt: (x) => slope * x + intercept,
    // Price-per-bar, for measurement readouts.
    pricePerBar: p(A.price) != null && p(B.price) != null && B.x !== A.x
      ? (B.price - A.price) / (B.x - A.x)
      : null
  };
}

/** A trend line spans its anchors; a ray continues to the right edge only. */
export function trendLine(a, b, { maxX = null } = {}) {
  const L = lineFrom(a, b);
  if (!L) return null;
  const A = pt(a); const B = pt(b);
  const start = Math.min(A.x, B.x);
  const end = maxX != null ? maxX : Math.max(A.x, B.x);
  return { ...L, kind: 'trend', from: A, to: B, startX: start, endX: end };
}

export function ray(a, b, { maxX = 1000 } = {}) {
  const L = lineFrom(a, b);
  if (!L) return null;
  const A = pt(a); const B = pt(b);
  // A ray starts at the FIRST anchor and never draws behind it.
  return { ...L, kind: 'ray', from: A, to: B, startX: A.x, endX: maxX };
}

export function horizontalLine(a) {
  const A = pt(a);
  if (!A) return null;
  return { kind: 'hline', price: A.price, y: A.y, yAt: () => A.y, slope: 0, intercept: A.y, horizontal: true };
}

/**
 * Parallel channel: the base line plus a copy offset vertically by `offsetY`
 * (default: the perpendicular distance implied by the third point, if given).
 */
export function channel(a, b, { offsetY = null, c = null, maxX = null } = {}) {
  const base = trendLine(a, b, { maxX });
  if (!base) return null;
  const A = pt(a); const B = pt(b);
  let off = offsetY;
  if (off == null && c) {
    const C = pt(c);
    // Signed vertical distance from the base line to the third anchor.
    if (C) off = C.y - base.yAt(C.x);
  }
  const dy = off ?? Math.abs(B.y - A.y) * 0.5;
  return {
    kind: 'channel',
    base,
    upper: { ...base, intercept: base.intercept + dy, yAt: (x) => base.yAt(x) + dy },
    lower: { ...base, intercept: base.intercept - dy, yAt: (x) => base.yAt(x) - dy },
    offsetY: dy
  };
}

/* ---------------- Fibonacci ---------------- */

/**
 * Retracement of the move a → b. Levels are measured from the END of the move:
 * ratio 0 sits at b, ratio 1 at a (the standard convention).
 */
export function fibRetracement(a, b, ratios = FIB_RATIOS) {
  const A = pt(a); const B = pt(b);
  if (!A || !B) return null;
  if (p(A.price) == null || p(B.price) == null) return null;
  // Levels are measured back from B toward A, so ratio 0 sits at B and 1 at A.
  const retrace = A.price - B.price;
  // The move itself is B − A: that is what decides up/down.
  const span = B.price - A.price;
  const levels = ratios.map((r) => ({
    ratio: r,
    price: B.price + retrace * r,
    frac: r
  }));
  return { kind: 'fib', from: A, to: B, span, retrace, levels, direction: span > 0 ? 'up' : 'down' };
}

/** Extensions projected beyond b using the a→b leg. */
export function fibExtension(a, b, ratios = FIB_EXTENSIONS) {
  const A = pt(a); const B = pt(b);
  if (!A || !B) return null;
  if (p(A.price) == null || p(B.price) == null) return null;
  const leg = B.price - A.price;
  return {
    kind: 'fib-ext',
    from: A,
    to: B,
    leg,
    levels: ratios.map((r) => ({ ratio: r, price: B.price + leg * (r - 1) }))
  };
}

/* ---------------- Andrews pitchfork ---------------- */

/**
 * Andrews pitchfork from three pivots: the median line runs from P0 through the
 * midpoint of P1–P2, and the two parallels run from P1 and P2.
 */
export function andrewsPitchfork(p0, p1, p2, { maxX = null } = {}) {
  const P0 = pt(p0); const P1 = pt(p1); const P2 = pt(p2);
  if (!P0 || !P1 || !P2) return null;
  const mid = { x: (P1.x + P2.x) / 2, y: (P1.y + P2.y) / 2, price: null };
  if (p(P1.price) != null && p(P2.price) != null) mid.price = (P1.price + P2.price) / 2;

  const endX = maxX != null ? maxX : Math.max(P1.x, P2.x) + Math.abs(P2.x - P1.x);
  const median = lineFrom(P0, mid);
  if (!median) return null;

  // `yAt` is a closure over its own slope/intercept, so overriding `intercept`
  // alone would leave the parallels drawing exactly on top of the median.
  // Each line needs its own evaluator.
  const shift = (base, delta) => ({
    ...base,
    intercept: base.intercept + delta,
    yAt: (x) => base.yAt(x) + delta
  });

  return {
    kind: 'pitchfork',
    pivots: [P0, P1, P2],
    midpoint: mid,
    median: { ...median, startX: P0.x, endX },
    upper: { ...shift(median, P1.y - median.yAt(P1.x)), startX: P1.x, endX },
    lower: { ...shift(median, P2.y - median.yAt(P2.x)), startX: P2.x, endX }
  };
}

/* ---------------- Elliott Wave ---------------- */

const waveLegs = (points) => points.slice(1).map((q, i) => q.price - points[i].price);

/**
 * Validate a five-wave impulse against the three hard Elliott rules.
 * Returns the violations rather than a boolean, so the UI can explain a failure.
 */
export function validateElliottImpulse(points = []) {
  const pts = points.map(pt).filter(Boolean);
  if (pts.length !== 6) return { valid: false, reason: 'A five-wave impulse needs 6 pivots (P0…P5)' };
  if (pts.some((q) => p(q.price) == null)) return { valid: false, reason: 'Every pivot needs a price' };

  const w = waveLegs(pts); // w[0] = wave 1 … w[4] = wave 5
  const magnitudes = w.map(Math.abs);
  const bullish = w[0] > 0;

  const violations = [];

  // Rule 1 — wave 2 never retraces all of wave 1.
  if (Math.abs(w[1]) >= Math.abs(w[0])) violations.push('Wave 2 retraces 100% or more of wave 1');

  // Rule 2 — wave 3 is never the shortest of 1, 3, 5.
  const shortest = Math.min(magnitudes[0], magnitudes[2], magnitudes[4]);
  if (magnitudes[2] === shortest) violations.push('Wave 3 is the shortest of waves 1, 3 and 5');

  // Rule 3 — wave 4 must not overlap wave 1's territory.
  const wave1End = pts[1].price;
  const wave4End = pts[4].price;
  const overlap = bullish ? wave4End <= wave1End : wave4End >= wave1End;
  if (overlap) violations.push('Wave 4 overlaps the territory of wave 1');

  // Wave direction should alternate on a valid impulse.
  const alternating = w.every((leg, i) => (i === 0 ? true : Math.sign(leg) !== Math.sign(w[i - 1])));
  if (!alternating) violations.push('Waves do not alternate direction');

  return {
    valid: violations.length === 0,
    violations,
    direction: bullish ? 'bullish' : 'bearish',
    legs: w,
    magnitudes,
    // Measured relationships, useful for a fib-confluence read.
    relationships: {
      wave2RetracePct: magnitudes[0] ? (Math.abs(w[1]) / magnitudes[0]) * 100 : null,
      wave3ExtensionPct: magnitudes[0] ? (magnitudes[2] / magnitudes[0]) * 100 : null,
      wave4RetracePct: magnitudes[2] ? (Math.abs(w[3]) / magnitudes[2]) * 100 : null,
      wave5VsWave1Pct: magnitudes[0] ? (magnitudes[4] / magnitudes[0]) * 100 : null
    }
  };
}

/* ---------------- shapes, text and measurement ---------------- */

export function rectangle(a, b) {
  const A = pt(a); const B = pt(b);
  if (!A || !B) return null;
  return {
    kind: 'rect',
    x: Math.min(A.x, B.x),
    y: Math.min(A.y, B.y),
    width: Math.abs(B.x - A.x),
    height: Math.abs(B.y - A.y),
    from: A,
    to: B
  };
}

export function textAnchor(a, text = '') {
  const A = pt(a);
  if (!A) return null;
  return { kind: 'text', x: A.x, y: A.y, price: A.price, text: String(text) };
}

/**
 * Measurement between two points. `barsPerUnit` converts x-distance to bars so
 * the readout can state a duration as well as a price delta.
 */
export function measure(a, b, { barsPerUnit = 1 } = {}) {
  const A = pt(a); const B = pt(b);
  if (!A || !B) return null;
  const dPrice = p(A.price) != null && p(B.price) != null ? B.price - A.price : null;
  const pct = dPrice != null && A.price ? (dPrice / A.price) * 100 : null;
  const dBars = Math.abs(B.x - A.x) * barsPerUnit;
  return {
    kind: 'measure',
    dPrice,
    pct,
    dBars,
    dY: B.y - A.y,
    dX: B.x - A.x,
    direction: dPrice == null ? null : dPrice >= 0 ? 'up' : 'down'
  };
}

/* ---------------- hit testing ---------------- */

/** Which drawing is under the cursor, nearest first. */
export function hitTest(point, drawing, tolerance = 6) {
  const P = pt(point);
  if (!P || !drawing) return false;
  switch (drawing.kind) {
    case 'hline':
      return Math.abs(P.y - drawing.y) <= tolerance;
    case 'trend':
    case 'ray': {
      if (P.x < drawing.startX - tolerance || P.x > drawing.endX + tolerance) return false;
      const y = drawing.yAt(P.x);
      return y != null && Math.abs(P.y - y) <= tolerance;
    }
    case 'channel':
      return ['base', 'upper', 'lower'].some((k) => {
        const y = drawing[k].yAt(P.x);
        return y != null && Math.abs(P.y - y) <= tolerance;
      });
    case 'rect':
      return P.x >= drawing.x - tolerance
        && P.x <= drawing.x + drawing.width + tolerance
        && P.y >= drawing.y - tolerance
        && P.y <= drawing.y + drawing.height + tolerance;
    case 'text':
      return Math.abs(P.x - drawing.x) <= tolerance * 4 && Math.abs(P.y - drawing.y) <= tolerance;
    default:
      return false;
  }
}

/** Catalog the UI renders its tool palette from. */
export const DRAWING_TOOLS = [
  { id: 'none', label: 'Cursor', kind: null, points: 0 },
  { id: 'trend', label: 'Trend line', kind: 'trend', points: 2 },
  { id: 'ray', label: 'Ray', kind: 'ray', points: 2 },
  { id: 'hline', label: 'Horizontal', kind: 'hline', points: 1 },
  { id: 'channel', label: 'Channel', kind: 'channel', points: 3 },
  { id: 'fib', label: 'Fibonacci retracement', kind: 'fib', points: 2 },
  { id: 'fibext', label: 'Fibonacci extension', kind: 'fib-ext', points: 2 },
  { id: 'pitchfork', label: 'Andrews pitchfork', kind: 'pitchfork', points: 3 },
  { id: 'elliott', label: 'Elliott Wave (5)', kind: 'elliott', points: 6 },
  { id: 'rect', label: 'Rectangle', kind: 'rect', points: 2 },
  { id: 'text', label: 'Text', kind: 'text', points: 1 },
  { id: 'measure', label: 'Measure', kind: 'measure', points: 2 }
];

/** Build the geometry for a tool from its clicked points. */
export function buildDrawing(toolId, points = [], opts = {}) {
  const tool = DRAWING_TOOLS.find((t) => t.id === toolId);
  if (!tool || !tool.kind) return null;
  if (points.length < tool.points) return null;
  const P = points;

  switch (tool.kind) {
    case 'trend': return trendLine(P[0], P[1], opts);
    case 'ray': return ray(P[0], P[1], opts);
    case 'hline': return horizontalLine(P[0]);
    case 'channel': return channel(P[0], P[1], { c: P[2], ...opts });
    case 'fib': return fibRetracement(P[0], P[1]);
    case 'fib-ext': return fibExtension(P[0], P[1]);
    case 'pitchfork': return andrewsPitchfork(P[0], P[1], P[2], opts);
    case 'rect': return rectangle(P[0], P[1]);
    case 'text': return textAnchor(P[0], opts.text || '');
    case 'measure': return measure(P[0], P[1], opts);
    case 'elliott': {
      const check = validateElliottImpulse(P.slice(0, 6));
      return { kind: 'elliott', points: P.slice(0, 6), ...check };
    }
    default: return null;
  }
}
