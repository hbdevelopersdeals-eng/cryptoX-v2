import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_TYPES, NORMAL_BALANCE, CURRENCY_DECIMALS,
  toMinor, fromMinor, createAccount, createLedger, addAccount, accountById,
  postTransaction, reverseTransaction, balanceOf, trialBalance,
  reconcile, explainTransaction, auditLedger, createPlatformLedger
} from './ledger.js';

/* Section 48 — the ledger is the record; a balance is derived from it. */

function fixture() {
  const { ledger, accounts } = createPlatformLedger({ currency: 'USD' });
  return { ledger, accounts };
}

const grand = (ledger, tx) => {
  // Every posted transaction must be internally balanced, always.
  const d = tx.entries.filter((e) => e.direction === 'debit').reduce((a, e) => a + e.amountMinor, 0);
  const c = tx.entries.filter((e) => e.direction === 'credit').reduce((a, e) => a + e.amountMinor, 0);
  expect(d, `${tx.id} debits vs credits`).toBe(c);
  void ledger;
};

describe('ledger: money is never a float', () => {
  it('converts to integer minor units per currency', () => {
    expect(toMinor(10, 'USD')).toMatchObject({ ok: true, minor: 1000 });
    expect(toMinor(1234.56, 'USD')).toMatchObject({ ok: true, minor: 123456 });
    expect(toMinor(1000, 'JPY')).toMatchObject({ ok: true, minor: 1000 });   // no minor unit
    expect(toMinor(1.234, 'KWD')).toMatchObject({ ok: true, minor: 1234 });  // three decimals
    expect(toMinor(1.00000001, 'BTC')).toMatchObject({ ok: true, minor: 100000001 });
  });

  it('refuses a value the currency cannot represent instead of rounding it', () => {
    // 12.005 USD is 1200 or 1201 cents and guessing is how a cent disappears.
    expect(toMinor(12.005, 'USD').reason).toBe('not_integer');
    expect(toMinor(1.5, 'JPY').reason).toBe('not_integer');
    expect(toMinor(1.2345, 'KWD').reason).toBe('not_integer');
    expect(toMinor(5, 'XYZ').reason).toBe('unknown_currency');
  });

  it('round-trips every declared currency', () => {
    for (const [code, decimals] of Object.entries(CURRENCY_DECIMALS)) {
      const sample = decimals === 0 ? 7 : 12.5;
      const { minor } = toMinor(sample, code);
      expect(fromMinor(minor, code), code).toBeCloseTo(sample, decimals);
    }
  });

  it('does not accumulate error over many postings', () => {
    // 0.1 + 0.2 !== 0.3 in floats; over 10000 postings the drift is visible.
    const { ledger, accounts } = fixture();
    for (let i = 0; i < 10_000; i += 1) {
      postTransaction(ledger, {
        entries: [
          { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 0.1 },
          { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 0.1 }
        ]
      });
    }
    const cash = balanceOf(ledger, accounts.assets.Cash.id);
    // 10,000 x $0.10 is exactly $1000.00 = 100,000 cents, with no drift.
    expect(cash.debitMinor).toBe(100000);
    expect(cash.amount).toBe(1000);
  });
});

describe('ledger: accounts carry their normal balance', () => {
  it('declares the type vocabulary and which side increases each', () => {
    expect(NORMAL_BALANCE.asset).toBe('debit');
    expect(NORMAL_BALANCE.expense).toBe('debit');
    expect(NORMAL_BALANCE.liability).toBe('credit');
    expect(NORMAL_BALANCE.equity).toBe('credit');
    expect(NORMAL_BALANCE.revenue).toBe('credit');
    for (const type of ACCOUNT_TYPES) expect(NORMAL_BALANCE[type], type).toBeTruthy();
  });

  it('refuses an account with an unknown type or currency', () => {
    expect(createAccount({ name: 'X', type: 'made_up', currency: 'USD' }).missing).toContain('type');
    expect(createAccount({ name: 'X', type: 'asset', currency: 'XYZ' }).missing).toContain('currency');
    expect(createAccount({ type: 'asset', currency: 'USD' }).missing).toContain('name');
    const ok = createAccount({ name: 'Cash', type: 'asset', currency: 'USD' });
    expect(ok.account.normalBalance).toBe('debit');
  });

  it('refuses a duplicate account rather than shadowing it', () => {
    const ledger = createLedger();
    const a = createAccount({ id: 'a1', name: 'Cash', type: 'asset', currency: 'USD' }).account;
    expect(addAccount(ledger, a).ok).toBe(true);
    expect(addAccount(ledger, a).reason).toBe('duplicate-account');
    expect(ledger.accounts).toHaveLength(1);
  });
});

describe('ledger: a transaction must balance', () => {
  it('accepts a balanced posting', () => {
    const { ledger, accounts } = fixture();
    const res = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 49 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 49 }
      ],
      memo: 'Pro plan, October'
    });
    expect(res.ok).toBe(true);
    expect(res.transaction.totalMinor).toBe(4900);
    grand(ledger, res.transaction);
  });

  it('refuses an unbalanced posting, and says by how much', () => {
    const { ledger, accounts } = fixture();
    const res = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 100 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 90 }
      ]
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unbalanced');
    expect(res.detail).toMatchObject({ debitsMinor: 10000, creditsMinor: 9000, differenceMinor: 1000 });
    // Nothing is posted when validation fails.
    expect(ledger.transactions).toHaveLength(0);
  });

  it('refuses fewer than two entries', () => {
    const { ledger, accounts } = fixture();
    const res = postTransaction(ledger, {
      entries: [{ accountId: accounts.assets.Cash.id, direction: 'debit', amount: 1 }]
    });
    expect(res.reason).toBe('too_few_entries');
  });

  it('refuses an entry against an account that does not exist', () => {
    const { ledger, accounts } = fixture();
    const res = postTransaction(ledger, {
      entries: [
        { accountId: 'nope', direction: 'debit', amount: 1 },
        { accountId: accounts.assets.Cash.id, direction: 'credit', amount: 1 }
      ]
    });
    expect(res.reason).toBe('unknown_account');
  });

  it('refuses a mixed-currency transaction', () => {
    // A EUR debit against a USD credit has no single meaning.
    const ledger = createLedger();
    const usd = createAccount({ name: 'USD cash', type: 'asset', currency: 'USD' }).account;
    const eur = createAccount({ name: 'EUR cash', type: 'asset', currency: 'EUR' }).account;
    addAccount(ledger, usd);
    addAccount(ledger, eur);
    const res = postTransaction(ledger, {
      entries: [
        { accountId: usd.id, direction: 'debit', amount: 100 },
        { accountId: eur.id, direction: 'credit', amount: 100 }
      ]
    });
    expect(res.reason).toBe('mixed_currency');
    expect(res.detail.currencies.sort()).toEqual(['EUR', 'USD']);
  });

  it('refuses a zero or negative amount', () => {
    const { ledger, accounts } = fixture();
    const post = (amount) => postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount }
      ]
    });
    expect(post(0).reason).toBe('non_positive');
    expect(post(-5).reason).toBe('non_positive');
    expect(ledger.transactions).toHaveLength(0);
  });

  it('accepts a half-dollar but refuses sub-cent precision', () => {
    // 1.5 USD is $1.50 and perfectly representable; 1.005 is not, and rounding
    // it silently is how a fraction of a cent disappears on every posting.
    const { ledger, accounts } = fixture();
    const post = (amount) => postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount }
      ]
    });
    const half = post(1.5);
    expect(half.ok).toBe(true);
    expect(half.transaction.totalMinor).toBe(150);
    expect(post(1.005).reason).toBe('not_integer');
  });

  it('refuses a fractional amount for a zero-decimal currency', () => {
    // JPY has no minor unit at all, so 1.5 yen does not exist.
    const ledger = createLedger();
    const jpy = createAccount({ name: 'JPY cash', type: 'asset', currency: 'JPY' }).account;
    const revenue = createAccount({ name: 'JPY revenue', type: 'revenue', currency: 'JPY' }).account;
    addAccount(ledger, jpy);
    addAccount(ledger, revenue);
    const res = postTransaction(ledger, {
      entries: [
        { accountId: jpy.id, direction: 'debit', amount: 1.5 },
        { accountId: revenue.id, direction: 'credit', amount: 1.5 }
      ]
    });
    expect(res.reason).toBe('not_integer');
  });

  it('refuses an entry whose unit is ambiguous or missing', () => {
    // The unit is stated, never inferred: `amount` alone is major units, and
    // giving both forms (or neither) is refused rather than guessed.
    const { ledger, accounts } = fixture();
    const both = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 5, amountMinor: 500 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 5, amountMinor: 500 }
      ]
    });
    expect(both.reason).toBe('ambiguous_amount');

    const neither = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit' },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit' }
      ]
    });
    expect(neither.reason).toBe('ambiguous_amount');
  });

  it('accepts amountMinor as exact minor units', () => {
    // 49 major units and 4900 minor units are the same amount, stated twice.
    const { ledger, accounts } = fixture();
    const res = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amountMinor: 4900 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amountMinor: 4900 }
      ]
    });
    expect(res.ok).toBe(true);
    expect(res.transaction.totalMinor).toBe(4900);
    expect(res.transaction.total).toBe(49);
    expect(balanceOf(ledger, accounts.assets.Cash.id).amountMinor ?? balanceOf(ledger, accounts.assets.Cash.id).balanceMinor).toBe(4900);
  });
});

describe('ledger: idempotency', () => {
  const posting = (accounts) => ({
    entries: [
      { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 10 },
      { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 10 }
    ],
    idempotencyKey: 'charge_evt_1'
  });

  it('a retry with the same key posts once and returns the original', () => {
    // Retries are normal on a network; a double credit is not acceptable.
    const { ledger, accounts } = fixture();
    const first = postTransaction(ledger, posting(accounts));
    const second = postTransaction(ledger, posting(accounts));
    expect(first.replay).toBe(false);
    expect(second.replay).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(ledger.transactions).toHaveLength(1);
  });

  it('reusing a key for a DIFFERENT movement is refused, not silently dropped', () => {
    const { ledger, accounts } = fixture();
    postTransaction(ledger, { ...posting(accounts), idempotencyKey: 'shared_key' });
    const res = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 999 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 999 }
      ],
      idempotencyKey: 'shared_key'
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('duplicate_idempotency');
    expect(ledger.transactions).toHaveLength(1);
  });

  it('treats a different entry ORDER as the same movement', () => {
    const { ledger, accounts } = fixture();
    postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 10 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 10 }
      ],
      idempotencyKey: 'k'
    });
    const again = postTransaction(ledger, {
      entries: [
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 10 },
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 10 }
      ],
      idempotencyKey: 'k'
    });
    expect(again.replay).toBe(true);
    expect(ledger.transactions).toHaveLength(1);
  });

  it('without a key, two identical postings are two postings', () => {
    const { ledger, accounts } = fixture();
    const { idempotencyKey, ...rest } = posting(accounts);
    void idempotencyKey;
    postTransaction(ledger, rest);
    postTransaction(ledger, rest);
    expect(ledger.transactions).toHaveLength(2);
  });
});

describe('ledger: reversal is a compensating transaction', () => {
  it('reverses by mirroring, leaving the original intact', () => {
    const { ledger, accounts } = fixture();
    const original = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 49 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 49 }
      ],
      memo: 'Pro plan'
    }).transaction;

    const reversal = reverseTransaction(ledger, original.id, { reason: 'customer cancelled' });
    expect(reversal.ok).toBe(true);
    expect(reversal.transaction.reversalOf).toBe(original.id);
    expect(reversal.transaction.memo).toMatch(/customer cancelled/);

    // The original is still present and unchanged.
    expect(ledger.transactions).toHaveLength(2);
    expect(ledger.transactions.find((t) => t.id === original.id).totalMinor).toBe(4900);

    // And the pair nets to zero.
    expect(balanceOf(ledger, accounts.assets.Cash.id).balanceMinor).toBe(0);
    expect(balanceOf(ledger, accounts.revenue['Subscription revenue'].id).balanceMinor).toBe(0);
    expect(auditLedger(ledger).ok).toBe(true);
  });

  it('reversing twice returns the original reversal rather than a third entry', () => {
    const { ledger, accounts } = fixture();
    const original = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 10 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 10 }
      ]
    }).transaction;
    const first = reverseTransaction(ledger, original.id);
    const second = reverseTransaction(ledger, original.id);
    expect(second.replay).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(ledger.transactions).toHaveLength(2);
  });

  it('refuses to reverse a reversal', () => {
    const { ledger, accounts } = fixture();
    const original = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 10 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 10 }
      ]
    }).transaction;
    const reversal = reverseTransaction(ledger, original.id).transaction;
    expect(reverseTransaction(ledger, reversal.id).reason).toBe('cannot-reverse-a-reversal');
  });

  it('refuses to reverse an unknown transaction', () => {
    const { ledger } = fixture();
    expect(reverseTransaction(ledger, 'txn_nope').reason).toBe('unknown-transaction');
  });

  it('posted transactions are frozen, so history cannot be edited in place', () => {
    const { ledger, accounts } = fixture();
    const tx = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 10 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 10 }
      ]
    }).transaction;
    expect(() => { tx.totalMinor = 999999; }).toThrow();
    expect(() => { tx.entries[0].amountMinor = 1; }).toThrow();
    expect(tx.totalMinor).toBe(1000);
  });
});

describe('ledger: balances are derived, not stored', () => {
  it('computes the natural balance for each account type', () => {
    const { ledger, accounts } = fixture();
    postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 100 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 100 }
      ]
    });

    // An asset rises on the debit side; revenue rises on the credit side.
    const cash = balanceOf(ledger, accounts.assets.Cash.id);
    expect(cash).toMatchObject({ debitMinor: 10000, creditMinor: 0, balanceMinor: 10000, amount: 100, contra: false });

    const revenue = balanceOf(ledger, accounts.revenue['Subscription revenue'].id);
    expect(revenue).toMatchObject({ debitMinor: 0, creditMinor: 10000, balanceMinor: 10000, amount: 100, contra: false });

    // A contra balance is surfaced, not hidden behind a sign.
    const refund = postTransaction(ledger, {
      entries: [
        { accountId: accounts.expenses['Refunds and chargebacks'].id, direction: 'debit', amount: 30 },
        { accountId: accounts.assets.Cash.id, direction: 'credit', amount: 30 }
      ]
    });
    expect(refund.ok).toBe(true);
    expect(balanceOf(ledger, accounts.assets.Cash.id).balanceMinor).toBe(7000);
    expect(balanceOf(ledger, accounts.expenses['Refunds and chargebacks'].id).balanceMinor).toBe(3000);
  });

  it('supports an as-of balance for a point in time', () => {
    const { ledger, accounts } = fixture();
    const before = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 10 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 10 }
      ],
      at: new Date('2026-01-01T00:00:00Z')
    });
    const after = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 25 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 25 }
      ],
      at: new Date('2026-06-01T00:00:00Z')
    });
    expect(before.ok && after.ok).toBe(true);

    expect(balanceOf(ledger, accounts.assets.Cash.id, { asOf: '2026-03-01T00:00:00Z' }).amount).toBe(10);
    expect(balanceOf(ledger, accounts.assets.Cash.id, { asOf: '2026-12-01T00:00:00Z' }).amount).toBe(35);
    // A point before anything happened is zero, not undefined.
    expect(balanceOf(ledger, accounts.assets.Cash.id, { asOf: '2025-01-01T00:00:00Z' }).amount).toBe(0);
  });

  it('returns null for an unknown account rather than a zero balance', () => {
    const { ledger } = fixture();
    expect(balanceOf(ledger, 'nope')).toBeNull();
  });
});

describe('ledger: trial balance and integrity', () => {
  it('balances across a mixed set of postings', () => {
    const { ledger, accounts } = fixture();
    postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets['Payment processor clearing'].id, direction: 'debit', amount: 121 },
        { accountId: accounts.liabilities['Customer balances payable'].id, direction: 'credit', amount: 100 },
        { accountId: accounts.liabilities['Tax payable'].id, direction: 'credit', amount: 21 }
      ],
      memo: 'Subscription + VAT'
    });
    postTransaction(ledger, {
      entries: [
        { accountId: accounts.expenses['Payment processing fees'].id, direction: 'debit', amount: 3 },
        { accountId: accounts.assets['Payment processor clearing'].id, direction: 'credit', amount: 3 }
      ]
    });

    const trial = trialBalance(ledger);
    expect(trial.balanced).toBe(true);
    expect(trial.differenceMinor).toBe(0);
    expect(trial.transactions).toBe(2);
    expect(trial.accounts.length).toBe(ledger.accounts.length);
  });

  it('an empty ledger is balanced', () => {
    const { ledger } = fixture();
    const trial = trialBalance(ledger);
    expect(trial).toMatchObject({ transactions: 0, debitMinor: 0, creditMinor: 0, balanced: true, differenceMinor: 0 });
  });

  it('audits a healthy ledger clean, and would catch a corrupted one', () => {
    const { ledger, accounts } = fixture();
    postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 10 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 10 }
      ]
    });
    const clean = auditLedger(ledger);
    expect(clean).toMatchObject({ ok: true, problems: [] });
    expect(clean.transactions).toBe(1);

    // Corrupt the ledger the way a bug would, by pushing an unbalanced entry
    // past the posting API.
    ledger.transactions.push({ id: 'txn_bad', at: new Date().toISOString(), entries: [{ accountId: accounts.assets.Cash.id, direction: 'debit', amountMinor: 500 }], totalMinor: 500 });
    const dirty = auditLedger(ledger);
    expect(dirty.ok).toBe(false);
    expect(dirty.problems.map((p) => p.reason)).toEqual(
      expect.arrayContaining(['too-few-entries', 'unbalanced', 'trial-balance-off'])
    );
  });
});

describe('ledger: reconciliation', () => {
  it('matches an exact external figure', () => {
    const { ledger, accounts } = fixture();
    postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets['Payment processor clearing'].id, direction: 'debit', amount: 100 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 100 }
      ]
    });
    const res = reconcile({ ledger, accountId: accounts.assets['Payment processor clearing'].id, externalMinor: 10000 });
    expect(res).toMatchObject({ ok: true, matches: true, differenceMinor: 0, cause: 'exact-match' });
  });

  it('names the direction of a mismatch', () => {
    const { ledger, accounts } = fixture();
    postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 100 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 100 }
      ]
    });
    const ahead = reconcile({ ledger, accountId: accounts.assets.Cash.id, externalMinor: 9000 });
    expect(ahead).toMatchObject({ matches: false, differenceMinor: 1000, cause: 'ledger-ahead' });

    const behind = reconcile({ ledger, accountId: accounts.assets.Cash.id, externalMinor: 11000 });
    expect(behind).toMatchObject({ matches: false, differenceMinor: -1000, cause: 'ledger-behind' });
  });

  it('honours a tolerance and reports it as such', () => {
    const { ledger, accounts } = fixture();
    postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 100 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 100 }
      ]
    });
    expect(reconcile({ ledger, accountId: accounts.assets.Cash.id, externalMinor: 9999, toleranceMinor: 1 }))
      .toMatchObject({ matches: true, cause: 'within-tolerance', differenceMinor: 1 });
  });

  it('refuses a non-integer external figure rather than comparing loosely', () => {
    const { ledger, accounts } = fixture();
    expect(reconcile({ ledger, accountId: accounts.assets.Cash.id, externalMinor: 99.5 }).reason).toBe('external-not-integer-minor');
    expect(reconcile({ ledger, accountId: 'nope', externalMinor: 0 }).reason).toBe('unknown-account');
  });
});

describe('ledger: audit view', () => {
  it('explains a transaction with both sides and a signed amount', () => {
    const { ledger, accounts } = fixture();
    const tx = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 121 },
        { accountId: accounts.liabilities['Customer balances payable'].id, direction: 'credit', amount: 100 },
        { accountId: accounts.liabilities['Tax payable'].id, direction: 'credit', amount: 21 }
      ],
      memo: 'Top-up',
      source: 'provider-api'
    }).transaction;

    const view = explainTransaction(ledger, tx.id);
    expect(view).toMatchObject({ id: tx.id, memo: 'Top-up', source: 'provider-api', currency: 'USD', total: 121 });
    expect(view.movements).toHaveLength(3);
    const cash = view.movements.find((m) => m.accountName === 'Cash');
    expect(cash).toMatchObject({ direction: 'debit', signedMinor: 12100, accountType: 'asset' });
    const tax = view.movements.find((m) => m.accountName === 'Tax payable');
    expect(tax.signedMinor).toBe(-2100);
    // Debits minus credits must be zero — the same invariant, read from the view.
    expect(view.movements.reduce((a, m) => a + m.signedMinor, 0)).toBe(0);
  });

  it('returns null for an unknown transaction', () => {
    const { ledger } = fixture();
    expect(explainTransaction(ledger, 'nope')).toBeNull();
  });

  it('records what caused a movement, so a refund chain is traceable', () => {
    const { ledger, accounts } = fixture();
    const charge = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets.Cash.id, direction: 'debit', amount: 49 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 49 }
      ],
      source: 'webhook-verified'
    }).transaction;
    const reversal = reverseTransaction(ledger, charge.id, { reason: 'dispute' }).transaction;
    const view = explainTransaction(ledger, reversal.id);
    expect(view.causedBy).toBe(charge.id);
    expect(view.reversalOf).toBe(charge.id);
  });
});

describe('ledger: the platform chart', () => {
  it('creates the accounts a platform actually needs, in one currency', () => {
    const { ledger, accounts } = createPlatformLedger({ currency: 'USD' });
    expect(ledger.accounts).toHaveLength(11);
    for (const group of ['assets', 'liabilities', 'equity', 'revenue', 'expenses']) {
      expect(Object.keys(accounts[group]).length, group).toBeGreaterThan(0);
    }
    for (const account of ledger.accounts) {
      expect(account.currency).toBe('USD');
      expect(ACCOUNT_TYPES).toContain(account.type);
      expect(account.normalBalance).toBe(NORMAL_BALANCE[account.type]);
    }
  });

  it('models a subscription with tax end to end', () => {
    const { ledger, accounts } = createPlatformLedger();
    // Customer pays 121: 100 revenue, 21 tax. Cash and clearing both move.
    const payment = postTransaction(ledger, {
      entries: [
        { accountId: accounts.assets['Payment processor clearing'].id, direction: 'debit', amount: 121 },
        { accountId: accounts.liabilities['Customer balances payable'].id, direction: 'credit', amount: 121 }
      ],
      memo: 'Customer top-up',
      idempotencyKey: 'topup_1'
    });
    expect(payment.ok).toBe(true);

    const earned = postTransaction(ledger, {
      entries: [
        { accountId: accounts.liabilities['Customer balances payable'].id, direction: 'debit', amount: 121 },
        { accountId: accounts.revenue['Subscription revenue'].id, direction: 'credit', amount: 100 },
        { accountId: accounts.liabilities['Tax payable'].id, direction: 'credit', amount: 21 }
      ],
      memo: 'Revenue recognised'
    });
    expect(earned.ok).toBe(true);

    expect(balanceOf(ledger, accounts.liabilities['Tax payable'].id).amount).toBe(21);
    expect(balanceOf(ledger, accounts.revenue['Subscription revenue'].id).amount).toBe(100);
    expect(trialBalance(ledger).balanced).toBe(true);
    expect(auditLedger(ledger).ok).toBe(true);
    expect(accountById(ledger, accounts.assets.Cash.id).name).toBe('Cash');
  });
});
