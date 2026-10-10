/* Double-entry financial ledger (Section 48).
 *
 * The brief is explicit: do not store `balance = 1000`. A balance column is
 * a cache that can be wrong and cannot be checked; a ledger is the record and
 * the balance is derived from it.
 *
 *    Account → Ledger → Transactions → Debit/Credit entries → Balance
 *
 * Five properties this module exists to guarantee, and the specific way each
 * one is enforced:
 *
 *   1. Traceable     — every entry names the transaction and account it belongs
 *                      to, and the transaction names what caused it.
 *   2. Balanced      — every transaction is checked so total debits equal total
 *                      credits IN THE SAME CURRENCY before it is accepted. An
 *                      unbalanced transaction is not a rounding problem, it is
 *                      value appearing from nowhere.
 *   3. Idempotent    — a repeated post with the same key returns the original
 *                      transaction instead of posting a second one. Retries are
 *                      normal on a network; double credits are not acceptable.
 *   4. Reversible    — only through a COMPENSATING transaction. Nothing here
 *                      mutates or deletes a posted entry, so a reversal is
 *                      itself auditable and the history stays complete.
 *   5. Reconcilable  — a trial balance over the whole ledger, plus a
 *                      reconciliation against an external statement.
 *
 * AMOUNTS ARE INTEGER MINOR UNITS. 1000 USD is 100000. Floating-point money
 * accumulates error that no amount of rounding afterwards can undo, and a
 * ledger that disagrees with itself by a cent is worse than one that is
 * obviously broken.
 *
 * THE UNIT IS ALWAYS EXPLICIT, NEVER INFERRED FROM THE TYPE. An entry says
 * `amountMinor: 4900` (minor units, an integer) or `amount: 49` (major units,
 * a decimal) — never a bare number whose meaning depends on whether it happens
 * to have a decimal point. Inferring it was a real defect here: `amount: 49`
 * was read as 49 cents, so a $49 charge posted as $0.49 with no error at all.
 * Every figure the module RETURNS is suffixed `Minor` when it is in minor
 * units; the bare name is the decimal a user reads.
 */

/* ------------------------------------------------------------- account types */

/*
 * The normal balance decides which side INCREASES an account. An asset rises on
 * the debit side; a liability rises on the credit side. Getting this backwards
 * inverts every balance and every report, so it is declared once, here.
 */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export const NORMAL_BALANCE = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit'
};

/** Currencies supported for exact arithmetic: code → minor-unit exponent. */
export const CURRENCY_DECIMALS = {
  USD: 2, EUR: 2, GBP: 2, JPY: 0, KRW: 0, KWD: 3, BHD: 3, CLF: 4, BTC: 8, ETH: 18
};

/* ------------------------------------------------------------------- errors */

export const LEDGER_ERRORS = {
  unknown_account: 'An entry names an account that does not exist.',
  unknown_currency: 'The currency has no declared minor unit.',
  too_few_entries: 'A transaction needs at least two entries.',
  unbalanced: 'Total debits do not equal total credits.',
  mixed_currency: 'Every entry in one transaction must be in the same currency.',
  non_positive: 'An entry amount must be a positive integer in minor units.',
  not_integer: 'Amounts must be integer minor units, never fractional.',
  duplicate_idempotency: 'This idempotency key was already used for a different transaction.',
  immutable: 'A posted transaction cannot be modified.',
  same_account: 'Both sides of a transaction cannot be the same account.',
  ambiguous_amount: 'Give either amountMinor (minor units) or amount (major units), never both and never neither.'
};

const fail = (reason, detail) => ({ ok: false, reason, message: LEDGER_ERRORS[reason], detail });

/* --------------------------------------------------------------- accounting */

/**
 * Convert a decimal amount to integer minor units.
 * Deliberately strict: 12.005 in a 2-decimal currency is 1200 or 1201, and
 * guessing is how a cent goes missing.
 */
export function toMinor(amount, currency) {
  const decimals = CURRENCY_DECIMALS[currency];
  if (decimals == null) return { ok: false, reason: 'unknown_currency' };
  const n = Number(amount);
  if (!Number.isFinite(n)) return { ok: false, reason: 'not_integer' };
  const scaled = n * 10 ** decimals;
  const rounded = Math.round(scaled);
  // Reject a value that is not representable at this precision rather than
  // silently rounding it away.
  if (Math.abs(scaled - rounded) > 1e-6) {
    return { ok: false, reason: 'not_integer', detail: `${amount} ${currency} has more than ${decimals} decimal places.` };
  }
  return { ok: true, minor: rounded, currency, decimals };
}

export const fromMinor = (minor, currency) => {
  const decimals = CURRENCY_DECIMALS[currency];
  if (decimals == null) return null;
  return minor / 10 ** decimals;
};

/* ----------------------------------------------------------------- accounts */

let accountSeq = 0;
export function createAccount({ name, type, currency, ownerId = null, id = null } = {}) {
  const errors = [];
  if (!name) errors.push('name');
  if (!ACCOUNT_TYPES.includes(type)) errors.push('type');
  if (CURRENCY_DECIMALS[currency] == null) errors.push('currency');
  if (errors.length) return { ok: false, reason: 'invalid-account', missing: errors };

  return {
    ok: true,
    account: Object.freeze({
      id: id || `acct_${(accountSeq += 1)}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      type,
      currency,
      ownerId,
      normalBalance: NORMAL_BALANCE[type]
    })
  };
}

/** A chart of accounts, so an entry can be checked against a real account. */
export function createLedger({ accounts = [] } = {}) {
  return {
    accounts: [...accounts],
    transactions: [],
    /** idempotency key → transaction id */
    posted: new Map()
  };
}

export const accountById = (ledger, id) => ledger.accounts.find((a) => a.id === id) || null;

export function addAccount(ledger, account) {
  if (!account) return { ok: false, reason: 'invalid-account' };
  const existing = ledger.accounts.find((a) => a.id === account.id);
  if (existing) return { ok: false, reason: 'duplicate-account', account: existing };
  ledger.accounts.push(account);
  return { ok: true, account };
}

/* ------------------------------------------------------------- transactions */

let txSeq = 0;

/**
 * Post a transaction.
 *
 * `entries` is a list of { accountId, direction: 'debit'|'credit', amount }.
 * `amount` may be a minor-unit integer or a decimal string/number, in which
 * case it is converted using the account's currency.
 */
export function postTransaction(ledger, {
  entries = [],
  at = new Date(),
  memo = '',
  idempotencyKey = null,
  source = 'manual',
  causedBy = null
} = {}) {
  // Idempotency is checked FIRST: a retry of an already-accepted post must be
  // a no-op, not a second posting.
  if (idempotencyKey) {
    const prior = ledger.posted.get(idempotencyKey);
    if (prior) {
      const tx = ledger.transactions.find((t) => t.id === prior);
      if (!tx) return fail('duplicate_idempotency', { idempotencyKey });
      // The same key must describe the same movement, or a caller has reused a
      // key for a different payment and would silently lose it.
      if (tx.fingerprint !== fingerprintOf(entries)) {
        return fail('duplicate_idempotency', { idempotencyKey });
      }
      return { ok: true, transaction: tx, replay: true };
    }
  }

  if (!Array.isArray(entries) || entries.length < 2) return fail('too_few_entries', { count: entries?.length ?? 0 });

  const normalised = [];
  for (const entry of entries) {
    const account = accountById(ledger, entry?.accountId);
    if (!account) return fail('unknown_account', { accountId: entry?.accountId });
    if (entry.direction !== 'debit' && entry.direction !== 'credit') return fail('invalid-account', { direction: entry.direction });

    // The unit is stated, not inferred. A bare `amount` is major units.
    const hasMinor = entry.amountMinor != null;
    const hasMajor = entry.amount != null;
    if (hasMinor === hasMajor) return fail('ambiguous_amount', { entry });

    let minor;
    if (hasMinor) {
      if (!Number.isInteger(entry.amountMinor)) return fail('not_integer', { amountMinor: entry.amountMinor });
      minor = entry.amountMinor;
    } else {
      const converted = toMinor(entry.amount, account.currency);
      if (!converted.ok) return fail(converted.reason, converted.detail);
      minor = converted.minor;
    }
    if (minor <= 0) return fail('non_positive', { minor });

    normalised.push({ accountId: account.id, direction: entry.direction, amountMinor: minor, currency: account.currency });
  }

  const currencies = new Set(normalised.map((e) => e.currency));
  if (currencies.size > 1) return fail('mixed_currency', { currencies: [...currencies] });

  // The core invariant. Not a warning: an unbalanced transaction invents value.
  const debits = normalised.filter((e) => e.direction === 'debit').reduce((a, e) => a + e.amountMinor, 0);
  const credits = normalised.filter((e) => e.direction === 'credit').reduce((a, e) => a + e.amountMinor, 0);
  if (debits !== credits) return fail('unbalanced', { debitsMinor: debits, creditsMinor: credits, differenceMinor: debits - credits, currency: [...currencies][0] });

  const transaction = Object.freeze({
    id: `txn_${(txSeq += 1)}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date(at).toISOString(),
    memo,
    source,
    causedBy,
    currency: [...currencies][0],
    entries: Object.freeze(normalised.map((e) => Object.freeze({ ...e }))),
    totalMinor: debits,
    total: fromMinor(debits, [...currencies][0]),
    // A stable digest of the movement, so a reused idempotency key can be
    // detected as describing something different.
    fingerprint: fingerprintOf(entries),
    reversalOf: null,
    immutable: true
  });

  ledger.transactions.push(transaction);
  if (idempotencyKey) ledger.posted.set(idempotencyKey, transaction.id);
  return { ok: true, transaction, replay: false };
}

/** Order-independent digest of the movement described by a set of entries. */
function fingerprintOf(entries = []) {
  return (entries || [])
    .map((e) => `${e.accountId}:${e.direction}:${e.amountMinor != null ? e.amountMinor : Number(e.amount)}`)
    .sort()
    .join('|');
}

/**
 * Reverse a transaction by posting its mirror image.
 *
 * Nothing is deleted or edited: the original stays, the reversal is a new
 * transaction that names it, and the pair nets to zero. That is the only form
 * of reversal that leaves an auditable trail.
 */
export function reverseTransaction(ledger, transactionId, { at = new Date(), reason = '', idempotencyKey = null } = {}) {
  const original = ledger.transactions.find((t) => t.id === transactionId);
  if (!original) return { ok: false, reason: 'unknown-transaction' };
  if (original.reversalOf) return { ok: false, reason: 'cannot-reverse-a-reversal' };

  const existing = ledger.transactions.find((t) => t.reversalOf === transactionId);
  if (existing) return { ok: true, transaction: existing, replay: true };

  const mirrored = original.entries.map((e) => ({
    accountId: e.accountId,
    direction: e.direction === 'debit' ? 'credit' : 'debit',
    amountMinor: e.amountMinor
  }));

  const res = postTransaction(ledger, {
    entries: mirrored,
    at,
    memo: reason ? `Reversal: ${reason}` : `Reversal of ${original.id}`,
    source: 'reversal',
    causedBy: original.id,
    idempotencyKey
  });
  if (!res.ok) return res;

  // Mark the link on a copy in the list; the frozen transaction itself is not
  // rewritten — `reversalOf` on the reversal is the authoritative link.
  const index = ledger.transactions.findIndex((t) => t.id === res.transaction.id);
  const linked = Object.freeze({ ...res.transaction, reversalOf: original.id });
  ledger.transactions[index] = linked;
  return { ok: true, transaction: linked, replay: res.replay };
}

/* ---------------------------------------------------------------- balances */

/**
 * An account's balance in minor units, and its natural-direction balance.
 *
 * The raw debit/credit totals are both returned: a liability with a debit
 * balance is an anomaly worth seeing, not one to hide behind a signed number.
 */
export function balanceOf(ledger, accountId, { asOf = null } = {}) {
  const account = accountById(ledger, accountId);
  if (!account) return null;

  let debitMinor = 0;
  let creditMinor = 0;
  for (const tx of ledger.transactions) {
    if (asOf && new Date(tx.at) > new Date(asOf)) continue;
    for (const entry of tx.entries) {
      if (entry.accountId !== accountId) continue;
      if (entry.direction === 'debit') debitMinor += entry.amountMinor;
      else creditMinor += entry.amountMinor;
    }
  }

  const normal = account.normalBalance;
  const balanceMinor = normal === 'debit' ? debitMinor - creditMinor : creditMinor - debitMinor;
  return {
    accountId,
    currency: account.currency,
    // The Minor figures are authoritative; the decimals are the same integers
    // rendered for display, so the two can never disagree.
    debitMinor,
    creditMinor,
    debit: fromMinor(debitMinor, account.currency),
    credit: fromMinor(creditMinor, account.currency),
    /** Positive when the account is on the side its type expects. */
    balanceMinor,
    balance: fromMinor(balanceMinor, account.currency),
    amount: fromMinor(balanceMinor, account.currency),
    /** True when the account sits opposite its normal balance. */
    contra: balanceMinor < 0
  };
}

/**
 * Trial balance: total debits must equal total credits across the whole ledger.
 * If this ever fails, the ledger is corrupt and no balance from it is usable.
 */
export function trialBalance(ledger, { asOf = null } = {}) {
  let debitMinor = 0;
  let creditMinor = 0;
  let transactions = 0;

  for (const tx of ledger.transactions) {
    if (asOf && new Date(tx.at) > new Date(asOf)) continue;
    transactions += 1;
    for (const entry of tx.entries) {
      if (entry.direction === 'debit') debitMinor += entry.amountMinor;
      else creditMinor += entry.amountMinor;
    }
  }

  return {
    transactions,
    debitMinor,
    creditMinor,
    balanced: debitMinor === creditMinor,
    differenceMinor: debitMinor - creditMinor,
    accounts: ledger.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      ...balanceOf(ledger, a.id, { asOf })
    }))
  };
}

/* ----------------------------------------------------------- reconciliation */

/**
 * Reconcile the ledger against an external statement.
 *
 * The external figure is the authority for what actually happened at the bank
 * or the processor; the ledger is the authority for what we recorded. A
 * difference is not automatically an error in the ledger, but it must be
 * explained before anyone relies on the balance.
 */
export function reconcile({ ledger, accountId, externalMinor, asOf = null, toleranceMinor = 0 } = {}) {
  const internal = balanceOf(ledger, accountId, { asOf });
  if (!internal) return { ok: false, reason: 'unknown-account' };
  if (!Number.isInteger(externalMinor)) return { ok: false, reason: 'external-not-integer-minor' };
  if (!Number.isInteger(toleranceMinor) || toleranceMinor < 0) return { ok: false, reason: 'tolerance-not-minor' };

  const ledgerMinor = internal.debitMinor - internal.creditMinor;
  const differenceMinor = ledgerMinor - externalMinor;
  const matches = Math.abs(differenceMinor) <= toleranceMinor;

  return {
    ok: true,
    accountId,
    currency: internal.currency,
    ledgerMinor,
    externalMinor,
    differenceMinor,
    matches,
    // Named, because "it doesn't reconcile" is not actionable on its own.
    cause: matches
      ? differenceMinor === 0 ? 'exact-match' : 'within-tolerance'
      : differenceMinor > 0 ? 'ledger-ahead' : 'ledger-behind'
  };
}

/* -------------------------------------------------------------------- audit */

/**
 * A movement's own audit view: what happened, in which accounts, and what it
 * was caused by. This is the shape an audit log entry for a financial event
 * should carry, rather than a bare "balance changed".
 */
export function explainTransaction(ledger, transactionId) {
  const tx = ledger.transactions.find((t) => t.id === transactionId);
  if (!tx) return null;
  return {
    id: tx.id,
    at: tx.at,
    memo: tx.memo,
    source: tx.source,
    causedBy: tx.causedBy,
    reversalOf: tx.reversalOf,
    currency: tx.currency,
    totalMinor: tx.totalMinor,
    total: fromMinor(tx.totalMinor, tx.currency),
    movements: tx.entries.map((e) => {
      const account = accountById(ledger, e.accountId);
      const signedMinor = e.direction === 'debit' ? e.amountMinor : -e.amountMinor;
      return {
        accountId: e.accountId,
        accountName: account?.name || null,
        accountType: account?.type || null,
        direction: e.direction,
        amountMinor: e.amountMinor,
        amount: fromMinor(e.amountMinor, tx.currency),
        // The sign as an accountant reads it, not as the store keeps it.
        signedMinor,
        signed: fromMinor(signedMinor, tx.currency)
      };
    })
  };
}

/**
 * Integrity check for the whole ledger. Every posting must be balanced, every
 * entry must name a real account, and the trial balance must agree.
 */
export function auditLedger(ledger) {
  const problems = [];
  for (const tx of ledger.transactions) {
    const entries = tx.entries || [];
    const debits = entries.filter((e) => e.direction === 'debit').reduce((a, e) => a + (e.amountMinor || 0), 0);
    const credits = entries.filter((e) => e.direction === 'credit').reduce((a, e) => a + (e.amountMinor || 0), 0);
    if (debits !== credits) problems.push({ transactionId: tx.id, reason: 'unbalanced', debitsMinor: debits, creditsMinor: credits });
    if (entries.length < 2) problems.push({ transactionId: tx.id, reason: 'too-few-entries' });
    for (const e of entries) {
      if (!accountById(ledger, e.accountId)) problems.push({ transactionId: tx.id, reason: 'unknown-account', accountId: e.accountId });
      if (!Number.isInteger(e.amountMinor) || e.amountMinor <= 0) problems.push({ transactionId: tx.id, reason: 'bad-amount', amountMinor: e.amountMinor });
    }
  }
  const trial = trialBalance(ledger);
  if (!trial.balanced) problems.push({ reason: 'trial-balance-off', differenceMinor: trial.differenceMinor });
  return { ok: problems.length === 0, problems, transactions: ledger.transactions.length, accounts: ledger.accounts.length };
}

/* ------------------------------------------------------------- chart presets */

/**
 * The account types a platform like this actually needs. Named so a caller does
 * not invent a seventh-sense account type and lose the normal-balance rule.
 */
export const CHART_TEMPLATE = {
  assets: [
    { name: 'Cash', type: 'asset' },
    { name: 'Payment processor clearing', type: 'asset' },
    { name: 'Customer funds held', type: 'asset' }
  ],
  liabilities: [
    { name: 'Customer balances payable', type: 'liability' },
    { name: 'Refunds payable', type: 'liability' },
    { name: 'Tax payable', type: 'liability' }
  ],
  equity: [{ name: 'Retained earnings', type: 'equity' }],
  revenue: [
    { name: 'Subscription revenue', type: 'revenue' },
    { name: 'Usage revenue', type: 'revenue' }
  ],
  expenses: [
    { name: 'Payment processing fees', type: 'expense' },
    { name: 'Refunds and chargebacks', type: 'expense' }
  ]
};

/** Build the ledger from the chart template, all in one currency. */
export function createPlatformLedger({ currency = 'USD' } = {}) {
  const ledger = createLedger();
  const created = {};
  for (const [group, accounts] of Object.entries(CHART_TEMPLATE)) {
    created[group] = {};
    for (const spec of accounts) {
      const res = createAccount({ ...spec, currency });
      addAccount(ledger, res.account);
      created[group][spec.name] = res.account;
    }
  }
  return { ledger, accounts: created };
}
