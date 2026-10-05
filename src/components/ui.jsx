import React from 'react';
import { Link } from 'react-router-dom';
import { fmtPrice, fmtUsd, pct, cls } from '../lib/format.js';

/* ---------- Shared primitives ---------- */

export function CoinImg({ src, symbol, size = 22 }) {
  const [err, setErr] = React.useState(false);
  const fallback = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#23272E"/><text x="20" y="26" font-family="Arial" font-size="14" font-weight="700" fill="#F0F2F5" text-anchor="middle">${(symbol || '?').slice(0, 4)}</text></svg>`
  );
  return (
    <img
      src={err || !src ? fallback : src}
      alt={symbol}
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-full"
      style={{ width: size, height: size, objectFit: 'cover', background: '#23272E' }}
      onError={() => setErr(true)}
    />
  );
}

export function PriceCell({ value, className = '' }) {
  return <span className={'num text-sm text-foreground ' + className}>{fmtPrice(value)}</span>;
}

export function PctBadge({ value, size = 'md' }) {
  const up = (value ?? 0) >= 0;
  const clsName = size === 'sm' ? 'text-xs' : 'text-sm';
  return (
    <span className={`num inline-flex items-center gap-0.5 font-medium ${cls(value)}`}>
      {up ? '▲' : '▼'} {pct(value)}
    </span>
  );
}

export function SectionTitle({ title, sub, right }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {sub ? <p className="mt-1 text-sm text-muted-foreground">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Card({ className = '', children }) {
  return <div className={'card-panel p-5 ' + className}>{children}</div>;
}

export function EmptyState({ icon, title, sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon}
      <p className="mt-3 text-sm font-medium">{title}</p>
      {sub ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{sub}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone = 'default' }) {
  return (
    <div className="card-panel flex items-center gap-4 p-4">
      {icon ? (
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone === 'brand' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="num mt-0.5 truncate text-lg font-semibold leading-tight">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

export function Sparkline({ data, width = 84, height = 26, up = true, stroke = null }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const color = stroke || (data[0] <= data[data.length - 1] ? '#34d399' : '#f87171');
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((v - min) / range) * (height - 6)).toFixed(1)}`)
    .join(' ');
  const area = `${pts} ${width - 2},${height} 2,${height}`;
  const id = React.useId().replace(/:/g, '');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function CoinLink({ id, symbol, name, image, size = 22, sub }) {
  return (
    <Link to={`/coin/${id}`} className="group flex min-w-0 items-center gap-3">
      <CoinImg src={image} symbol={symbol} size={size} />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-medium group-hover:text-primary">
          {name}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{symbol}</span>
        </p>
        {sub}
      </div>
    </Link>
  );
}

export function Usd({ v }) {
  return <span className="num">{fmtUsd(v)}</span>;
}
