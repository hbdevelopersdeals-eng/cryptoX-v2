import React from 'react';

/**
 * Holographic radar scanner for empty Watchlist
 */
export function EmptyWatchlistIllustration({ size = 120, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="wl-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFE066" />
          <stop offset="100%" stopColor="#FFC105" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="54" stroke="#1F242D" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="38" stroke="#1F242D" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle cx="60" cy="60" r="22" stroke="#252C37" strokeWidth="1.5" />
      
      {/* Radar sweep line */}
      <line x1="60" y1="60" x2="98" y2="28" stroke="url(#wl-gold)" strokeWidth="2" strokeLinecap="round" />
      <polygon points="60,60 98,28 106,46" fill="#FFC105" fillOpacity="0.15" />

      {/* Target Nodes */}
      <circle cx="85" cy="40" r="4" fill="#FFC105" />
      <circle cx="85" cy="40" r="8" stroke="#FFC105" strokeWidth="1" strokeOpacity="0.5" />
      <circle cx="35" cy="75" r="3" fill="#34D399" fillOpacity="0.7" />
      <circle cx="45" cy="35" r="3" fill="#60A5FA" fillOpacity="0.7" />

      {/* Center Star Hub */}
      <circle cx="60" cy="60" r="6" fill="#0D0E12" stroke="#FFE066" strokeWidth="2" />
    </svg>
  );
}

/**
 * Vault & Ledger illustration for empty Portfolio
 */
export function EmptyPortfolioIllustration({ size = 120, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="pf-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFE066" />
          <stop offset="100%" stopColor="#FFC105" />
        </linearGradient>
      </defs>
      {/* Vault Base */}
      <rect x="24" y="28" width="72" height="64" rx="14" fill="#13161C" stroke="#252A34" strokeWidth="2" />
      <rect x="34" y="38" width="52" height="44" rx="8" fill="#0D0E12" stroke="url(#pf-gold)" strokeWidth="1.5" strokeDasharray="3 3" />
      
      {/* Vault Dial */}
      <circle cx="60" cy="60" r="14" fill="#181B22" stroke="#333946" strokeWidth="2" />
      <circle cx="60" cy="60" r="6" fill="#FFC105" />
      <line x1="60" y1="48" x2="60" y2="52" stroke="#FFC105" strokeWidth="2" strokeLinecap="round" />
      <line x1="60" y1="68" x2="60" y2="72" stroke="#FFC105" strokeWidth="2" strokeLinecap="round" />
      <line x1="48" y1="60" x2="52" y2="60" stroke="#FFC105" strokeWidth="2" strokeLinecap="round" />
      <line x1="68" y1="60" x2="72" y2="60" stroke="#FFC105" strokeWidth="2" strokeLinecap="round" />

      {/* Floating Plus Accent */}
      <circle cx="86" cy="36" r="10" fill="#FFC105" />
      <path d="M86 31V41M81 36H91" stroke="#0D0E12" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Cyber Bell and Soundwaves for empty Alerts
 */
export function EmptyAlertsIllustration({ size = 120, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="alt-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFE066" />
          <stop offset="100%" stopColor="#FFC105" />
        </linearGradient>
      </defs>
      {/* Background Radiating Wave Rings */}
      <circle cx="60" cy="56" r="48" stroke="#1E232C" strokeWidth="1.5" />
      <circle cx="60" cy="56" r="36" stroke="#252A36" strokeWidth="1.5" strokeDasharray="3 3" />

      {/* Bell Body */}
      <path
        d="M60 26C48 26 42 36 42 50C42 62 36 66 36 68H84C84 66 78 62 78 50C78 36 72 26 60 26Z"
        fill="#14171E"
        stroke="url(#alt-gold)"
        strokeWidth="2.5"
      />
      {/* Bell Clapper */}
      <path d="M52 74C52 78.4 55.6 82 60 82C64.4 82 68 78.4 68 74" stroke="url(#alt-gold)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Signal Burst Dots */}
      <circle cx="26" cy="46" r="3" fill="#34D399" />
      <circle cx="94" cy="46" r="3" fill="#FFC105" />
    </svg>
  );
}

/**
 * Lost block in matrix for 404 Not Found
 */
export function NotFoundIllustration({ size = 140, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nf-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFC105" />
          <stop offset="100%" stopColor="#F87171" />
        </linearGradient>
      </defs>
      {/* Orbit Rings */}
      <ellipse cx="70" cy="70" rx="60" ry="24" stroke="#232832" strokeWidth="1.5" transform="rotate(-25 70 70)" />
      <ellipse cx="70" cy="70" rx="60" ry="24" stroke="#232832" strokeWidth="1.5" transform="rotate(35 70 70)" />

      {/* Center 404 Floating Cube */}
      <g transform="translate(35, 35)">
        <polygon points="35,5 65,22 65,52 35,69 5,52 5,22" fill="#13161D" stroke="url(#nf-grad)" strokeWidth="2" />
        <line x1="35" y1="5" x2="35" y2="37" stroke="url(#nf-grad)" strokeWidth="1.5" />
        <line x1="5" y1="22" x2="35" y2="37" stroke="url(#nf-grad)" strokeWidth="1.5" />
        <line x1="65" y1="22" x2="35" y2="37" stroke="url(#nf-grad)" strokeWidth="1.5" />
        <line x1="35" y1="37" x2="35" y2="69" stroke="url(#nf-grad)" strokeWidth="1.5" />
      </g>

      {/* Disconnected Node Dots */}
      <circle cx="20" cy="40" r="3.5" fill="#F87171" />
      <circle cx="120" cy="50" r="4" fill="#FFC105" />
      <circle cx="105" cy="110" r="3" fill="#60A5FA" />
      <circle cx="35" cy="115" r="2.5" fill="#34D399" />
    </svg>
  );
}
