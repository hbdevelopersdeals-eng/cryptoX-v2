import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Modern Cyber-Crypto Vector Emblem for CryptoX
 */
export function BrandMark({ size = 32, className = '' }) {
  const s = typeof size === 'number' ? `${size}px` : size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 transition-transform duration-300 group-hover:scale-105 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cx-gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFE066" />
          <stop offset="50%" stopColor="#FFC105" />
          <stop offset="100%" stopColor="#E59400" />
        </linearGradient>
        <linearGradient id="cx-dark-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1C1F26" />
          <stop offset="100%" stopColor="#0B0C0E" />
        </linearGradient>
        <filter id="cx-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Hex-Shield Rounded Frame */}
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="16"
        fill="url(#cx-dark-grad)"
        stroke="url(#cx-gold-grad)"
        strokeWidth="1.75"
        strokeOpacity="0.8"
      />

      {/* Inner Subtle Circuit Accents */}
      <circle cx="32" cy="32" r="23" stroke="#232832" strokeWidth="1" strokeDasharray="3 3" />
      
      {/* Outer Glow Halo behind the X */}
      <path
        d="M20 18L44 46M44 18L20 46"
        stroke="#FFC105"
        strokeWidth="6"
        strokeLinecap="round"
        strokeOpacity="0.15"
      />

      {/* Main Dynamic Candlestick-Cut 'X' */}
      <path
        d="M19 18L45 46"
        stroke="url(#cx-gold-grad)"
        strokeWidth="4.5"
        strokeLinecap="round"
        filter="url(#cx-glow)"
      />
      <path
        d="M45 18L19 46"
        stroke="url(#cx-gold-grad)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      {/* Center Quantum Pulse Core */}
      <circle cx="32" cy="32" r="4.5" fill="#09090C" stroke="#FFE066" strokeWidth="2" />
      <circle cx="32" cy="32" r="2" fill="#FFC105" />

      {/* Modern Terminal Tick Marks */}
      <rect x="29" y="8" width="6" height="2" rx="1" fill="#FFC105" fillOpacity="0.7" />
      <rect x="29" y="54" width="6" height="2" rx="1" fill="#FFC105" fillOpacity="0.7" />
      <rect x="8" y="29" width="2" height="6" rx="1" fill="#FFC105" fillOpacity="0.4" />
      <rect x="54" y="29" width="2" height="6" rx="1" fill="#FFC105" fillOpacity="0.4" />
    </svg>
  );
}

/**
 * Full Brand Logo (Icon + Wordmark)
 */
export function BrandLogo({
  size = 'md',
  showText = true,
  to,
  className = '',
  onClick
}) {
  const sizes = {
    sm: { icon: 26, text: 'text-base', gap: 'gap-2', badge: 'text-xs px-1.5 py-0.5' },
    md: { icon: 34, text: 'text-lg', gap: 'gap-2.5', badge: 'text-xs px-1.5 py-0.5' },
    lg: { icon: 44, text: 'text-2xl', gap: 'gap-3', badge: 'text-xs px-2 py-0.5' }
  };

  const cfg = sizes[size] || sizes.md;

  const content = (
    <div className={`group inline-flex items-center ${cfg.gap} select-none ${className}`}>
      <BrandMark size={cfg.icon} />
      {showText && (
        <div className="flex items-center gap-1.5 leading-none">
          <span className={`font-bold tracking-tight text-foreground transition-colors group-hover:text-white ${cfg.text}`}>
            Crypto<span className="text-primary font-extrabold drop-shadow-[0_0_8px_rgba(255,193,5,0.4)]">X</span>
          </span>
          <span className={`rounded font-mono font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20 ${cfg.badge}`}>
            Terminal
          </span>
        </div>
      )}
    </div>
  );

  if (to) {
    return (
      <Link
        to={to}
        onClick={onClick}
        className="inline-flex items-center no-underline rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="CryptoX Home"
      >
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center text-left bg-transparent border-0 p-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="CryptoX Home"
      >
        {content}
      </button>
    );
  }

  return content;
}

export default BrandLogo;
