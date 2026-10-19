// Curated coin universe: CoinGecko id, Binance symbol, fallback prices.
// Coin images come from the CoinGecko CDN as part of live market data.
//
// Stored as tuples rather than objects on purpose. Thirty rows of
// `{ id: ..., sym: ..., name: ... }` repeat seven key names thirty times, and
// this module sits in the entry chunk — the repeated keys cost more than the
// data. The tuple order is fixed by COIN_FIELDS below.

const COIN_FIELDS = ['id', 'sym', 'name', 'binance', 'cg', 'color', 'base'];

const RAW = [
  ['bitcoin', 'BTC', 'Bitcoin', 'BTCUSDT', 1, '#F7931A', 58700],
  ['ethereum', 'ETH', 'Ethereum', 'ETHUSDT', 279, '#627EEA', 2470],
  ['tether', 'USDT', 'Tether', 'USDTUSDT', 825, '#26A17B', 1],
  ['binancecoin', 'BNB', 'BNB', 'BNBUSDT', 1839, '#F3BA2F', 556],
  ['solana', 'SOL', 'Solana', 'SOLUSDT', 5426, '#9945FF', 142],
  ['ripple', 'XRP', 'XRP', 'XRPUSDT', 44, '#23292F', 0.58],
  ['usd-coin', 'USDC', 'USDC', 'USDCUSDT', 6319, '#2775CA', 1],
  ['cardano', 'ADA', 'Cardano', 'ADAUSDT', 2010, '#0033AD', 0.42],
  ['dogecoin', 'DOGE', 'Dogecoin', 'DOGEUSDT', 5, '#C2A633', 0.11],
  ['litecoin', 'LTC', 'Litecoin', 'LTCUSDT', 2, '#345D9D', 78],
  ['polkadot', 'DOT', 'Polkadot', 'DOTUSDT', 12171, '#E6007A', 6.2],
  ['avalanche-2', 'AVAX', 'Avalanche', 'AVAXUSDT', 12559, '#E84142', 25],
  ['chainlink', 'LINK', 'Chainlink', 'LINKUSDT', 8775, '#2A5ADA', 13.5],
  ['matic-network', 'POL', 'Polygon', 'POLUSDT', 4713, '#8247E5', 0.55],
  ['uniswap', 'UNI', 'Uniswap', 'UNIUSDT', 12504, '#FF007A', 8.1],
  ['near', 'NEAR', 'NEAR Protocol', 'NEARUSDT', 10365, '#00EC97', 4.9],
  ['sui', 'SUI', 'Sui', 'SUIUSDT', 20947, '#4DA2FF', 0.95],
  ['aptos', 'APT', 'Aptos', 'APTUSDT', 26415, '#fff', 7.4],
  ['pepe', 'PEPE', 'Pepe', '1000PEPEUSDT', 29850, '#2E9E58', 0.0000084],
  ['render-token', 'RNDR', 'Render', 'RNDRUSDT', 11636, '#8A2BE2', 6.6],
  ['internet-computer', 'ICP', 'Internet Computer', 'ICPUSDT', 14495, '#2A6AE1', 10.4],
  ['arbitrum', 'ARB', 'Arbitrum', 'ARBUSDT', 28176, '#12AAFF', 0.82],
  ['optimism', 'OP', 'Optimism', 'OPUSDT', 12532, '#FF0420', 1.75],
  ['cosmos', 'ATOM', 'Cosmos Hub', 'ATOMUSDT', 3794, '#2E3148', 6.9],
  ['stellar', 'XLM', 'Stellar', 'XLMUSDT', 512, '#3E6DB5', 0.095],
  ['the-open-network', 'TON', 'Toncoin', 'TONUSDT', 11419, '#0098EA', 6.4],
  ['filecoin', 'FIL', 'Filecoin', 'FILUSDT', 12817, '#0090FF', 4.5],
  ['injective-protocol', 'INJ', 'Injective', 'INJUSDT', 11829, '#00E1FF', 21.5],
  ['trons-usd', 'TRX', 'TRON', 'TRXUSDT', 1958, '#FF060A', 0.155],
  ['monero', 'XMR', 'Monero', 'XMRUSDT', 328, '#FF6600', 152]
];

export const COINS = RAW.map((row) =>
  Object.fromEntries(COIN_FIELDS.map((field, i) => [field, row[i]]))
);

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
