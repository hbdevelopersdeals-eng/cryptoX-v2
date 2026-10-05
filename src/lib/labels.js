/* Curated address labels.
 *
 * Every address in this registry was VERIFIED against on-chain evidence before
 * being added: each one has contract code, and where it is a token the symbol
 * returned BY THE CONTRACT matches the label here (USDC, USDT, DAI, WETH,
 * BAYC, and CryptoPunks' stylised "Ͼ").
 *
 * This is a small curated set, not an explorer's label database. Labels are a
 * convenience, never proof — a wrong label is worse than no label, so nothing
 * is added here without on-chain confirmation.
 */

const lc = (a) => a.toLowerCase();

/** key: lowercase address → { label, kind, symbol } */
const REGISTRY = {};

function add(address, label, kind, symbol = null) {
  REGISTRY[lc(address)] = { address, label, kind, symbol };
}

/* --- Ethereum mainnet, all verified on-chain --- */
add('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USD Coin (USDC)', 'token', 'USDC');
add('0xdAC17F958D2ee523a2206206994597C13D831ec7', 'Tether USD (USDT)', 'token', 'USDT');
add('0x6B175474E89094C44Da98b954EedeAC495271d0F', 'Dai Stablecoin (DAI)', 'token', 'DAI');
add('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'Wrapped Ether (WETH)', 'token', 'WETH');
add('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', 'Uniswap V2 Router', 'router');
add('0xE592427A0AEce92De3Edee1F18E0157C05861564', 'Uniswap V3 SwapRouter', 'router');
add('0xcA11bde05977b3631167028862bE2a173976CA11', 'Multicall3', 'utility');
add('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', 'Bored Ape Yacht Club', 'nft', 'BAYC');
add('0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB', 'CryptoPunks', 'nft', 'Ͼ');

/* --- Non-addressable special cases --- */
export const SPECIAL = {
  '0x0000000000000000000000000000000000000000': { label: 'Zero address', kind: 'burn' },
  '0x000000000000000000000000000000000000dead': { label: 'Burn address (0x…dEaD)', kind: 'burn' }
};

/** Look up a curated label. Returns null when unknown. */
export function lookupLabel(address) {
  const key = lc(String(address || ''));
  return REGISTRY[key] || SPECIAL[key] || null;
}

/** Merge the curated registry with the user's own address book. */
export function resolveLabel(address, addressBook = []) {
  const curated = lookupLabel(address);
  const own = (addressBook || []).find((b) => lc(b.address) === lc(address));
  if (own) {
    return { address, label: own.label || 'Your saved address', kind: 'own', source: 'address book', curated: curated?.label || null };
  }
  if (curated) {
    return { address, label: curated.label, kind: curated.kind, source: 'curated registry', symbol: curated.symbol || null };
  }
  return { address, label: null, kind: 'unknown', source: null };
}

/** All curated token symbols, for impersonation checks. */
export const KNOWN_SYMBOLS = Object.values(REGISTRY)
  .filter((r) => r.symbol)
  .reduce((acc, r) => {
    const key = r.symbol.toUpperCase();
    (acc[key] = acc[key] || []).push(r.address);
    return acc;
  }, {});

/**
 * Impersonation check: a contract whose on-chain symbol matches a well-known
 * token but whose address is NOT that token's address is a classic fake-token
 * pattern (a copy of USDC deployed at an attacker's address).
 */
export function checkSymbolImpersonation(address, onChainSymbol) {
  if (!onChainSymbol) return null;
  const key = String(onChainSymbol).toUpperCase();
  const real = KNOWN_SYMBOLS[key];
  if (!real) return null;
  if (real.some((a) => lc(a) === lc(address))) return null;
  return {
    level: 'high',
    code: 'symbol-impersonation',
    message: `This contract reports the symbol "${onChainSymbol}", but the genuine ${onChainSymbol} is deployed at ${real[0]}. A matching symbol on a different address is a common fake-token pattern.`
  };
}

export const LABEL_KINDS = {
  token: { label: 'Token', cls: 'bg-primary/15 text-primary' },
  nft: { label: 'NFT', cls: 'bg-primary/15 text-primary' },
  router: { label: 'DEX router', cls: 'bg-up/15 text-up' },
  utility: { label: 'Utility', cls: 'bg-muted text-muted-foreground' },
  burn: { label: 'Burn', cls: 'bg-down/15 text-down' },
  own: { label: 'Yours', cls: 'bg-up/15 text-up' },
  unknown: { label: 'Unlabelled', cls: 'bg-muted text-muted-foreground' }
};

export const CURATED_COUNT = Object.keys(REGISTRY).length;
