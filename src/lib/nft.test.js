import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isAddress, padAddress, padUint, supportsInterfaceData, erc721BalanceData,
  erc1155BalanceData, readInterfaceSupport, readNftBalance
} from './nft.js';
import { SELECTORS, INTERFACE_IDS } from './abis.js';

const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const CONTRACT = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';

/** Stub eth_call by inspecting the calldata selector/interface. */
function stubRpc(map) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const data = body.params?.[0]?.data || '';
    const key = Object.keys(map).find((k) => data.startsWith(k));
    const json = key
      ? map[key]
      : { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'no stub' } };
    return { ok: true, json: async () => json };
  }));
  return calls;
}

const ok = (result) => ({ jsonrpc: '2.0', id: 1, result });

afterEach(() => vi.unstubAllGlobals());

describe('ABI encoding', () => {
  it('validates an address strictly', () => {
    expect(isAddress(OWNER)).toBe(true);
    expect(isAddress('0x123')).toBe(false);
    expect(isAddress('d8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
    expect(isAddress(null)).toBe(false);
  });

  it('pads an address to a 32-byte word, lowercased', () => {
    const p = padAddress(OWNER);
    expect(p).toHaveLength(64);
    expect(p).toBe(`${'0'.repeat(24)}d8da6bf26964af9d7eed9e03e53415d37aa96045`);
  });

  it('pads a uint to a 32-byte word', () => {
    expect(padUint(0)).toBe('0'.repeat(64));
    expect(padUint(255)).toBe(`${'0'.repeat(62)}ff`);
    expect(padUint(2n ** 200n)).toHaveLength(64);
    // Negative input clamps to zero rather than producing an invalid word.
    expect(padUint(-5)).toBe('0'.repeat(64));
  });

  it('builds supportsInterface calldata for a bytes4 id', () => {
    const d = supportsInterfaceData(INTERFACE_IDS.ERC721);
    expect(d.startsWith(SELECTORS.supportsInterface)).toBe(true);
    // 0x + 8 hex selector + one 32-byte word = 74 chars.
    expect(d).toHaveLength(74);
    expect(d.slice(10, 18)).toBe('80ac58cd');
    // bytes4 is padded on the RIGHT to a full word.
    expect(d.slice(18)).toBe('0'.repeat(56));
  });

  it('builds ERC-721 and ERC-1155 balanceOf calldata with the right arity', () => {
    const d721 = erc721BalanceData(OWNER);
    expect(d721).toHaveLength(74); // selector + owner
    expect(d721.startsWith(SELECTORS.balanceOf)).toBe(true);

    const d1155 = erc1155BalanceData(OWNER, 7);
    expect(d1155).toHaveLength(138); // selector + owner + id
    expect(d1155.slice(-64)).toBe(`${'0'.repeat(62)}07`);
  });
});

describe('interface probe interpretation', () => {
  it('treats a 1 as supported and empty calldata as not implemented', () => {
    expect(readInterfaceSupport(`0x${'0'.repeat(63)}1`)).toBe(true);
    expect(readInterfaceSupport(`0x${'0'.repeat(64)}`)).toBe(false);
    expect(readInterfaceSupport('0x')).toBe(false);
    expect(readInterfaceSupport(null)).toBe(false);
    expect(readInterfaceSupport('garbage')).toBe(false);
  });
});

describe('readNftBalance', () => {
  it('rejects malformed input before spending a call', async () => {
    const calls = stubRpc({});
    const bad = await readNftBalance('ethereum', 'nope', OWNER);
    expect(bad.error).toMatch(/Contract/);
    const bad2 = await readNftBalance('ethereum', CONTRACT, 'nope');
    expect(bad2.error).toMatch(/Owner/);
    expect(calls).toHaveLength(0);
  });

  it('reads an ERC-721 balance using the one-argument balanceOf', async () => {
    // Answer each ERC-165 probe by the interface id actually asked about — one
    // blanket "true" would make the contract look like both standards at once.
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const data = JSON.parse(init.body).params?.[0]?.data || '';
      if (data.startsWith(SELECTORS.supportsInterface)) {
        const id = data.slice(10, 18).toLowerCase();
        const yes = id === INTERFACE_IDS.ERC721.replace('0x', '').toLowerCase();
        return { ok: true, json: async () => ok(`0x${'0'.repeat(63)}${yes ? '1' : '0'}`) };
      }
      if (data.startsWith(SELECTORS.balanceOf)) {
        expect(data).toHaveLength(74); // one-argument form
        return { ok: true, json: async () => ok(`0x${'0'.repeat(62)}03`) };
      }
      return { ok: true, json: async () => ({ error: { message: 'unexpected' } }) };
    }));

    const r = await readNftBalance('ethereum', CONTRACT, OWNER);
    expect(r.standard).toBe('ERC-721');
    expect(r.balance).toBe(3n);
    expect(r.note).toMatch(/number of tokens owned/i);
  });

  it('reads an ERC-1155 balance with the two-argument form', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const data = JSON.parse(init.body).params?.[0]?.data || '';
      if (data.startsWith(SELECTORS.supportsInterface)) {
        const id = data.slice(10, 18).toLowerCase();
        const yes = id === INTERFACE_IDS.ERC1155.replace('0x', '').toLowerCase();
        return { ok: true, json: async () => ok(`0x${'0'.repeat(63)}${yes ? '1' : '0'}`) };
      }
      if (data.startsWith(SELECTORS.balanceOf)) {
        expect(data).toHaveLength(138); // owner + token id
        return { ok: true, json: async () => ok(`0x${'0'.repeat(62)}0a`) };
      }
      return { ok: true, json: async () => ({ error: { message: 'unexpected' } }) };
    }));

    const r = await readNftBalance('ethereum', CONTRACT, OWNER, { tokenId: 7 });
    expect(r.standard).toBe('ERC-1155');
    expect(r.balance).toBe(10n);
    expect(r.tokenId).toBe(7);
    expect(r.note).toMatch(/per token id/i);
  });

  it('says so when a contract declares no NFT interface', async () => {
    stubRpc({
      [SELECTORS.supportsInterface]: ok(`0x${'0'.repeat(64)}`) // always false
    });
    const r = await readNftBalance('ethereum', CONTRACT, OWNER);
    expect(r.standard).toBe('not-nft');
    expect(r.error).toMatch(/does not declare ERC-721 or ERC-1155/);
    // It must not overclaim: an older collection may predate ERC-165.
    expect(r.note).toMatch(/not proof/i);
  });

  it('surfaces a failed balanceOf rather than reporting zero', async () => {
    stubRpc({
      [SELECTORS.supportsInterface]: ok(`0x${'0'.repeat(63)}1`)
      // balanceOf deliberately unstubbed → error
    });
    const r = await readNftBalance('ethereum', CONTRACT, OWNER);
    expect(r.balance).toBeNull();
    expect(r.error).toBeTruthy();
  });
});
