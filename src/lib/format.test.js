import { describe, it, expect } from 'vitest';
import { fmtUsd, fmtPrice, fmtCompact, fmtNum, pct, cls, timeAgo, agoLabel } from './format.js';

describe('fmtPrice', () => {
  it('uses more decimals for small values', () => {
    expect(fmtPrice(0.00000123)).toBe('0.00000123');
    expect(fmtPrice(0.1234)).toBe('0.1234');
    expect(fmtPrice(1234.5)).toBe('1,234.50');
  });
  it('handles null and NaN safely', () => {
    expect(fmtPrice(null)).toBe('—');
    expect(fmtPrice(NaN)).toBe('—');
    expect(fmtPrice(undefined)).toBe('—');
  });
});

describe('fmtCompact', () => {
  it('formats trillions, billions, millions and thousands', () => {
    expect(fmtCompact(2.5e12)).toBe('$2.50T');
    expect(fmtCompact(3.2e9)).toBe('$3.20B');
    expect(fmtCompact(4.5e6)).toBe('$4.50M');
    expect(fmtCompact(1234)).toBe('$1.23K');
  });
  it('keeps the sign for negatives', () => {
    expect(fmtCompact(-2.5e9)).toBe('-$2.50B');
  });
  it('handles missing data', () => {
    expect(fmtCompact(null)).toBe('—');
  });
});

describe('fmtUsd / fmtNum', () => {
  it('formats dollars with two decimals by default', () => {
    expect(fmtUsd(1000)).toBe('$1,000.00');
  });
  it('supports explicit precision', () => {
    expect(fmtUsd(1.005, 1)).toBe('$1.0');
  });
  it('formats integers without decimals', () => {
    expect(fmtNum(1234567.89)).toBe('1,234,568');
    expect(fmtNum(null)).toBe('—');
  });
});

describe('pct', () => {
  it('adds a plus sign for gains and keeps the minus for losses', () => {
    expect(pct(1.234)).toBe('+1.23%');
    expect(pct(-0.5)).toBe('-0.50%');
  });
  it('handles missing data', () => {
    expect(pct(null)).toBe('—');
  });
});

describe('cls', () => {
  it('maps direction to colour classes', () => {
    expect(cls(1)).toContain('text-up');
    expect(cls(0)).toContain('text-up');
    expect(cls(-1)).toContain('text-down');
    expect(cls(null)).toContain('text-muted-foreground');
  });
});

describe('timeAgo / agoLabel', () => {
  it('describes recent timestamps', () => {
    expect(timeAgo(Date.now() - 5000)).toMatch(/^\d+s ago$/);
    expect(timeAgo(Date.now() - 120000)).toBe('2m ago');
  });
  it('describes feed freshness', () => {
    expect(agoLabel(null)).toBe('connecting…');
    expect(agoLabel(Date.now())).toBe('live');
    expect(agoLabel(Date.now() - 30000)).toBe('30s');
  });
});
