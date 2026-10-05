/* European option pricing: Black-Scholes price, Greeks and implied volatility.
 * Pure math — unit tested. Pricing only: no real options venue is connected. */

export function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Abramowitz & Stegun approximation of the standard normal CDF. */
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const approx = 1 - normPdf(Math.abs(x)) * poly;
  return x >= 0 ? approx : 1 - approx;
}

const d1d2 = ({ S, K, T, r, sigma }) => {
  const vol = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / vol;
  return { d1, d2: d1 - vol };
};

export function bsPrice({ type = 'call', S, K, T, r = 0, sigma }) {
  if (!Number.isFinite(S) || !Number.isFinite(K) || !Number.isFinite(T) || !Number.isFinite(sigma)) return null;
  if (T <= 0) return Math.max(0, type === 'call' ? S - K : K - S);
  if (sigma <= 0) return Math.max(0, type === 'call' ? S - K * Math.exp(-r * T) : K * Math.exp(-r * T) - S);
  const { d1, d2 } = d1d2({ S, K, T, r, sigma });
  if (type === 'call') return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

export function bsGreeks({ type = 'call', S, K, T, r = 0, sigma }) {
  if (!(T > 0) || !(sigma > 0)) {
    return { delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, vega: 0, theta: 0, rho: 0 };
  }
  const { d1, d2 } = d1d2({ S, K, T, r, sigma });
  const pdf = normPdf(d1);
  const delta = type === 'call' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sigma * Math.sqrt(T));
  const vega = (S * pdf * Math.sqrt(T)) / 100; // per 1% vol
  const theta =
    (-(S * pdf * sigma) / (2 * Math.sqrt(T)) -
      (type === 'call' ? 1 : -1) * r * K * Math.exp(-r * T) * normCdf(type === 'call' ? d2 : -d2)) / 365;
  const rho = ((type === 'call' ? 1 : -1) * K * T * Math.exp(-r * T) * normCdf(type === 'call' ? d2 : -d2)) / 100;
  return { delta, gamma, vega, theta, rho };
}

/** Implied volatility via Newton-Raphson with a bisection fallback. */
export function impliedVol({ type = 'call', S, K, T, r = 0, price, tolerance = 1e-6, maxIter = 80 }) {
  if (!(T > 0) || !(S > 0) || !(price > 0)) return null;
  const intrinsic = Math.max(0, type === 'call' ? S - K : K - S);
  if (price < intrinsic) return null;
  let sigma = 0.6;
  for (let i = 0; i < maxIter; i++) {
    const diff = bsPrice({ type, S, K, T, r, sigma }) - price;
    if (Math.abs(diff) < tolerance) return sigma;
    const { vega } = bsGreeks({ type, S, K, T, r, sigma });
    const v = vega * 100; // d(price)/d(sigma)
    if (!(Math.abs(v) > 1e-8)) break;
    sigma -= diff / v;
    if (!(sigma > 0) || sigma > 5) { sigma = Math.min(5, Math.max(0.001, sigma)); break; }
  }
  // Bisection safety net
  let lo = 0.001;
  let hi = 5;
  const priceAt = (s) => bsPrice({ type, S, K, T, r, sigma: s });
  if (priceAt(lo) > price || priceAt(hi) < price) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(priceAt(mid) - price) < tolerance) return mid;
    if (priceAt(mid) < price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const optionPayoff = ({ type = 'call', S, K }) => Math.max(0, type === 'call' ? S - K : K - S);

/** Days -> year fraction used across the UI. */
export const yearsFromDays = (days) => Math.max(0, days) / 365;
