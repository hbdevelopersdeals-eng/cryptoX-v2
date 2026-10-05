// Curated coin universe: CoinGecko id + image, Binance symbol, fallback prices.
// Coin images come from the CoinGecko CDN as part of live market data.

export const COINS = [
  { id: 'bitcoin', sym: 'BTC', name: 'Bitcoin', binance: 'BTCUSDT', cg: 1, color: '#F7931A', base: 58700 },
  { id: 'ethereum', sym: 'ETH', name: 'Ethereum', binance: 'ETHUSDT', cg: 279, color: '#627EEA', base: 2470 },
  { id: 'tether', sym: 'USDT', name: 'Tether', binance: 'USDTUSDT', cg: 825, color: '#26A17B', base: 1 },
  { id: 'binancecoin', sym: 'BNB', name: 'BNB', binance: 'BNBUSDT', cg: 1839, color: '#F3BA2F', base: 556 },
  { id: 'solana', sym: 'SOL', name: 'Solana', binance: 'SOLUSDT', cg: 5426, color: '#9945FF', base: 142 },
  { id: 'ripple', sym: 'XRP', name: 'XRP', binance: 'XRPUSDT', cg: 44, color: '#23292F', base: 0.58 },
  { id: 'usd-coin', sym: 'USDC', name: 'USDC', binance: 'USDCUSDT', cg: 6319, color: '#2775CA', base: 1 },
  { id: 'cardano', sym: 'ADA', name: 'Cardano', binance: 'ADAUSDT', cg: 2010, color: '#0033AD', base: 0.42 },
  { id: 'dogecoin', sym: 'DOGE', name: 'Dogecoin', binance: 'DOGEUSDT', cg: 5, color: '#C2A633', base: 0.11 },
  { id: 'litecoin', sym: 'LTC', name: 'Litecoin', binance: 'LTCUSDT', cg: 2, color: '#345D9D', base: 78 },
  { id: 'polkadot', sym: 'DOT', name: 'Polkadot', binance: 'DOTUSDT', cg: 12171, color: '#E6007A', base: 6.2 },
  { id: 'avalanche-2', sym: 'AVAX', name: 'Avalanche', binance: 'AVAXUSDT', cg: 12559, color: '#E84142', base: 25 },
  { id: 'chainlink', sym: 'LINK', name: 'Chainlink', binance: 'LINKUSDT', cg: 8775, color: '#2A5ADA', base: 13.5 },
  { id: 'matic-network', sym: 'POL', name: 'Polygon', binance: 'POLUSDT', cg: 4713, color: '#8247E5', base: 0.55 },
  { id: 'uniswap', sym: 'UNI', name: 'Uniswap', binance: 'UNIUSDT', cg: 12504, color: '#FF007A', base: 8.1 },
  { id: 'near', sym: 'NEAR', name: 'NEAR Protocol', binance: 'NEARUSDT', cg: 10365, color: '#00EC97', base: 4.9 },
  { id: 'sui', sym: 'SUI', name: 'Sui', binance: 'SUIUSDT', cg: 20947, color: '#4DA2FF', base: 0.95 },
  { id: 'aptos', sym: 'APT', name: 'Aptos', binance: 'APTUSDT', cg: 26415, color: '#fff', base: 7.4 },
  { id: 'pepe', sym: 'PEPE', name: 'Pepe', binance: '1000PEPEUSDT', cg: 29850, color: '#2E9E58', base: 0.0000084 },
  { id: 'render-token', sym: 'RNDR', name: 'Render', binance: 'RNDRUSDT', cg: 11636, color: '#8A2BE2', base: 6.6 },
  { id: 'internet-computer', sym: 'ICP', name: 'Internet Computer', binance: 'ICPUSDT', cg: 14495, color: '#2A6AE1', base: 10.4 },
  { id: 'arbitrum', sym: 'ARB', name: 'Arbitrum', binance: 'ARBUSDT', cg: 28176, color: '#12AAFF', base: 0.82 },
  { id: 'optimism', sym: 'OP', name: 'Optimism', binance: 'OPUSDT', cg: 12532, color: '#FF0420', base: 1.75 },
  { id: 'cosmos', sym: 'ATOM', name: 'Cosmos Hub', binance: 'ATOMUSDT', cg: 3794, color: '#2E3148', base: 6.9 },
  { id: 'stellar', sym: 'XLM', name: 'Stellar', binance: 'XLMUSDT', cg: 512, color: '#3E6DB5', base: 0.095 },
  { id: 'the-open-network', sym: 'TON', name: 'Toncoin', binance: 'TONUSDT', cg: 11419, color: '#0098EA', base: 6.4 },
  { id: 'filecoin', sym: 'FIL', name: 'Filecoin', binance: 'FILUSDT', cg: 12817, color: '#0090FF', base: 4.5 },
  { id: 'injective-protocol', sym: 'INJ', name: 'Injective', binance: 'INJUSDT', cg: 11829, color: '#00E1FF', base: 21.5 },
  { id: 'trons-usd', sym: 'TRX', name: 'TRON', binance: 'TRXUSDT', cg: 1958, color: '#FF060A', base: 0.155 },
  { id: 'monero', sym: 'XMR', name: 'Monero', binance: 'XMRUSDT', cg: 328, color: '#FF6600', base: 152 }
];

export const binanceMap = Object.fromEntries(
  COINS.filter((c) => c.binance).map((c) => [c.binance, c])
);

export function cgImg(id) {
  // CoinGecko CDN image, served as part of the CoinGecko data feed.
  return `https://assets.coingecko.com/coins/images/${cgImageIds[id] ?? 1}/small/${id}.png`;
}

// Small subset map (fallback only; live feed provides the real image URLs too).
const cgImageIds = {
  bitcoin: 1, ethereum: 279, tether: 325, binancecoin: 825, solana: 4128,
  ripple: 44, 'usd-coin': 6319, cardano: 975, dogecoin: 5, litecoin: 2,
  polkadot: 12171, 'avalanche-2': 12559, chainlink: 8775, 'matic-network': 4713,
  uniswap: 12504, near: 10365, sui: 20947, aptos: 26415, pepe: 29850,
  'render-token': 11636, 'internet-computer': 14495, arbitrum: 28176,
  optimism: 12532, cosmos: 3794, stellar: 512, 'the-open-network': 11419,
  filecoin: 12817, 'injective-protocol': 11829, 'trons-usd': 1958, monero: 328
};

export const FALLBACK_SPARK = [
  1.0, 0.992, 0.985, 0.99, 1.004, 0.996, 1.002, 1.01, 1.006, 1.012, 1.008, 1.014,
  1.02, 1.016, 1.024, 1.018, 1.011, 1.017, 1.026, 1.032, 1.028, 1.036, 1.041, 1.045
];
