import React from 'react';

const ZONES = [
  { range: '0–24', label: 'Extreme Fear', color: '#F87171', bg: 'rgba(248, 113, 113, 0.15)' },
  { range: '25–44', label: 'Fear', color: '#FB923C', bg: 'rgba(251, 146, 60, 0.15)' },
  { range: '45–54', label: 'Neutral', color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.15)' },
  { range: '55–74', label: 'Greed', color: '#A3E635', bg: 'rgba(163, 230, 53, 0.15)' },
  { range: '75–100', label: 'Extreme Greed', color: '#34D399', bg: 'rgba(52, 211, 153, 0.15)' }
];

export function getFearGreedColor(val) {
  if (val == null) return '#94A3B8';
  if (val >= 75) return '#34D399';
  if (val >= 55) return '#A3E635';
  if (val >= 45) return '#94A3B8';
  if (val >= 25) return '#FB923C';
  return '#F87171';
}

export function FearGreedGauge({ value = 50, label = 'Neutral', date = '', className = '' }) {
  const R = 85;
  const cx = 130;
  const cy = 115;
  const v = Math.min(100, Math.max(0, value ?? 50));
  
  // Angle: 0 is left (-180 deg), 100 is right (0 deg)
  const angleDeg = -180 + (v / 100) * 180;
  const activeColor = getFearGreedColor(v);

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div className="relative">
        <svg width="260" height="145" viewBox="0 0 260 145" className="overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="gauge-arc-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#F87171" />
              <stop offset="30%" stopColor="#FB923C" />
              <stop offset="50%" stopColor="#94A3B8" />
              <stop offset="70%" stopColor="#A3E635" />
              <stop offset="100%" stopColor="#34D399" />
            </linearGradient>
            <filter id="gauge-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background Track */}
          <path
            d={`M 40 125 A ${R} ${R} 0 0 1 220 125`}
            fill="none"
            stroke="#1C2028"
            strokeWidth="16"
            strokeLinecap="round"
          />

          {/* Colored Gradient Track */}
          <path
            d={`M 40 125 A ${R} ${R} 0 0 1 220 125`}
            fill="none"
            stroke="url(#gauge-arc-grad)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />

          {/* Scale Tick Labels */}
          <text x="32" y="142" fontSize="10" fill="#64748B" fontFamily="monospace" textAnchor="middle">0</text>
          <text x="130" y="32" fontSize="10" fill="#64748B" fontFamily="monospace" textAnchor="middle">50</text>
          <text x="228" y="142" fontSize="10" fill="#64748B" fontFamily="monospace" textAnchor="middle">100</text>

          {/* Dynamic Needle */}
          <g transform={`translate(${cx}, ${cy}) rotate(${angleDeg})`} style={{ transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            <line x1="0" y1="0" x2={R - 10} y2="0" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
            <circle cx={R - 10} cy="0" r="4" fill={activeColor} filter="url(#gauge-glow)" />
          </g>

          {/* Center Hub */}
          <circle cx={cx} cy={cy} r="10" fill="#0E1117" stroke="#334155" strokeWidth="3" />
          <circle cx={cx} cy={cy} r="4" fill={activeColor} />
        </svg>
      </div>

      <div className="mt-2 text-center">
        <p className="num text-4xl font-extrabold tracking-tight" style={{ color: activeColor }}>
          {value ?? '—'}
        </p>
        <div
          className="mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-semibold"
          style={{
            backgroundColor: `${activeColor}15`,
            color: activeColor,
            border: `1px solid ${activeColor}30`
          }}
        >
          {label}
        </div>
        {date && <p className="mt-2 text-xs text-muted-foreground">{date}</p>}
      </div>

      {/* Sentiment Zone Scale Bar */}
      <div className="mt-6 grid w-full grid-cols-2 sm:grid-cols-5 gap-1.5 text-center text-xs">
        {ZONES.map((z) => (
          <div
            key={z.range}
            className="rounded-lg p-2 transition-colors border"
            style={{
              backgroundColor: z.label.toLowerCase() === label.toLowerCase() ? z.bg : 'transparent',
              borderColor: z.label.toLowerCase() === label.toLowerCase() ? z.color : '#1E232D',
              color: z.label.toLowerCase() === label.toLowerCase() ? z.color : '#8A93A5'
            }}
          >
            <p className="font-semibold text-xs leading-none">{z.range}</p>
            <p className="mt-1 text-[11px] truncate">{z.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default FearGreedGauge;
