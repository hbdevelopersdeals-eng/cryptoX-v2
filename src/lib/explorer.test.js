import { describe, it, expect, vi, afterEach } from 'vitest';
import { TOPICS, SELECTORS, INTERFACE_IDS, buildDetectedAbi, withUintArg, FUNCTIONS } from './abis.js';
import { lookupLabel, resolveLabel, checkSymbolImpersonation, KNOWN_SYMBOLS, CURATED_COUNT } from './labels.js';
import {
  btcAddress, btcMempool, btcBlock, evmBlock, evmTx, evmAddress, readErc20,
  detectInterfaces, detectAbi, evmTransfers, solValidators, ethValidators, EXPLORER_GAPS
} from './explorer.js';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const pad = (a) => `0x${'0'.repeat(24)}${a.toLowerCase().replace(/^0x/, '')}`;

afterEach(() => vi.unstubAllGlobals());

const ok = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
const rpcRoute = (table) => vi.fn(async (_url, init) => {
  const { method, params } = JSON.parse(init.body);
  const key = `${method}:${JSON.stringify(params?.[0] ?? '')}`;
  if (table[key] !== undefined) return ok(table[key]);
  if (table[method] !== undefined) return ok(table[method]);
  return ok('0x');
});

describe('ABI registry', () => {
  it('derives the canonical Transfer event topic', () => {
    expect(TOPICS.Transfer).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
    expect(TOPICS.Approval.startsWith('0x8c5be1e5')).toBe(true); // canonical Approval topic prefix
  });

  it('derives the standard selectors', () => {
    expect(SELECTORS.transfer).toBe('0xa9059cbb');
    expect(SELECTORS.balanceOf).toBe('0x70a08231');
    expect(SELECTORS.allowance).toBe('0xdd62ed3e');
    expect(SELECTORS.totalSupply).toBe('0x18160ddd');
    expect(SELECTORS.owner).toBe('0x8da5cb5b');
  });

  it('publishes the ERC-165 interface ids', () => {
    expect(INTERFACE_IDS.ERC721).toBe('0x80ac58cd');
    expect(INTERFACE_IDS.ERC1155).toBe('0xd9b67a26');
    expect(INTERFACE_IDS.ERC165).toBe('0x01ffc9a7');
  });

  it('encodes a uint argument into 32 bytes', () => {
    const data = withUintArg('tokenURI', 1);
    expect(data.startsWith(SELECTORS.tokenURI)).toBe(true);
    expect(data.length).toBe(10 + 64);
  });

  it('builds a detected ABI only from confirmed functions', () => {
    const { abi } = buildDetectedAbi(['name', 'symbol', 'decimals', 'totalSupply']);
    const names = abi.filter((e) => e.type === 'function').map((e) => e.name);
    expect(names).toContain('name');
    expect(names).toContain('decimals');
    expect(names).toContain('transfer'); // write surface added for token-like contracts
    expect(buildDetectedAbi([]).abi.length).toBe(0);
    expect(FUNCTIONS.length).toBeGreaterThan(5);
  });
});

describe('address labels', () => {
  it('resolves curated, verified labels', () => {
    expect(lookupLabel(USDC).label).toMatch(/USD Coin/);
    expect(lookupLabel(USDC).symbol).toBe('USDC');
    expect(lookupLabel(BAYC).kind).toBe('nft');
    expect(lookupLabel('0x0000000000000000000000000000000000000000').kind).toBe('burn');
    expect(lookupLabel('0x1234567890123456789012345678901234567890')).toBeNull();
    expect(CURATED_COUNT).toBeGreaterThanOrEqual(9);
  });

  it('is case-insensitive', () => {
    expect(lookupLabel(USDC.toLowerCase()).label).toBe(lookupLabel(USDC).label);
  });

  it('prefers the user’s own label over the curated one', () => {
    const own = resolveLabel(USDC, [{ address: USDC, label: 'My trading wallet' }]);
    expect(own.label).toBe('My trading wallet');
    expect(own.source).toBe('address book');
    expect(own.curated).toMatch(/USD Coin/);

    const curated = resolveLabel(USDC, []);
    expect(curated.source).toBe('curated registry');
    expect(curated.kind).toBe('token');
  });

  it('reports unlabelled addresses honestly', () => {
    const r = resolveLabel('0x9999999999999999999999999999999999999999', []);
    expect(r.label).toBeNull();
    expect(r.kind).toBe('unknown');
  });
});

describe('symbol impersonation detection', () => {
  it('flags a fake USDC at a different address', () => {
    const hit = checkSymbolImpersonation('0x9999999999999999999999999999999999999999', 'USDC');
    expect(hit.level).toBe('high');
    expect(hit.message).toMatch(/genuine USDC/);
  });

  it('does not flag the genuine token', () => {
    expect(checkSymbolImpersonation(USDC, 'USDC')).toBeNull();
    expect(checkSymbolImpersonation(BAYC, 'BAYC')).toBeNull();
  });

  it('ignores unknown symbols and empty input', () => {
    expect(checkSymbolImpersonation('0x9999999999999999999999999999999999999999', 'SCAMCOIN')).toBeNull();
    expect(checkSymbolImpersonation(USDC, null)).toBeNull();
    expect(Object.keys(KNOWN_SYMBOLS)).toContain('USDC');
  });
});

describe('Bitcoin explorer', () => {
  it('nets funded minus spent and separates the mempool', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      expect(String(url)).toContain('/address/');
      return {
        ok: true,
        json: async () => ({
          chain_stats: { funded_txo_sum: 500000000, spent_txo_sum: 200000000, tx_count: 7, fee: 1234 },
          mempool_stats: { funded_txo_sum: 10000, spent_txo_sum: 0, tx_count: 1 }
        })
      };
    }));
    const r = await btcAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(r.ok).toBe(true);
    expect(r.balanceSats).toBe(300000000);
    expect(r.pendingSats).toBe(10000);
    expect(r.txCount).toBe(7);
    expect(r.mempoolTxCount).toBe(1);
  });

  it('requires an address', async () => {
    expect((await btcAddress('')).ok).toBe(false);
  });

  it('reads mempool totals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ count: 87021, vsize: 45540745, total_fee: 12850551 })
    })));
    const r = await btcMempool();
    expect(r.ok).toBe(true);
    expect(r.count).toBe(87021);
  });

  it('surfaces an endpoint failure instead of fake data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    const r = await btcMempool();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/CORS|refused/i);
  });

  it('resolves a block by height then fetches it by hash', async () => {
    const HASH = '0'.repeat(64);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith('/block-height/800000')) return { ok: true, json: async () => HASH };
      if (u.endsWith(`/block/${HASH}`)) return { ok: true, json: async () => ({ id: HASH, height: 800000, tx_count: 2 }) };
      return { ok: true, json: async () => [{ txid: 'a' }, { txid: 'b' }, { txid: 'c' }] };
    }));
    const r = await btcBlock('800000');
    expect(r.ok).toBe(true);
    expect(r.block.height).toBe(800000);
    expect(r.txs.length).toBe(3);
    expect((await btcBlock('').catch(() => ({ ok: false }))).ok).toBe(false);
  });
});

describe('EVM explorer', () => {
  it('decodes a block', async () => {
    vi.stubGlobal('fetch', rpcRoute({
      'eth_getBlockByNumber:"latest"': {
        number: '0x1', hash: '0xabc', timestamp: '0x64', miner: '0xminer',
        gasUsed: '0x5208', gasLimit: '0x1c9c380', baseFeePerGas: '0x3b9aca00',
        transactions: ['0x1', '0x2'], size: '0x100'
      }
    }));
    const r = await evmBlock('ethereum', '');
    expect(r.ok).toBe(true);
    expect(r.block.number).toBe(1n);
    expect(r.block.gasUsed).toBe(21000n);
    expect(r.block.baseFeePerGas).toBe(1000000000n);
    expect(r.block.txCount).toBe(2);
  });

  it('rejects a bad block identifier', async () => {
    expect((await evmBlock('ethereum', 'nonsense')).ok).toBe(false);
  });

  it('decodes a transaction and its receipt, and detects a create', async () => {
    vi.stubGlobal('fetch', rpcRoute({
      eth_getTransactionByHash: {
        hash: `0x${'a'.repeat(64)}`, from: '0xfrom', to: null, value: '0x0', nonce: '0x1',
        blockNumber: '0x10', gas: '0x5208', input: '0x60806040', gasPrice: '0x3b9aca00'
      },
      eth_getTransactionReceipt: {
        status: '0x1', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', contractAddress: '0xnew', logs: [{}, {}]
      }
    }));
    const r = await evmTx('ethereum', `0x${'a'.repeat(64)}`);
    expect(r.ok).toBe(true);
    expect(r.tx.isCreate).toBe(true);
    expect(r.receipt.status).toBe(1n);
    expect(r.receipt.logCount).toBe(2);
    expect(r.receipt.contractAddress).toBe('0xnew');
  });

  it('requires a 0x 64-char tx hash', async () => {
    expect((await evmTx('ethereum', '0x123')).ok).toBe(false);
  });

  it('reports an address with its label and contract status', async () => {
    vi.stubGlobal('fetch', rpcRoute({
      'eth_getBalance:[object Object]': '0xde0b6b3a7640000',
      eth_getBalance: '0xde0b6b3a7640000',
      eth_getTransactionCount: '0x5',
      eth_getCode: '0x6080',
      eth_call: '0x'
    }));
    const r = await evmAddress('ethereum', USDC);
    expect(r.ok).toBe(true);
    expect(r.balanceWei).toBe(1000000000000000000n);
    expect(r.nonce).toBe(5n);
    expect(r.isContract).toBe(true);
    expect(r.label.label).toMatch(/USD Coin/);
  });

  it('rejects a malformed address', async () => {
    expect((await evmAddress('ethereum', '0xzz')).ok).toBe(false);
  });

  it('reads ERC-20 metadata and formats supply', async () => {
    // name/symbol as ABI strings, decimals 6, totalSupply 49,254,200,449e6
    const str = (s) => `0x${'0'.repeat(62)}20${'0'.repeat(62)}${s.length.toString(16).padStart(2, '0')}${Buffer.from(s).toString('hex').padEnd(64, '0')}`;
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => {
      const { data } = JSON.parse(init.body).params[0];
      call += 1;
      if (data === SELECTORS.name) return ok(str('USD Coin'));
      if (data === SELECTORS.symbol) return ok(str('USDC'));
      if (data === SELECTORS.decimals) return ok(`0x${(6).toString(16).padStart(64, '0')}`);
      return ok(`0x${(49254200449n * 1000000n).toString(16).padStart(64, '0')}`);
    }));
    const r = await readErc20('ethereum', USDC);
    expect(r.ok).toBe(true);
    expect(r.isErc20).toBe(true);
    expect(r.symbol).toBe('USDC');
    expect(r.decimals).toBe(6);
    expect(r.formattedSupply).toBeCloseTo(49254200449, 0);
    expect(call).toBe(4);
  });

  it('detects ERC-721 through ERC-165 and distinguishes ERC-1155', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => {
      const { data } = JSON.parse(init.body).params[0];
      const id = data.slice(10, 18);
      // Only ERC-721 responds true.
      const yes = id === INTERFACE_IDS.ERC721.replace('0x', '').slice(0, 8);
      return ok(yes ? `0x${(1).toString(16).padStart(64, '0')}` : `0x${'0'.repeat(64)}`);
    }));
    const r = await detectInterfaces('ethereum', BAYC);
    expect(r.ok).toBe(true);
    expect(r.erc165Responded).toBe(true);
    expect(r.supported).toContain('ERC721');
    expect(r.kind).toBe('erc721');
    expect(r.labels[0]).toMatch(/ERC-721/);
  });

  it('builds a detected ABI and says it is not the verified source', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => {
      const { data } = JSON.parse(init.body).params[0];
      if (data === SELECTORS.symbol) {
        return ok(`0x${'0'.repeat(62)}20${'0'.repeat(62)}0455534443${'0'.repeat(56)}`);
      }
      return ok('0x'); // no other function responds
    }));
    const r = await detectAbi('ethereum', USDC);
    expect(r.ok).toBe(true);
    expect(r.confirmed).toContain('symbol');
    expect(r.confirmed).not.toContain('decimals');
    expect(r.note).toMatch(/NOT the contract’s verified source ABI/i);
  });
});

describe('transfer logs', () => {
  const OWNER = '0x1111111111111111111111111111111111111111';
  const OTHER = '0x2222222222222222222222222222222222222222';

  it('decodes from/to out of the indexed topics', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => {
      const { method, params } = JSON.parse(init.body);
      if (method === 'eth_blockNumber') return ok('0x64');
      const filter = params[0];
      // Only the "outgoing" query returns a log.
      if (filter.topics[1]) {
        return ok([{
          address: USDC, blockNumber: '0x63', transactionHash: '0xfeed', logIndex: '0x2',
          topics: [TOPICS.Transfer, pad(OWNER), pad(OTHER)],
          data: `0x${(1000000).toString(16).padStart(64, '0')}`
        }]);
      }
      return ok([]);
    }));
    const r = await evmTransfers('ethereum', { address: OWNER, direction: 'out' });
    expect(r.ok).toBe(true);
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0].from.toLowerCase()).toBe(OWNER.toLowerCase());
    expect(r.logs[0].to.toLowerCase()).toBe(OTHER.toLowerCase());
    expect(r.logs[0].rawValue).toBe(1000000n);
    expect(r.logs[0].tokenId).toBeNull();
  });

  it('reads a tokenId for an ERC-721 transfer (no data, id in topic 3)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => {
      const { method } = JSON.parse(init.body);
      if (method === 'eth_blockNumber') return ok('0x64');
      return ok([{
        address: BAYC, blockNumber: '0x63', transactionHash: '0xnft', logIndex: '0x0',
        topics: [TOPICS.Transfer, pad(OWNER), pad(OTHER), `0x${(42).toString(16).padStart(64, '0')}`],
        data: '0x'
      }]);
    }));
    const r = await evmTransfers('ethereum', { address: OWNER });
    expect(r.logs[0].tokenId).toBe(42n);
    expect(r.logs[0].rawValue).toBeNull();
  });

  it('rejects a bad address before issuing a query', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect((await evmTransfers('ethereum', { address: 'nope' })).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports a range limit rather than an empty result when the RPC refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => {
      const { method } = JSON.parse(init.body);
      if (method === 'eth_blockNumber') return ok('0x100000');
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'query returned more than 10000 results' } }) };
    }));
    const r = await evmTransfers('ethereum', { address: OWNER });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/10000|results/i);
  });
});

describe('validators and staking', () => {
  it('ranks Solana validators by real activated stake', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          current: [
            { votePubkey: 'A', nodePubkey: 'n1', activatedStake: 100, commission: 5 },
            { votePubkey: 'B', nodePubkey: 'n2', activatedStake: 300, commission: 10 }
          ],
          delinquent: [{ votePubkey: 'D' }]
        }
      })
    })));
    const r = await solValidators();
    expect(r.ok).toBe(true);
    expect(r.current).toBe(2);
    expect(r.delinquent).toBe(1);
    expect(r.totalActivatedStakeSol).toBeCloseTo(400 / 1e9, 12);
    expect(r.sample[0].votePubkey).toBe('B'); // highest stake first
    expect(r.sample[0].rank).toBe(1);
    expect(r.commissionAvg).toBe(7.5);
  });

  it('reads Ethereum validators from the beacon API and counts active ones', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      // Real beacon shape: data.root / data.canonical / data.header.message.slot
      if (u.includes('/headers/head')) {
        return { ok: true, json: async () => ({ execution_optimistic: false, finalized: false, data: { root: '0xab', canonical: true, header: { message: { slot: '15338049' } } } }) };
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            { index: '1', status: 'active_ongoing', balance: '32006300593', validator: { pubkey: '0xaa', effective_balance: '32000000000' } },
            { index: '2', status: 'exited', balance: '1', validator: { pubkey: '0xbb', effective_balance: '0' } }
          ]
        })
      };
    }));
    const r = await ethValidators();
    expect(r.ok).toBe(true);
    expect(r.slot).toBe('15338049');
    expect(r.total).toBe(2);
    expect(r.active).toBe(1);
    expect(r.sample[0].balanceEth).toBeCloseTo(32.006300593, 6);
  });
});

describe('declared gaps', () => {
  it('lists what the explorer cannot do, with reasons', () => {
    const ids = EXPLORER_GAPS.map((g) => g.id);
    expect(ids).toContain('token_holders');
    expect(ids).toContain('verified_source');
    expect(ids).toContain('full_abi');
    EXPLORER_GAPS.forEach((g) => expect(g.reason.length).toBeGreaterThan(40));
  });
});
