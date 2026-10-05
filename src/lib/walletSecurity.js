/* Wallet safety analysis: address-poisoning detection, approval risk scoring,
 * and the honest capability matrix for this app.
 *
 * Pure functions over PUBLIC data. No keys, no signing, no network here.
 */

import { checkChecksum } from './keccak.js';
import { validateChainAddress } from './chains.js';

/* ---------------- custody policy (the single most important artifact) ---------------- */

/**
 * What CryptoX will never do, and why. These are not limitations to be worked
 * around later — they are the reason a browser-only app can be trusted with an
 * address at all.
 */
export const CUSTODY_POLICY = [
  {
    id: 'no_seed',
    title: 'We never ask for a seed phrase or private key',
    detail:
      'Not in a form, not in a URL, not "to verify". Any site that asks for your seed phrase can take every asset you own, and so can anyone who compromises that site. There is no input for it here.'
  },
  {
    id: 'no_storage',
    title: 'No key material is generated, derived or stored',
    detail:
      'A browser cannot protect a private key. localStorage is readable by any script on the origin, there is no secure element, and an XSS bug becomes total, irreversible loss. Key handling belongs in a hardware wallet or a dedicated wallet app, not here.'
  },
  {
    id: 'no_signing',
    title: 'Nothing in this app can sign or broadcast a transaction',
    detail:
      'There is no WalletConnect session, no injected provider, no WebHID transport and no keystore. Consequently send, swap, bridge and stake cannot be executed here — and that is by design, not by omission.'
  },
  {
    id: 'read_only',
    title: 'Everything is read-only and public',
    detail:
      'Address validation, EIP-55/bech32 checksum checks, gas estimates, dry-run simulation and approval analysis all operate on public chain data. Nothing here needs a secret, so nothing here can leak one.'
  },
  {
    id: 'prepare_not_execute',
    title: 'We prepare; your wallet executes',
    detail:
      'Use this page to sanity-check an address, understand a transaction and review your approvals. Then sign it in a wallet that actually protects keys — ideally a hardware wallet.'
  }
];

/* ---------------- capability matrix ---------------- */

export const CAP_STATUS = { supported: 'supported', partial: 'partial', none: 'not offered' };

/**
 * Honest status for every item in the non-custodial wallet scope.
 * 'not offered' is used where delivering the feature would require holding keys
 * or a signing transport — faking it would be worse than omitting it.
 */
export const CAPABILITIES = [
  { id: 'hd_wallet', group: 'Keys', label: 'HD wallet (BIP-32/39/44)', status: 'partial', detail: 'Derivation paths and coin types are documented per chain; no keys are generated or derived.' },
  { id: 'seed_security', group: 'Keys', label: 'Seed phrase security', status: 'none', detail: 'No seed phrase is ever requested, handled or stored. See the custody policy.' },
  { id: 'hardware_wallet', group: 'Keys', label: 'Hardware wallet support', status: 'none', detail: 'Requires a WebHID/WebUSB transport and device firmware protocol. Not implemented.' },
  { id: 'ledger_trezor', group: 'Keys', label: 'Ledger / Trezor', status: 'none', detail: 'Device integrations are not available in this build.' },
  { id: 'walletconnect', group: 'Keys', label: 'WalletConnect', status: 'none', detail: 'A signing transport. CryptoX is read-only, so no session provider ships.' },

  { id: 'evm', group: 'Chains', label: 'EVM chains', status: 'partial', detail: 'Address + EIP-55 validation, live gas, dry-run simulation, allowance reads on public RPC.' },
  { id: 'bitcoin', group: 'Chains', label: 'Bitcoin', status: 'partial', detail: 'Bech32/bech32m checksum verification and legacy format checks.' },
  { id: 'solana', group: 'Chains', label: 'Solana', status: 'partial', detail: 'Base58 format and public-key length validation.' },
  { id: 'tron', group: 'Chains', label: 'Tron', status: 'partial', detail: 'Base58 format and version-byte validation.' },
  { id: 'xrp', group: 'Chains', label: 'XRP', status: 'partial', detail: 'Base58 format and version-byte validation.' },
  { id: 'sui', group: 'Chains', label: 'Sui', status: 'partial', detail: 'Hex address normalisation and length validation.' },
  { id: 'aptos', group: 'Chains', label: 'Aptos', status: 'partial', detail: 'Hex address normalisation and length validation.' },
  { id: 'ton', group: 'Chains', label: 'TON', status: 'partial', detail: 'Friendly/raw address format validation.' },
  { id: 'cosmos', group: 'Chains', label: 'Cosmos', status: 'partial', detail: 'Bech32 checksum verification against the cosmos HRP.' },
  { id: 'polkadot', group: 'Chains', label: 'Polkadot', status: 'partial', detail: 'SS58 length and network-prefix checks.' },
  { id: 'cardano', group: 'Chains', label: 'Cardano', status: 'partial', detail: 'Shelley bech32 checksum verification.' },

  { id: 'receive', group: 'Actions', label: 'Receive', status: 'supported', detail: 'Validation, checksum verification and the correct derivation path to give your wallet.' },
  { id: 'send', group: 'Actions', label: 'Send', status: 'none', detail: 'Requires signing. Not executable here.' },
  { id: 'swap', group: 'Actions', label: 'Swap', status: 'none', detail: 'Requires signing plus a routing API. Not executable here.' },
  { id: 'bridge', group: 'Actions', label: 'Bridge', status: 'none', detail: 'Requires signing plus a bridge API. Not executable here.' },
  { id: 'stake', group: 'Actions', label: 'Stake', status: 'none', detail: 'Requires signing. Not executable here.' },

  { id: 'approvals', group: 'Safety', label: 'Token approvals', status: 'supported', detail: 'Reads live allowances and flags unlimited grants.' },
  { id: 'nfts', group: 'Safety', label: 'NFTs', status: 'partial', detail: 'ERC-721 balanceOf for a contract address you supply; no marketplace-wide index.' },
  { id: 'gas', group: 'Safety', label: 'Gas estimation', status: 'supported', detail: 'Live base fee, priority fee and legacy gas price from public RPC.' },
  { id: 'simulation', group: 'Safety', label: 'Transaction simulation', status: 'supported', detail: 'eth_call dry run: reports success/revert without broadcasting.' },
  { id: 'scam_detection', group: 'Safety', label: 'Scam detection', status: 'partial', detail: 'Offline heuristics only — address poisoning, burn addresses, unlimited approvals. No scam database.' },
  { id: 'token_risk', group: 'Safety', label: 'Token risk warnings', status: 'partial', detail: 'Structural warnings only. Honeypot/tax analysis needs a third-party scanner.' }
];

export const capabilitySummary = () => {
  const counts = { supported: 0, partial: 0, none: 0 };
  CAPABILITIES.forEach((c) => { counts[c.status] += 1; });
  return counts;
};

/* ---------------- known-risky addresses ---------------- */

// Keys MUST be lowercase: every lookup lowercases the input first, so a
// mixed-case key here would silently never match.
export const KNOWN_BURN = {
  '0x0000000000000000000000000000000000000000': 'Zero address — anything sent here is destroyed',
  '0x000000000000000000000000000000000000dead': 'Common burn address — funds are unrecoverable'
};

export const UNLIMITED_APPROVAL_THRESHOLD = 10n ** 30n;

/* ---------------- address poisoning detection ---------------- */

const normalise = (a) => String(a || '').trim().toLowerCase();

/**
 * Shared leading/trailing character counts between two addresses.
 * The "0x" prefix is stripped first: it is common to every EVM address, so
 * counting it would hand +2 free prefix credit to every pair and bias the
 * poisoning check toward false positives.
 */
export function addressSimilarity(a, b) {
  const strip = (s) => normalise(s).replace(/^0x/, '');
  const x = strip(a);
  const y = strip(b);
  if (!x || !y || x === y) return null;
  let prefix = 0;
  while (prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < x.length - prefix && suffix < y.length - prefix && x[x.length - 1 - suffix] === y[y.length - 1 - suffix]) {
    suffix += 1;
  }
  return { prefix, suffix };
}

/**
 * Address poisoning: an attacker sends dust from an address that shares a long
 * prefix AND suffix with one you actually use, hoping you copy the wrong one
 * from your history later. The middle differs, so the checksum differs too.
 */
export function detectAddressPoisoning(candidate, knownAddresses = []) {
  const hits = [];
  knownAddresses.forEach((entry) => {
    const known = typeof entry === 'string' ? { address: entry } : entry;
    if (!known?.address) return;
    const sim = addressSimilarity(candidate, known.address);
    if (!sim) return;
    const prefixLooksSame = sim.prefix >= 4;
    const suffixLooksSame = sim.suffix >= 4;
    if (prefixLooksSame && suffixLooksSame) {
      hits.push({
        matches: known.address,
        label: known.label || null,
        prefixMatch: sim.prefix,
        suffixMatch: sim.suffix,
        severity: sim.prefix >= 6 && sim.suffix >= 6 ? 'high' : 'medium',
        reason: `Shares the first ${sim.prefix} and last ${sim.suffix} characters with an address you already use, but differs in the middle.`
      });
    }
  });
  return hits.sort((a, b) => (b.prefixMatch + b.suffixMatch) - (a.prefixMatch + a.suffixMatch));
}

/**
 * Full offline risk read for one address.
 * @param address   the address to check
 * @param chainId   chain id from chains.js
 * @param known     the user's address book
 * @param isContract optional boolean from an eth_getCode probe
 */
export function assessAddressRisk(address, chainId, { known = [], isContract = null } = {}) {
  const findings = [];
  const validation = validateChainAddress(chainId, address);

  if (!validation.ok) {
    findings.push({ level: 'critical', code: 'invalid', message: validation.reason });
  } else if (validation.checksum === 'unverified') {
    findings.push({
      level: 'info',
      code: 'no-checksum',
      message: validation.note || 'This format carries no checksum we can verify, so a typo would not be caught.'
    });
  }

  const lower = normalise(address);
  if (KNOWN_BURN[lower]) {
    findings.push({ level: 'critical', code: 'burn', message: KNOWN_BURN[lower] });
  }

  const poison = detectAddressPoisoning(address, known);
  poison.forEach((p) => {
    findings.push({
      level: p.severity === 'high' ? 'high' : 'medium',
      code: 'address-poisoning',
      message: `${p.reason}${p.label ? ` (looks like "${p.label}")` : ''} Verify every character before sending.`
    });
  });

  // A vanity address is usually deliberate, so only warn when ALSO similar to a known one.
  if (isContract === true && chainId === 'evm') {
    findings.push({
      level: 'info',
      code: 'contract',
      message: 'This address is a contract, not a wallet. Tokens sent to a contract are often unrecoverable unless it implements a withdrawal.'
    });
  }
  if (isContract === false && chainId === 'evm') {
    findings.push({ level: 'info', code: 'eoa', message: 'Confirmed as a wallet (externally owned account), not a contract.' });
  }

  const worst = findings.reduce((acc, f) => {
    const rank = { critical: 4, high: 3, medium: 2, info: 1 };
    return rank[f.level] > (rank[acc] || 0) ? f.level : acc;
  }, 'clean');

  return { address, chainId, validation, findings, risk: findings.length ? worst : 'clean' };
}

/* ---------------- approval risk ---------------- */

const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Score a set of ERC-20 allowances.
 * @param approvals [{ token, symbol, spender, spenderLabel, allowance (bigint|string), decimals }]
 */
export function analyseApprovals(approvals = []) {
  const rows = (approvals || []).map((a) => {
    let allowance = null;
    try {
      allowance = typeof a.allowance === 'bigint' ? a.allowance : BigInt(a.allowance ?? 0);
    } catch {
      allowance = null;
    }
    const isMax = allowance != null && (allowance === MAX_UINT256 || allowance >= UNLIMITED_APPROVAL_THRESHOLD);
    const isZero = allowance != null && allowance === 0n;
    const spenderLower = normalise(a.spender);
    const isBurnSpender = Boolean(KNOWN_BURN[spenderLower]);

    const flags = [];
    if (isMax) flags.push({ level: 'high', code: 'unlimited', message: 'Unlimited allowance — the spender can move this token balance at any time without asking again.' });
    if (isBurnSpender) flags.push({ level: 'critical', code: 'burn-spender', message: KNOWN_BURN[spenderLower] });
    if (!a.spenderLabel) flags.push({ level: 'low', code: 'unknown-spender', message: 'Spender is not labelled in your records — check it belongs to a service you recognise.' });

    return {
      token: a.token,
      symbol: a.symbol || null,
      spender: a.spender,
      spenderLabel: a.spenderLabel || null,
      allowance: allowance == null ? null : allowance.toString(),
      unlimited: isMax,
      revoked: isZero,
      flags,
      risk: flags.some((f) => f.level === 'critical') ? 'critical'
        : flags.some((f) => f.level === 'high') ? 'high'
          : flags.length ? 'low' : 'clean'
    };
  });

  return {
    rows,
    unlimitedCount: rows.filter((r) => r.unlimited).length,
    revokedCount: rows.filter((r) => r.revoked).length,
    highRiskCount: rows.filter((r) => r.risk === 'high' || r.risk === 'critical').length,
    note: 'Only the token/spender pairs you supply are checked. Revoking requires a signed transaction in your own wallet.'
  };
}

export const MAX_UINT256_STR = MAX_UINT256.toString();
