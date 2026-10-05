/* Canonical asset registry + symbol mapping.
 *
 * One internal identity per asset (assetId), with the native symbol each venue
 * uses. This is the layer that stops "BTC" / "XBT" / "BTCUSDT" / "BTC-USD" from
 * being treated as different things.
 *
 * Venues here are the ones whose PUBLIC market-data endpoints are usable from a
 * browser. Licensed/institutional feeds (CMC enterprise, CME, proprietary
 * CryptoX) are intentionally absent — they need commercial agreements.
 */

/* convention explains how a venue builds a pair symbol for a coin:
 *   explicit    — stored per asset in asset.venues[venueId]
 *   suffix      — BTCUSDT
 *   underscore  — BTC_USDT
 *   dash        — BTC-USDT
 *   gemini      — BTCUSD
 *   bitfinex    — tBTCUSD
 *   index       — btc_usd (derivative index, not a spot pair)
 *   token       — on-chain token address (DEX)
 */
export const VENUES = [
  { id: 'binance', name: 'Binance', kind: 'cex', tier: 1, convention: 'explicit' },
  { id: 'coinbase', name: 'Coinbase', kind: 'cex', tier: 1, convention: 'explicit' },
  { id: 'kraken', name: 'Kraken', kind: 'cex', tier: 1, convention: 'explicit' },
  { id: 'okx', name: 'OKX', kind: 'cex', tier: 1, convention: 'explicit' },
  { id: 'bybit', name: 'Bybit', kind: 'cex', tier: 2, convention: 'explicit' },
  { id: 'kucoin', name: 'KuCoin', kind: 'cex', tier: 2, convention: 'explicit' },
  { id: 'bitget', name: 'Bitget', kind: 'cex', tier: 2, convention: 'suffix' },
  { id: 'gate', name: 'Gate', kind: 'cex', tier: 2, convention: 'underscore' },
  { id: 'mexc', name: 'MEXC', kind: 'cex', tier: 2, convention: 'suffix' },
  { id: 'htx', name: 'HTX', kind: 'cex', tier: 2, convention: 'suffix' },
  { id: 'cryptocom', name: 'Crypto.com', kind: 'cex', tier: 2, convention: 'underscore' },
  { id: 'gemini', name: 'Gemini', kind: 'cex', tier: 2, convention: 'gemini' },
  { id: 'bitfinex', name: 'Bitfinex', kind: 'cex', tier: 2, convention: 'bitfinex' },
  { id: 'deribit', name: 'Deribit', kind: 'derivatives', tier: 1, convention: 'index' },
  { id: 'dexscreener', name: 'DEX (DexScreener)', kind: 'dex', tier: 2, convention: 'token' }
];

/* Chain identifiers used by the on-chain layer. */
export const CHAINS = {
  ethereum: { id: 1, name: 'Ethereum' },
  arbitrum: { id: 42161, name: 'Arbitrum One' },
  optimism: { id: 10, name: 'OP Mainnet' },
  bsc: { id: 56, name: 'BNB Chain' },
  polygon: { id: 137, name: 'Polygon' }
};

const TOKEN_CHAIN = { uniswap: 'ethereum', arbitrum: 'arbitrum', optimism: 'optimism' };

/** Native symbol a venue uses for an asset, honouring the venue convention. */
export function venueSymbolFor(asset, venueId) {
  if (!asset) return null;
  const explicit = asset.venues?.[venueId];
  if (explicit) return explicit;
  const venue = VENUES.find((v) => v.id === venueId);
  if (!venue) return null;
  const s = asset.symbol;
  switch (venue.convention) {
    case 'suffix': return `${s}USDT`;
    case 'underscore': return `${s}_USDT`;
    case 'dash': return `${s}-USDT`;
    case 'gemini': return `${s}USD`;
    case 'bitfinex': return `t${s}USD`;
    case 'index': return `${s.toLowerCase()}_usd`;
    case 'token': return asset.contract || null;
    default: return null;
  }
}

export function chainForAsset(assetId) {
  const chainKey = TOKEN_CHAIN[assetId];
  return chainKey ? { key: chainKey, ...CHAINS[chainKey] } : null;
}

/**
 * Native (non-EVM) chains, kept separate from CHAINS because they have no EVM
 * chain id. Used for portfolio chain allocation; EVM assets keep using
 * `chainForAsset` so existing callers are unaffected.
 */
export const NATIVE_CHAINS = {
  bitcoin: { name: 'Bitcoin' },
  'bitcoin-cash': { name: 'Bitcoin Cash' },
  litecoin: { name: 'Litecoin' },
  solana: { name: 'Solana' },
  ripple: { name: 'XRP Ledger' },
  cardano: { name: 'Cardano' },
  dogecoin: { name: 'Dogecoin' },
  avalanche: { name: 'Avalanche' },
  polkadot: { name: 'Polkadot' },
  tron: { name: 'TRON' },
  near: { name: 'NEAR' },
  aptos: { name: 'Aptos' },
  cosmos: { name: 'Cosmos Hub' },
  stellar: { name: 'Stellar' },
  filecoin: { name: 'Filecoin' }
};

const NATIVE_CHAIN = {
  bitcoin: 'bitcoin',
  'bitcoin-cash': 'bitcoin-cash',
  litecoin: 'litecoin',
  solana: 'solana',
  ripple: 'ripple',
  cardano: 'cardano',
  dogecoin: 'dogecoin',
  'avalanche-2': 'avalanche',
  polkadot: 'polkadot',
  chainlink: 'ethereum',   // ERC-20
  tron: 'tron',
  uniswap: 'ethereum',     // ERC-20
  near: 'near',
  aptos: 'aptos',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  cosmos: 'cosmos',
  stellar: 'stellar',
  filecoin: 'filecoin'
};

export function nativeChainForAsset(assetId) {
  const key = NATIVE_CHAIN[assetId];
  return key ? { key, ...(NATIVE_CHAINS[key] || { name: key }) } : null;
}

/** Display label for the chain an asset lives on; 'Other' when unknown. */
export function chainLabelForAsset(assetId) {
  const c = chainForAsset(assetId) || nativeChainForAsset(assetId);
  return c?.name || 'Other';
}

export const VENUE_IDS = VENUES.map((v) => v.id);

export const ASSETS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', cg: 'bitcoin', contract: null, venues: { binance: 'BTCUSDT', coinbase: 'BTC-USD', kraken: 'XBT/USD', okx: 'BTC-USDT', bybit: 'BTCUSDT', kucoin: 'BTC-USDT' } },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', cg: 'ethereum', contract: null, venues: { binance: 'ETHUSDT', coinbase: 'ETH-USD', kraken: 'ETH/USD', okx: 'ETH-USDT', bybit: 'ETHUSDT', kucoin: 'ETH-USDT' } },
  { id: 'solana', symbol: 'SOL', name: 'Solana', cg: 'solana', contract: null, venues: { binance: 'SOLUSDT', coinbase: 'SOL-USD', kraken: 'SOL/USD', okx: 'SOL-USDT', bybit: 'SOLUSDT', kucoin: 'SOL-USDT' } },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', cg: 'ripple', contract: null, venues: { binance: 'XRPUSDT', coinbase: 'XRP-USD', kraken: 'XRP/USD', okx: 'XRP-USDT', bybit: 'XRPUSDT', kucoin: 'XRP-USDT' } },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', cg: 'cardano', contract: null, venues: { binance: 'ADAUSDT', coinbase: 'ADA-USD', kraken: 'ADA/USD', okx: 'ADA-USDT', bybit: 'ADAUSDT', kucoin: 'ADA-USDT' } },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', cg: 'dogecoin', contract: null, venues: { binance: 'DOGEUSDT', coinbase: 'DOGE-USD', kraken: 'DOGE/USD', okx: 'DOGE-USDT', bybit: 'DOGEUSDT', kucoin: 'DOGE-USDT' } },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', cg: 'avalanche-2', contract: null, venues: { binance: 'AVAXUSDT', coinbase: 'AVAX-USD', kraken: 'AVAX/USD', okx: 'AVAX-USDT', bybit: 'AVAXUSDT', kucoin: 'AVAX-USDT' } },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', cg: 'polkadot', contract: null, venues: { binance: 'DOTUSDT', coinbase: 'DOT-USD', kraken: 'DOT/USD', okx: 'DOT-USDT', bybit: 'DOTUSDT', kucoin: 'DOT-USDT' } },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', cg: 'chainlink', contract: null, venues: { binance: 'LINKUSDT', coinbase: 'LINK-USD', kraken: 'LINK/USD', okx: 'LINK-USDT', bybit: 'LINKUSDT', kucoin: 'LINK-USDT' } },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin', cg: 'litecoin', contract: null, venues: { binance: 'LTCUSDT', coinbase: 'LTC-USD', kraken: 'LTC/USD', okx: 'LTC-USDT', bybit: 'LTCUSDT', kucoin: 'LTC-USDT' } },
  { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash', cg: 'bitcoin-cash', contract: null, venues: { binance: 'BCHUSDT', coinbase: 'BCH-USD', kraken: 'BCH/USD', okx: 'BCH-USDT', bybit: 'BCHUSDT', kucoin: 'BCH-USDT' } },
  { id: 'tron', symbol: 'TRX', name: 'TRON', cg: 'tron', contract: null, venues: { binance: 'TRXUSDT', coinbase: 'TRX-USD', kraken: 'TRX/USD', okx: 'TRX-USDT', bybit: 'TRXUSDT', kucoin: 'TRX-USDT' } },
  { id: 'uniswap', symbol: 'UNI', name: 'Uniswap', cg: 'uniswap', contract: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', venues: { binance: 'UNIUSDT', coinbase: 'UNI-USD', kraken: 'UNI/USD', okx: 'UNI-USDT', bybit: 'UNIUSDT', kucoin: 'UNI-USDT' } },
  { id: 'near', symbol: 'NEAR', name: 'NEAR Protocol', cg: 'near', contract: null, venues: { binance: 'NEARUSDT', coinbase: 'NEAR-USD', kraken: 'NEAR/USD', okx: 'NEAR-USDT', bybit: 'NEARUSDT', kucoin: 'NEAR-USDT' } },
  { id: 'aptos', symbol: 'APT', name: 'Aptos', cg: 'aptos', contract: null, venues: { binance: 'APTUSDT', coinbase: 'APT-USD', kraken: 'APT/USD', okx: 'APT-USDT', bybit: 'APTUSDT', kucoin: 'APT-USDT' } },
  { id: 'arbitrum', symbol: 'ARB', name: 'Arbitrum', cg: 'arbitrum', contract: '0x912CE59144191C1204E64559FE8253a0e49E6548', venues: { binance: 'ARBUSDT', coinbase: 'ARB-USD', kraken: 'ARB/USD', okx: 'ARB-USDT', bybit: 'ARBUSDT', kucoin: 'ARB-USDT' } },
  { id: 'optimism', symbol: 'OP', name: 'Optimism', cg: 'optimism', contract: '0x4200000000000000000000000000000000000042', venues: { binance: 'OPUSDT', coinbase: 'OP-USD', kraken: 'OP/USD', okx: 'OP-USDT', bybit: 'OPUSDT', kucoin: 'OP-USDT' } },
  { id: 'cosmos', symbol: 'ATOM', name: 'Cosmos Hub', cg: 'cosmos', contract: null, venues: { binance: 'ATOMUSDT', coinbase: 'ATOM-USD', kraken: 'ATOM/USD', okx: 'ATOM-USDT', bybit: 'ATOMUSDT', kucoin: 'ATOM-USDT' } },
  { id: 'stellar', symbol: 'XLM', name: 'Stellar', cg: 'stellar', contract: null, venues: { binance: 'XLMUSDT', coinbase: 'XLM-USD', kraken: 'XLM/USD', okx: 'XLM-USDT', bybit: 'XLMUSDT', kucoin: 'XLM-USDT' } },
  { id: 'filecoin', symbol: 'FIL', name: 'Filecoin', cg: 'filecoin', contract: null, venues: { binance: 'FILUSDT', coinbase: 'FIL-USD', kraken: 'FIL/USD', okx: 'FIL-USDT', bybit: 'FILUSDT', kucoin: 'FIL-USDT' } }
];

const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));
const BY_SYMBOL = new Map(ASSETS.map((a) => [a.symbol.toUpperCase(), a]));

export const assetById = (id) => BY_ID.get(id) || null;
export const assetBySymbol = (sym) => BY_SYMBOL.get(String(sym || '').toUpperCase()) || null;
export const venueById = (id) => VENUES.find((v) => v.id === id) || null;
export const venueSymbol = (assetId, venueId) => {
  const asset = assetById(assetId);
  return asset ? venueSymbolFor(asset, venueId) : null;
};

/** All [venue, nativeSymbol] pairs for one asset (skips venues that don't list it). */
export function pairsForAsset(assetId) {
  const asset = assetById(assetId);
  if (!asset) return [];
  return VENUE_IDS.map((v) => [v, venueSymbolFor(asset, v)]).filter(([, sym]) => Boolean(sym));
}

/** Reverse lookup: (venue, native symbol) -> canonical assetId. */
export function assetIdFromVenueSymbol(venueId, nativeSymbol) {
  if (!venueId || !nativeSymbol) return null;
  for (const asset of ASSETS) {
    if (asset.venues?.[venueId] === nativeSymbol) return asset.id;
    if (venueSymbolFor(asset, venueId) === nativeSymbol) return asset.id;
  }
  return null;
}

export function coverageMatrix() {
  return ASSETS.map((asset) => ({
    assetId: asset.id,
    symbol: asset.symbol,
    chain: chainForAsset(asset.id),
    venues: VENUE_IDS.filter((v) => Boolean(venueSymbolFor(asset, v))),
    symbols: Object.fromEntries(VENUE_IDS.map((v) => [v, venueSymbolFor(asset, v)]))
  }));
}
