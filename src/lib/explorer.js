/* Blockchain explorer data layer.
 *
 * Two public, keyless backends:
 *   - Bitcoin  → Blockstream Esplora (blocks, txs, addresses, mempool, fees)
 *   - EVM      → public JSON-RPC (blocks, txs, receipts, logs, code, calls)
 *   - Ethereum → public beacon API (validators)
 *   - Solana   → public JSON-RPC (vote accounts = validators + stake)
 *
 * Everything is read-only. Where a capability genuinely needs an indexer or an
 * explorer API key (token holders, verified source, full ABI) it is reported as
 * unavailable rather than approximated with something that looks real.
 */

import { rpcRequest, decodeUint, decodeAbiString } from './evmRead.js';
import { PROBE_FUNCTIONS, INTERFACE_IDS, INTERFACE_LABELS, TOPICS, SELECTORS, buildDetectedAbi } from './abis.js';
import { resolveLabel, checkSymbolImpersonation } from './labels.js';

const BTC = 'https://blockstream.info/api';

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

async function getJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, data: await res.json() };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === 'AbortError'
        ? 'Request timed out'
        : /Failed to fetch|NetworkError|Load failed/i.test(String(err?.message))
          ? 'Endpoint refused browser access (CORS)'
          : err?.message || 'Request failed'
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ==================== Bitcoin ==================== */

export const btcTipHeight = async () => {
  const r = await getJson(`${BTC}/blocks/tip/height`);
  return r.ok ? { ok: true, height: num(r.data) } : r;
};

export const btcBlocks = async () => {
  const r = await getJson(`${BTC}/blocks`);
  return r.ok ? { ok: true, blocks: r.data } : r;
};

export const btcBlock = async (hashOrHeight) => {
  const key = String(hashOrHeight || '').trim();
  if (!key) return { ok: false, error: 'Enter a block height or hash' };
  const url = /^\d+$/.test(key) ? `${BTC}/block-height/${key}` : `${BTC}/block/${key}`;
  const r = await getJson(url);
  if (!r.ok) return r;
  const hash = typeof r.data === 'string' ? r.data : key;
  const [full, txs] = await Promise.all([
    getJson(`${BTC}/block/${hash}`),
    getJson(`${BTC}/block/${hash}/txs/0`)
  ]);
  if (!full.ok) return full;
  return { ok: true, hash, block: full.data, txs: txs.ok ? txs.data.slice(0, 25) : [] };
};

export const btcTx = async (txid) => {
  const id = String(txid || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(id)) return { ok: false, error: 'Enter a 64-character transaction id' };
  const [tx, status] = await Promise.all([getJson(`${BTC}/tx/${id}`), getJson(`${BTC}/tx/${id}/status`)]);
  if (!tx.ok) return tx;
  return { ok: true, tx: tx.data, status: status.ok ? status.data : null };
};

export const btcAddress = async (address) => {
  const addr = String(address || '').trim();
  if (!addr) return { ok: false, error: 'Enter an address' };
  const r = await getJson(`${BTC}/address/${encodeURIComponent(addr)}`);
  if (!r.ok) return r;
  const cs = r.data.chain_stats || {};
  const ms = r.data.mempool_stats || {};
  const funded = num(cs.funded_txo_sum) || 0;
  const spent = num(cs.spent_txo_sum) || 0;
  const feeTotal = num(cs.fee) || 0;
  return {
    ok: true,
    address: addr,
    balanceSats: funded - spent,
    pendingSats: (num(ms.funded_txo_sum) || 0) - (num(ms.spent_txo_sum) || 0),
    txCount: num(cs.tx_count) || 0,
    fundedSats: funded,
    spentSats: spent,
    feesSats: feeTotal,
    mempoolTxCount: num(ms.tx_count) || 0
  };
};

export const btcAddressTxs = async (address) => {
  const r = await getJson(`${BTC}/address/${encodeURIComponent(String(address || '').trim())}/txs`);
  return r.ok ? { ok: true, txs: r.data.slice(0, 25) } : r;
};

export const btcMempool = async () => {
  const r = await getJson(`${BTC}/mempool`);
  return r.ok ? { ok: true, ...r.data } : r;
};

export const btcFees = async () => {
  const r = await getJson(`${BTC}/fee-estimates`);
  return r.ok ? { ok: true, estimates: r.data } : r;
};

/* ==================== EVM ==================== */

const hex = (v) => `0x${BigInt(v).toString(16)}`;

export async function evmBlockNumber(chain) {
  const r = await rpcRequest(chain, 'eth_blockNumber', []);
  return r.ok ? { ok: true, number: decodeUint(r.result), rpcUsed: r.rpcUsed } : r;
}

export async function evmBlock(chain, numberOrHash) {
  const key = String(numberOrHash || '').trim();
  const param = !key
    ? 'latest'
    : /^0x[0-9a-fA-F]{64}$/.test(key) ? key : /^\d+$/.test(key) ? hex(key) : null;
  if (param == null) return { ok: false, error: 'Enter a block number or a 0x 64-character hash' };

  const r = await rpcRequest(chain, 'eth_getBlockByNumber', [param, false]);
  const useHash = !r.ok && param !== 'latest';
  const final = useHash ? await rpcRequest(chain, 'eth_getBlockByHash', [param, false]) : r;
  if (!final.ok) return final;
  if (!final.result) return { ok: false, error: 'Block not found' };

  const b = final.result;
  return {
    ok: true,
    block: {
      number: decodeUint(b.number),
      hash: b.hash,
      parentHash: b.parentHash,
      timestamp: decodeUint(b.timestamp),
      miner: b.miner,
      gasUsed: decodeUint(b.gasUsed),
      gasLimit: decodeUint(b.gasLimit),
      baseFeePerGas: b.baseFeePerGas ? decodeUint(b.baseFeePerGas) : null,
      txCount: (b.transactions || []).length,
      transactions: (b.transactions || []).slice(0, 25),
      size: b.size ? decodeUint(b.size) : null
    },
    rpcUsed: final.rpcUsed
  };
}

export async function evmTx(chain, hash) {
  const h = String(hash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return { ok: false, error: 'Enter a 0x 64-character transaction hash' };
  const [tx, receipt] = await Promise.all([
    rpcRequest(chain, 'eth_getTransactionByHash', [h]),
    rpcRequest(chain, 'eth_getTransactionReceipt', [h])
  ]);
  if (!tx.ok) return tx;
  if (!tx.result) return { ok: false, error: 'Transaction not found on this chain yet' };
  const t = tx.result;
  const rc = receipt.ok ? receipt.result : null;
  return {
    ok: true,
    tx: {
      hash: t.hash,
      from: t.from,
      to: t.to,
      value: decodeUint(t.value),
      nonce: decodeUint(t.nonce),
      blockNumber: t.blockNumber ? decodeUint(t.blockNumber) : null,
      gas: decodeUint(t.gas),
      gasPrice: t.gasPrice ? decodeUint(t.gasPrice) : null,
      maxFeePerGas: t.maxFeePerGas ? decodeUint(t.maxFeePerGas) : null,
      input: t.input,
      isCreate: !t.to,
      // What this transaction actually IS, from the selector.
      selector: t.input && t.input.length >= 10 ? t.input.slice(0, 10) : null
    },
    receipt: rc ? {
      status: rc.status ? decodeUint(rc.status) : null,
      gasUsed: decodeUint(rc.gasUsed),
      effectiveGasPrice: rc.effectiveGasPrice ? decodeUint(rc.effectiveGasPrice) : null,
      contractAddress: rc.contractAddress || null,
      logCount: (rc.logs || []).length,
      logs: (rc.logs || []).slice(0, 20)
    } : null
  };
}

export async function evmAddress(chain, address, { addressBook = [] } = {}) {
  const addr = String(address || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return { ok: false, error: 'Enter a 0x address' };

  const [bal, nonce, code] = await Promise.all([
    rpcRequest(chain, 'eth_getBalance', [addr, 'latest']),
    rpcRequest(chain, 'eth_getTransactionCount', [addr, 'latest']),
    rpcRequest(chain, 'eth_getCode', [addr, 'latest'])
  ]);
  if (!bal.ok) return bal;

  const codeHex = code.ok ? (code.result || '0x') : '0x';
  const isContract = codeHex !== '0x' && codeHex.length > 2;
  const label = resolveLabel(addr, addressBook);

  let token = null;
  let impersonation = null;
  if (isContract) {
    token = await readErc20(chain, addr);
    impersonation = checkSymbolImpersonation(addr, token?.symbol);
  }

  return {
    ok: true,
    address: addr,
    balanceWei: decodeUint(bal.result),
    nonce: nonce.ok ? decodeUint(nonce.result) : null,
    isContract,
    codeSize: isContract ? (codeHex.length - 2) / 2 : 0,
    label,
    token,
    impersonation,
    rpcUsed: bal.rpcUsed
  };
}

/** Read the ERC-20 surface and report exactly which calls succeeded. */
export async function readErc20(chain, token) {
  const probe = async (name) => {
    const r = await rpcRequest(chain, 'eth_call', [{ to: token, data: SELECTORS[name] }, 'latest']);
    return r.ok ? r.result : null;
  };

  const [nameRes, symbolRes, decimalsRes, supplyRes] = await Promise.all([
    probe('name'), probe('symbol'), probe('decimals'), probe('totalSupply')
  ]);

  const decimalsRaw = decimalsRes ? decodeUint(decimalsRes) : null;
  const supply = supplyRes ? decodeUint(supplyRes) : null;
  const symbol = symbolRes ? decodeAbiString(symbolRes) : null;

  const isErc20 = decimalsRaw != null || supply != null;
  if (!isErc20 && !nameRes && !symbolRes) {
    return { ok: false, isErc20: false, reason: 'No ERC-20 functions responded' };
  }

  const decimals = decimalsRaw == null ? null : Number(decimalsRaw);
  return {
    ok: true,
    isErc20,
    name: nameRes ? decodeAbiString(nameRes) : null,
    symbol,
    decimals,
    totalSupply: supply,
    formattedSupply: supply != null && decimals != null
      ? Number(supply) / 10 ** decimals
      : null
  };
}

/**
 * Interface detection via ERC-165. This is INTERFACE verification, not source
 * verification — it proves which standards a contract implements, not what its
 * code says.
 */
export async function detectInterfaces(chain, address) {
  const probe = async (id) => {
    const data = `${SELECTORS.supportsInterface}${id.replace('0x', '').padEnd(64, '0')}`;
    const r = await rpcRequest(chain, 'eth_call', [{ to: address, data }, 'latest']);
    if (!r.ok) return null;
    const v = decodeUint(r.result);
    return v === 1n;
  };

  const checks = await Promise.all(
    ['ERC721', 'ERC721Metadata', 'ERC721Enumerable', 'ERC1155', 'ERC1155MetadataURI', 'ERC2981', 'ERC4907']
      .map(async (k) => [k, await probe(INTERFACE_IDS[k])])
  );

  const supported = checks.filter(([, v]) => v === true).map(([k]) => k);
  const kind = supported.includes('ERC1155') ? 'erc1155' : supported.includes('ERC721') ? 'erc721' : 'contract';

  return {
    ok: true,
    supported,
    labels: supported.map((k) => INTERFACE_LABELS[k] || k),
    erc165Responded: checks.some(([, v]) => v !== null),
    kind
  };
}

/** Probe the read-only function set and build a minimal, DETECTED ABI. */
export async function detectAbi(chain, address) {
  // Only no-argument reads are probed — calling a function that expects
  // arguments with empty calldata would return meaningless data.
  const results = await Promise.all(PROBE_FUNCTIONS.map(async (fn) => {
    const r = await rpcRequest(chain, 'eth_call', [{ to: address, data: SELECTORS[fn.name] }, 'latest']);
    if (!r.ok) return { ...fn, responded: false };
    const value = fn.returns === 'uint' ? decodeUint(r.result)
      : fn.returns === 'string' ? decodeAbiString(r.result)
        : r.result;
    // `decimals()` returning empty calldata means "no such function".
    const responded = r.result != null && r.result !== '0x';
    return { ...fn, responded, value };
  }));

  const confirmed = results.filter((r) => r.responded).map((r) => r.name);
  return {
    ok: true,
    confirmed,
    details: results,
    abi: buildDetectedAbi(confirmed, { kind: 'contract' }),
    note: 'Probed by calling each selector. This is the detected subset, NOT the contract’s verified source ABI.'
  };
}

/** ERC-20 / ERC-721 Transfer logs for an address or token. */
export async function evmTransfers(chain, { address, direction = 'both', fromBlock, toBlock, limit = 25 }) {
  const addr = String(address || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return { ok: false, error: 'Enter a 0x address' };

  const latestRes = await rpcRequest(chain, 'eth_blockNumber', []);
  if (!latestRes.ok) return latestRes;
  const latest = decodeUint(latestRes.result);
  const span = 2000n; // conservative: public RPCs cap getLogs ranges
  const to = toBlock ? BigInt(toBlock) : latest;
  const from = fromBlock ? BigInt(fromBlock) : (to > span ? to - span : 0n);

  const padded = addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const topic = TOPICS.Transfer;

  // topic[1] = from, topic[2] = to — a Transfer either sends or receives.
  const attempts = direction === 'in'
    ? [{ topics: [topic, null, `0x${padded}`] }]
    : direction === 'out'
      ? [{ topics: [topic, `0x${padded}`] }]
      : [{ topics: [topic, `0x${padded}`] }, { topics: [topic, null, `0x${padded}`] }];

  const collected = [];
  let lastError = null;
  for (const filter of attempts) {
    const r = await rpcRequest(chain, 'eth_getLogs', [{
      fromBlock: hex(from), toBlock: hex(to), ...filter
    }]);
    if (!r.ok) { lastError = r.error; continue; }
    (r.result || []).forEach((l) => collected.push(l));
  }

  if (!collected.length && lastError) {
    return { ok: false, error: lastError, range: { from: from.toString(), to: to.toString() } };
  }

  const seen = new Set();
  const logs = collected
    .filter((l) => {
      if (seen.has(l.transactionHash + l.logIndex)) return false;
      seen.add(l.transactionHash + l.logIndex);
      return true;
    })
    .sort((a, b) => (BigInt(b.blockNumber) > BigInt(a.blockNumber) ? 1 : -1))
    .slice(0, limit)
    .map((l) => ({
      token: l.address,
      blockNumber: decodeUint(l.blockNumber),
      txHash: l.transactionHash,
      from: `0x${(l.topics[1] || '').slice(26)}`,
      to: `0x${(l.topics[2] || '').slice(26)}`,
      // ERC-721 Transfer has no data (tokenId is topic[3]); ERC-20 puts value in data.
      rawValue: l.data && l.data !== '0x' ? decodeUint(l.data) : null,
      tokenId: l.topics[3] ? decodeUint(l.topics[3]) : null,
      logIndex: decodeUint(l.logIndex)
    }));

  return {
    ok: true,
    logs,
    scannedRange: { from: from.toString(), to: to.toString() },
    truncated: logs.length >= limit
  };
}

/** Pending transaction count — an EVM mempool proxy. */
export async function evmPendingCount(chain) {
  const r = await rpcRequest(chain, 'eth_getBlockByNumber', ['pending', false]);
  if (!r.ok) return r;
  return { ok: true, pending: (r.result?.transactions || []).length, rpcUsed: r.rpcUsed };
}

/* ==================== Validators & staking ==================== */

/**
 * Ethereum validators from the public beacon API.
 * RPC cannot report validators, so this uses the consensus-layer endpoint.
 */
export async function ethValidators(limit = 30) {
  const head = await getJson('https://ethereum-beacon-api.publicnode.com/eth/v1/beacon/headers/head');
  if (!head.ok) return head;
  // Verified shape: { execution_optimistic, finalized, data: { root, canonical,
  // header: { message: { slot } } } }. getJson wraps the body in `.data`, so the
  // full path is head.data.data.header.message.slot.
  const slot = head.data?.data?.header?.message?.slot;
  const vals = await getJson('https://ethereum-beacon-api.publicnode.com/eth/v1/beacon/states/head/validators');
  if (!vals.ok) return vals;
  const list = vals.data?.data || [];
  const active = list.filter((v) => v.status === 'active_ongoing');
  return {
    ok: true,
    slot,
    total: list.length,
    active: active.length,
    sample: list.slice(0, limit).map((v) => ({
      index: v.index,
      pubkey: v.validator?.pubkey,
      status: v.status,
      balanceEth: v.balance != null ? Number(v.balance) / 1e9 : null,
      effectiveBalanceEth: v.validator?.effective_balance != null ? Number(v.validator.effective_balance) / 1e9 : null
    }))
  };
}

/** Solana validators with real activated stake, from getVoteAccounts. */
export async function solValidators(limit = 30) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVoteAccounts', params: [{ keepUnstakedDelinquents: false }] }),
      signal: ctrl.signal
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    if (json.error) return { ok: false, error: json.error.message };
    const current = json.result?.current || [];
    const delinquent = json.result?.delinquent || [];
    const totalStake = current.reduce((a, v) => a + (num(v.activatedStake) || 0), 0);
    const ranked = [...current].sort((a, b) => b.activatedStake - a.activatedStake);
    return {
      ok: true,
      current: current.length,
      delinquent: delinquent.length,
      totalActivatedStakeLamports: totalStake,
      totalActivatedStakeSol: totalStake / 1e9,
      commissionAvg: current.length ? current.reduce((a, v) => a + (num(v.commission) || 0), 0) / current.length : null,
      sample: ranked.slice(0, limit).map((v, i) => ({
        rank: i + 1,
        votePubkey: v.votePubkey,
        nodePubkey: v.nodePubkey,
        stakeSol: (num(v.activatedStake) || 0) / 1e9,
        commission: num(v.commission),
        sharePct: totalStake ? ((num(v.activatedStake) || 0) / totalStake) * 100 : null
      }))
    };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'Request timed out' : err?.message || 'Request failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** Capabilities this explorer genuinely cannot deliver, and why. */
export const EXPLORER_GAPS = [
  {
    id: 'token_holders',
    label: 'Token holders',
    reason: 'Needs an indexer that walks every Transfer log ever emitted. Public RPC only serves bounded log ranges, so a holder list cannot be derived in the browser.'
  },
  {
    id: 'verified_source',
    label: 'Verified source code',
    reason: 'Requires an explorer API key and a submitted-source database. This build does INTERFACE detection by probing instead, and says so.'
  },
  {
    id: 'full_abi',
    label: 'Full contract ABI',
    reason: 'A complete ABI can only come from verified source. What is shown is the subset of standard functions that actually responded on-chain.'
  }
];
