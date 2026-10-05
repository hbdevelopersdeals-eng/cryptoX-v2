import { describe, it, expect } from 'vitest';
import {
  lineFrom, trendLine, ray, horizontalLine, channel, fibRetracement, fibExtension,
  andrewsPitchfork, validateElliottImpulse, rectangle, textAnchor, measure, hitTest,
  buildDrawing, DRAWING_TOOLS, FIB_RATIOS, FIB_EXTENSIONS
} from './drawings.js';

/* Chart-space point: x = bar index, y = pixel row. */
const P = (x, y, price) => ({ x, y, price });

describe('line primitives', () => {
  it('derives slope, intercept and y at any x', () => {
    const L = lineFrom(P(0, 100, 10), P(10, 0, 20));
    expect(L.slope).toBeCloseTo(-10, 6);
    expect(L.intercept).toBeCloseTo(100, 6);
    expect(L.yAt(5)).toBeCloseTo(50, 6);
    expect(L.pricePerBar).toBeCloseTo(1, 6);
  });

  it('handles a vertical line without dividing by zero', () => {
    const L = lineFrom(P(5, 10, 1), P(5, 90, 2));
    expect(L.vertical).toBe(true);
    expect(L.slope).toBeNull();
    expect(L.yAt(5)).toBeNull();
  });

  it('rejects malformed points', () => {
    expect(lineFrom(P(0, 10, 1), null)).toBeNull();
    expect(lineFrom({ x: 0 }, P(1, 1, 1))).toBeNull();
  });

  it('a trend line spans both anchors; a ray only extends right', () => {
    const a = P(10, 100, 10); const b = P(20, 50, 20);
    const t = trendLine(a, b, { maxX: 50 });
    const r = ray(a, b, { maxX: 50 });
    expect(t.startX).toBe(10);
    expect(t.endX).toBe(50);
    // A ray never draws behind its first anchor.
    expect(r.startX).toBe(10);
    expect(r.endX).toBe(50);
    expect(r.slope).toBeCloseTo(t.slope, 10);
  });

  it('makes a horizontal line price-constant', () => {
    const h = horizontalLine(P(3, 250, 42000));
    expect(h.yAt(999)).toBe(250);
    expect(h.price).toBe(42000);
  });
});

describe('channel', () => {
  it('offsets a parallel copy by an explicit amount', () => {
    const c = channel(P(0, 100, 10), P(10, 0, 20), { offsetY: 20 });
    expect(c.offsetY).toBe(20);
    expect(c.upper.yAt(0)).toBeCloseTo(120, 6);
    expect(c.lower.yAt(0)).toBeCloseTo(80, 6);
    // Parallel: same slope on all three lines.
    expect(c.upper.slope).toBeCloseTo(c.base.slope, 10);
    expect(c.lower.slope).toBeCloseTo(c.base.slope, 10);
  });

  it('derives the offset from a third anchor', () => {
    // Base line y = 100 - 10x; at x=5 that is 50. A third point at y=70 → +20.
    const c = channel(P(0, 100, 10), P(10, 0, 20), { c: P(5, 70, 15) });
    expect(c.offsetY).toBeCloseTo(20, 6);
  });
});

describe('Fibonacci', () => {
  it('measures retracement from the end of the move', () => {
    const f = fibRetracement(P(0, 0, 100), P(10, 100, 200));
    const at = (r) => f.levels.find((l) => l.ratio === r).price;
    expect(at(0)).toBeCloseTo(200, 6);   // 0% sits at the end of the move
    expect(at(1)).toBeCloseTo(100, 6);   // 100% at the start
    expect(at(0.5)).toBeCloseTo(150, 6); // midpoint
    expect(at(0.618)).toBeCloseTo(200 - 100 * 0.618, 6);
    // The MOVE from 100 to 200 is up; span is B − A.
    expect(f.span).toBeCloseTo(100, 6);
    expect(f.direction).toBe('up');
  });

  it('works for a falling move too', () => {
    const f = fibRetracement(P(0, 0, 200), P(10, 100, 100));
    expect(f.direction).toBe('down');
    const at = (r) => f.levels.find((l) => l.ratio === r).price;
    expect(at(0)).toBeCloseTo(100, 6);
    expect(at(1)).toBeCloseTo(200, 6);
  });

  it('projects extension levels beyond the second anchor', () => {
    const e = fibExtension(P(0, 0, 100), P(10, 100, 200));
    expect(e.leg).toBeCloseTo(100, 6);
    const at = (r) => e.levels.find((l) => l.ratio === r).price;
    expect(at(1.618)).toBeCloseTo(200 + 100 * 0.618, 6);
    expect(at(2)).toBeCloseTo(300, 6);
  });

  it('returns null without prices', () => {
    expect(fibRetracement(P(0, 0, null), P(1, 1, 100))).toBeNull();
    expect(fibExtension({ x: 0, y: 0, price: 1 }, null)).toBeNull();
  });

  it('exposes the standard ratios', () => {
    expect(FIB_RATIOS).toContain(0.618);
    expect(FIB_EXTENSIONS).toContain(1.618);
  });
});

describe('Andrews pitchfork', () => {
  it('runs the median through the midpoint of P1 and P2', () => {
    const pf = andrewsPitchfork(P(0, 200, 10), P(10, 100, 20), P(20, 150, 15), { maxX: 60 });
    // Midpoint of P1(10,100) and P2(20,150) is (15,125)
    expect(pf.median.yAt(15)).toBeCloseTo(125, 6);
    // The median must actually pass through P0.
    expect(pf.median.yAt(0)).toBeCloseTo(200, 6);
  });

  it('puts the parallels through P1 and P2 with the median slope', () => {
    const pf = andrewsPitchfork(P(0, 200, 10), P(10, 100, 20), P(20, 150, 15), { maxX: 60 });
    expect(pf.upper.yAt(10)).toBeCloseTo(100, 6);
    expect(pf.lower.yAt(20)).toBeCloseTo(150, 6);
    expect(pf.upper.slope).toBeCloseTo(pf.median.slope, 10);
    expect(pf.lower.slope).toBeCloseTo(pf.median.slope, 10);
    expect(pf.pivots).toHaveLength(3);
  });

  it('needs three pivots', () => {
    expect(andrewsPitchfork(P(0, 1, 1), P(1, 1, 1), null)).toBeNull();
  });
});

describe('Elliott Wave impulse rules', () => {
  // Clean bullish impulse: +10, −5, +20, −7, +12
  const good = [P(0, 0, 100), P(1, 0, 110), P(2, 0, 105), P(3, 0, 125), P(4, 0, 118), P(5, 0, 130)];

  it('accepts a textbook five-wave impulse', () => {
    const r = validateElliottImpulse(good);
    expect(r.valid, r.violations.join('; ')).toBe(true);
    expect(r.direction).toBe('bullish');
    expect(r.violations).toEqual([]);
    expect(r.relationships.wave2RetracePct).toBeCloseTo(50, 6);
    expect(r.relationships.wave3ExtensionPct).toBeCloseTo(200, 6);
  });

  it('rejects wave 2 retracing all of wave 1', () => {
    const bad = [P(0, 0, 100), P(1, 0, 110), P(2, 0, 100), P(3, 0, 125), P(4, 0, 118), P(5, 0, 130)];
    const r = validateElliottImpulse(bad);
    expect(r.valid).toBe(false);
    expect(r.violations.join(' ')).toMatch(/Wave 2 retraces/);
  });

  it('rejects wave 3 being the shortest of 1, 3, 5', () => {
    const bad = [P(0, 0, 100), P(1, 0, 110), P(2, 0, 106), P(3, 0, 112), P(4, 0, 108), P(5, 0, 122)];
    const r = validateElliottImpulse(bad);
    expect(r.valid).toBe(false);
    expect(r.violations.join(' ')).toMatch(/Wave 3 is the shortest/);
  });

  it('rejects wave 4 overlapping wave 1 territory', () => {
    const bad = [P(0, 0, 100), P(1, 0, 110), P(2, 0, 105), P(3, 0, 125), P(4, 0, 105), P(5, 0, 130)];
    const r = validateElliottImpulse(bad);
    expect(r.valid).toBe(false);
    expect(r.violations.join(' ')).toMatch(/Wave 4 overlaps/);
  });

  it('reports the reason instead of throwing on the wrong number of pivots', () => {
    expect(validateElliottImpulse([P(0, 0, 1)]).valid).toBe(false);
    expect(validateElliottImpulse([P(0, 0, 1)]).reason).toMatch(/6 pivots/);
    expect(validateElliottImpulse(good.slice(0, 6).map((p) => ({ ...p, price: null }))).reason).toMatch(/price/);
  });

  it('handles a bearish impulse', () => {
    const bear = [P(0, 0, 200), P(1, 0, 190), P(2, 0, 195), P(3, 0, 175), P(4, 0, 182), P(5, 0, 168)];
    const r = validateElliottImpulse(bear);
    expect(r.direction).toBe('bearish');
    expect(r.valid, r.violations.join('; ')).toBe(true);
  });
});

describe('shapes, text and measurement', () => {
  it('normalises a rectangle to positive width/height', () => {
    const r1 = rectangle(P(30, 80, 2), P(10, 20, 1));
    expect(r1.x).toBe(10);
    expect(r1.y).toBe(20);
    expect(r1.width).toBe(20);
    expect(r1.height).toBe(60);
  });

  it('anchors text to a point', () => {
    const t = textAnchor(P(4, 44, 100), 'Breakout');
    expect(t.text).toBe('Breakout');
    expect(t.x).toBe(4);
    expect(t.price).toBe(100);
  });

  it('measures price delta, percent and duration', () => {
    const m = measure(P(0, 200, 100), P(20, 100, 110), { barsPerUnit: 1 });
    expect(m.dPrice).toBeCloseTo(10, 6);
    expect(m.pct).toBeCloseTo(10, 6);
    expect(m.dBars).toBe(20);
    expect(m.direction).toBe('up');

    const down = measure(P(0, 100, 100), P(10, 200, 95));
    expect(down.direction).toBe('down');
    expect(down.pct).toBeCloseTo(-5, 6);
  });

  it('returns null without usable points', () => {
    expect(rectangle(P(1, 1, 1), null)).toBeNull();
    expect(textAnchor(null)).toBeNull();
    expect(measure(P(0, 0, null), null)).toBeNull();
  });
});

describe('hit testing', () => {
  it('finds a horizontal line within tolerance only', () => {
    const h = horizontalLine(P(0, 100, 50));
    expect(hitTest(P(20, 103, 50), h, 6)).toBe(true);
    expect(hitTest(P(20, 120, 50), h, 6)).toBe(false);
  });

  it('finds a trend line along its span but not past it', () => {
    const t = trendLine(P(0, 100, 10), P(10, 0, 20));
    expect(hitTest(P(5, 50, 15), t, 6)).toBe(true);   // on the line
    expect(hitTest(P(50, 50, 15), t, 6)).toBe(false); // beyond the right anchor
  });

  it('finds any of a channel three lines', () => {
    const c = channel(P(0, 100, 10), P(10, 0, 20), { offsetY: 20 });
    expect(hitTest(P(0, 120, 10), c, 6)).toBe(true);  // upper
    expect(hitTest(P(0, 80, 10), c, 6)).toBe(true);   // lower
    expect(hitTest(P(0, 40, 10), c, 6)).toBe(false);
  });

  it('finds a rectangle interior', () => {
    const r = rectangle(P(0, 100, 10), P(20, 50, 20));
    expect(hitTest(P(10, 75, 15), r, 6)).toBe(true);
    expect(hitTest(P(60, 75, 15), r, 6)).toBe(false);
  });
});

describe('tool catalog', () => {
  it('lists every tool the palette offers, with point counts', () => {
    expect(DRAWING_TOOLS.length).toBeGreaterThanOrEqual(12);
    DRAWING_TOOLS.forEach((t) => {
      expect(t.label.length).toBeGreaterThan(0);
      expect(typeof t.points).toBe('number');
    });
    ['trend', 'ray', 'hline', 'channel', 'fib', 'fibext', 'pitchfork', 'elliott', 'rect', 'text', 'measure']
      .forEach((id) => expect(DRAWING_TOOLS.some((t) => t.id === id), id).toBe(true));
  });

  it('builds the right geometry per tool', () => {
    expect(buildDrawing('trend', [P(0, 10, 1), P(10, 20, 2)]).kind).toBe('trend');
    expect(buildDrawing('ray', [P(0, 10, 1), P(10, 20, 2)]).kind).toBe('ray');
    expect(buildDrawing('hline', [P(0, 10, 1)]).kind).toBe('hline');
    expect(buildDrawing('channel', [P(0, 10, 1), P(10, 20, 2), P(5, 40, 3)]).kind).toBe('channel');
    expect(buildDrawing('fib', [P(0, 10, 1), P(10, 20, 2)]).kind).toBe('fib');
    expect(buildDrawing('fibext', [P(0, 10, 1), P(10, 20, 2)]).kind).toBe('fib-ext');
    expect(buildDrawing('pitchfork', [P(0, 10, 1), P(10, 20, 2), P(20, 30, 3)]).kind).toBe('pitchfork');
    expect(buildDrawing('rect', [P(0, 10, 1), P(10, 20, 2)]).kind).toBe('rect');
    expect(buildDrawing('measure', [P(0, 10, 1), P(10, 20, 2)]).kind).toBe('measure');
    expect(buildDrawing('text', [P(0, 10, 1)], { text: 'hi' }).text).toBe('hi');
  });

  it('builds a validated five-wave impulse', () => {
    const pts = [P(0, 0, 100), P(1, 0, 110), P(2, 0, 105), P(3, 0, 125), P(4, 0, 118), P(5, 0, 130)];
    const d = buildDrawing('elliott', pts);
    expect(d.kind).toBe('elliott');
    expect(d.valid).toBe(true);
    expect(d.points).toHaveLength(6);
  });

  it('refuses to build until it has enough points', () => {
    expect(buildDrawing('trend', [P(0, 10, 1)])).toBeNull();
    expect(buildDrawing('pitchfork', [P(0, 10, 1), P(1, 1, 1)])).toBeNull();
    expect(buildDrawing('elliott', [P(0, 10, 1)])).toBeNull();
  });

  it('returns null for an unknown or cursor tool', () => {
    expect(buildDrawing('none', [P(0, 1, 1), P(1, 2, 2)])).toBeNull();
    expect(buildDrawing('nope', [P(0, 1, 1)])).toBeNull();
  });
});
