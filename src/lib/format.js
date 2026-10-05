// Number/formatting helpers

export function fmtUsd(n, digits) {
  if (n == null || Number.isNaN(n)) return '—';
  const d = digits ?? (Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 1 ? 2 : 4);
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  let d = 2;
  if (abs < 0.0001) d = 8;
  else if (abs < 0.01) d = 6;
  else if (abs < 1) d = 4;
  else if (abs < 1000) d = 2;
  else d = 2;
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtCompact(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(2) + 'K';
  return sign + '$' + abs.toFixed(2);
}

export function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function pct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
}

export function cls(n) {
  if (n == null || Number.isNaN(n)) return 'text-muted-foreground';
  return n >= 0 ? 'text-up' : 'text-down';
}

export function sign(n) {
  return n >= 0 ? '+' : '';
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

export function agoLabel(last) {
  if (!last) return 'connecting…';
  const s = Math.floor((Date.now() - last) / 1000);
  if (s < 3) return 'live';
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm';
}
