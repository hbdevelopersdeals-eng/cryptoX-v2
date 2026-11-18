/* CryptoX Academy (Section 36).
 *
 * Five tracks — beginner, trading, blockchain, DeFi and security — with lessons
 * that LINK INTO THE PRODUCT rather than describing it in the abstract. Every
 * lesson carries a `route`, so "learn about risk" ends on the paper-trading
 * screen with a position open, not on a paragraph.
 *
 * Certification is deliberately modest. Grading happens in the browser, so a
 * certificate is evidence of study, not proof of identity or competence, and
 * `CERTIFICATE_NOTE` says exactly that. A certificate that overstates itself is
 * worse than no certificate: it is the kind of claim that turns into a support
 * dispute ("I'm certified, why did I lose money").
 *
 * No lesson is investment advice, and none of them promise a return. The
 * trading lessons teach mechanics — order types, position sizing, drawdown —
 * because those are teachable, while "where the price goes" is not.
 */

export const CERTIFICATE_NOTE =
  'Certificates record completed lessons and a passed quiz. They are not a licence, not investment advice, and not proof of trading skill.';

/** Pass mark for a certificate. 80% means 4 of 5, not "attended". */
export const PASS_THRESHOLD = 0.8;

/** A certificate is re-verifiable for this long before it is considered stale. */
export const CERTIFICATE_VALID_DAYS = 730;

export const TRACKS = [
  { id: 'beginner', label: 'Beginner', blurb: 'What a blockchain is, what a wallet holds, and why a seed phrase is the whole account.' },
  { id: 'trading', label: 'Trading', blurb: 'Order types, position sizing, fees and drawdown — practised on paper, never with real money.' },
  { id: 'blockchain', label: 'Blockchain', blurb: 'Blocks, confirmations, gas, and what a reorg does to a "confirmed" payment.' },
  { id: 'defi', label: 'DeFi', blurb: 'Pools, lending, liquidation thresholds and the approval that drains a wallet.' },
  { id: 'security', label: 'Security', blurb: 'Phishing, address poisoning, approval hygiene and account takeover.' }
];

export const COURSES = [
  {
    id: 'crypto-basics',
    track: 'beginner',
    title: 'Crypto basics',
    level: 'Beginner',
    minutes: 25,
    summary: 'Keys, addresses, networks and the three ways people lose money before they ever trade.',
    lessons: [
      { id: 'keys', title: 'Keys and addresses', minutes: 6, route: '/wallet-lab', body: 'A wallet stores keys, not coins. The address is derived from the key, which is why anyone holding the phrase holds the funds.' },
      { id: 'networks', title: 'Networks and fees', minutes: 6, route: '/explorer', body: 'The same ticker can exist on several chains. Sending USDC on the wrong network is the most common irreversible mistake in crypto.' },
      { id: 'custody', title: 'Custodial vs self-custody', minutes: 7, route: '/wallet-lab', body: 'An exchange balance is a claim on a company. A self-custodied balance is a claim on nobody, which is stronger and less forgiving.' },
      { id: 'scams', title: 'The three classic losses', minutes: 6, route: '/account', body: 'Phishing sites, unlimited token approvals, and "support" staff who ask for a seed phrase. All three are avoidable with one rule: the phrase never leaves paper.' }
    ],
    quiz: [
      { q: 'What does a wallet actually store?', options: ['Coins', 'Private keys', 'A copy of the blockchain'], answer: 1 },
      { q: 'A seed phrase should be entered…', options: ['On any site that asks', 'Only in a wallet you installed yourself', 'In support chat to verify ownership'], answer: 1 },
      { q: 'Sending a token on the wrong network usually results in…', options: ['An automatic refund', 'Funds arriving late', 'Permanent loss'], answer: 2 },
      { q: 'A custodial exchange balance is…', options: ['A claim on the company', 'Self-custodied', 'Insured by the blockchain'], answer: 0 },
      { q: 'The safest place for a seed phrase is…', options: ['A password manager note', 'Screenshot in cloud storage', 'Written on paper, offline, in two locations'], answer: 2 }
    ]
  },
  {
    id: 'order-types',
    track: 'trading',
    title: 'Order types and mechanics',
    level: 'Beginner',
    minutes: 30,
    summary: 'Market, limit, stop, stop-limit and OCO — what each one guarantees, and what each one does not.',
    lessons: [
      { id: 'market-limit', title: 'Market vs limit', minutes: 8, route: '/exchange', body: 'A market order guarantees execution and not price. A limit order guarantees price and not execution. Every other order type is a combination of those two promises.' },
      { id: 'stops', title: 'Stops and stop-limits', minutes: 8, route: '/exchange', body: 'A stop becomes a market order at the trigger; a stop-limit becomes a limit order. In a gap, the stop-limit does not fill — that is the trade you accepted.' },
      { id: 'oco', title: 'OCO and brackets', minutes: 7, route: '/derivatives', body: 'One-cancels-other pairs a take-profit with a stop so only one can fire, which is how a position with a defined risk is expressed.' },
      { id: 'fees', title: 'Fees and the break-even move', minutes: 7, route: '/calculator', body: 'Two taker fees plus slippage mean a round trip needs a move before it profits. Compute it before the entry, not after.' }
    ],
    quiz: [
      { q: 'A market order guarantees…', options: ['Price', 'Execution', 'Neither'], answer: 1 },
      { q: 'A limit buy above the current price will…', options: ['Fill immediately at market', 'Wait to fill at or below the limit', 'Be rejected'], answer: 0 },
      { q: 'In a price gap, a stop-limit order may…', options: ['Fill at a better price', 'Fail to fill entirely', 'Convert to a market order'], answer: 1 },
      { q: 'OCO means…', options: ['One cancels other', 'Order cost optimisation', 'Open close only'], answer: 0 },
      { q: 'Break-even includes…', options: ['Only the entry fee', 'Fees on both sides plus slippage', 'Nothing; fees are separate'], answer: 1 }
    ]
  },
  {
    id: 'risk-sizing',
    track: 'trading',
    title: 'Position sizing and drawdown',
    level: 'Intermediate',
    minutes: 28,
    summary: 'Why a 50% loss needs a 100% gain, and how to size a position from the stop instead of from conviction.',
    lessons: [
      { id: 'asymmetry', title: 'The arithmetic of drawdown', minutes: 7, route: '/calculator', body: 'Losses and gains are not symmetric: −50% then +50% leaves you at 75%. Recovery cost grows faster than the loss.' },
      { id: 'sizing', title: 'Sizing from the stop', minutes: 8, route: '/paper-trading', body: 'Risk a fixed fraction of equity per idea, then derive size from the distance to the invalidation. Size is an output, never an input.' },
      { id: 'expectancy', title: 'Expectancy over win rate', minutes: 7, route: '/strategies', body: 'A 40% win rate with 2R winners beats a 70% win rate with 0.3R winners. Win rate alone is a marketing number.' },
      { id: 'journal', title: 'Recording the decision', minutes: 6, route: '/paper-trading', body: 'A trade log that records only the outcome teaches nothing. Record the thesis and the invalidation, then grade the process.' }
    ],
    quiz: [
      { q: 'After a 50% loss, the gain needed to return to even is…', options: ['50%', '75%', '100%'], answer: 2 },
      { q: 'Position size should be derived from…', options: ['Conviction', 'Distance to invalidation', 'Account age'], answer: 1 },
      { q: 'Expectancy depends on…', options: ['Win rate only', 'Win rate and payoff size', 'Number of trades only'], answer: 1 },
      { q: 'A 40% win rate with 2R winners has expectancy of…', options: ['−0.2R', '+0.2R', '+0.8R'], answer: 1 },
      { q: 'A useful trade journal records…', options: ['Outcome only', 'Thesis and invalidation', 'Screenshots'], answer: 1 }
    ]
  },
  {
    id: 'blocks-confirmations',
    track: 'blockchain',
    title: 'Blocks, gas and confirmations',
    level: 'Beginner',
    minutes: 22,
    summary: 'What "confirmed" means, why gas spikes, and what a reorg does to a payment you already counted.',
    lessons: [
      { id: 'blocks', title: 'What a block contains', minutes: 7, route: '/explorer', body: 'A block is an ordered list of transactions plus a pointer to its parent. Changing a past block means redoing all the work after it.' },
      { id: 'confirmations', title: 'Confirmations and finality', minutes: 7, route: '/explorer', body: 'One confirmation is a strong hint, six is a convention, and finality is a property of the chain. A payment is only settled when the chain says so.' },
      { id: 'gas', title: 'Gas and priority', minutes: 8, route: '/explorer', body: 'Gas pays for computation, not for value transferred. A failed transaction still consumes it, which is why simulation before send matters.' }
    ],
    quiz: [
      { q: 'A block references…', options: ['The next block', 'Its parent block', 'Only the mempool'], answer: 1 },
      { q: 'Six confirmations is…', options: ['A consensus rule', 'A widely used convention', 'Required by all chains'], answer: 1 },
      { q: 'Gas pays for…', options: ['The amount sent', 'Computation', 'Storage rent only'], answer: 1 },
      { q: 'A failed transaction…', options: ['Costs nothing', 'Still consumes gas', 'Is refunded by the miner'], answer: 1 },
      { q: 'A reorg can…', options: ['Reverse a recently confirmed transaction', 'Change your private key', 'Delete the mempool'], answer: 0 }
    ]
  },
  {
    id: 'defi-mechanics',
    track: 'defi',
    title: 'DeFi mechanics',
    level: 'Intermediate',
    minutes: 32,
    summary: 'Pools, lending, liquidation thresholds and the approval that can empty a wallet.',
    lessons: [
      { id: 'amm', title: 'How an AMM prices a swap', minutes: 8, route: '/defi', body: 'A constant-product pool prices by ratio of reserves, so size moves price. Slippage is the pool telling you the trade is large relative to its depth.' },
      { id: 'lending', title: 'Lending and liquidation', minutes: 8, route: '/defi', body: 'A loan is collateralised above its value. The health factor is the distance to liquidation, and it moves with price, not with your intent.' },
      { id: 'approvals', title: 'Approvals and allowances', minutes: 8, route: '/wallet-lab', body: 'An unlimited approval lets a contract move that token forever. Approve the amount you need, and revoke what you no longer use.' },
      { id: 'yield', title: 'Where yield comes from', minutes: 8, route: '/defi', body: 'Yield is paid by borrowers, traders, or a token subsidy. If you cannot name who pays, the yield is either inflation or someone else\'s loss.' }
    ],
    quiz: [
      { q: 'In a constant-product pool, a large swap…', options: ['Moves price against you', 'Has no price impact', 'Always fills at the oracle price'], answer: 0 },
      { q: 'Liquidation happens when…', options: ['You close the loan', 'The health factor falls below 1', 'The pool runs out of tokens'], answer: 1 },
      { q: 'An unlimited approval…', options: ['Expires after 24h', 'Persists until revoked', 'Only applies to one transaction'], answer: 1 },
      { q: 'Sustainable yield is paid by…', options: ['New depositors', 'Borrowers, traders or a token subsidy', 'The protocol treasury forever'], answer: 1 },
      { q: 'Before signing an approval, check…', options: ['The contract and the amount', 'The token logo', 'The gas price only'], answer: 0 }
    ]
  },
  {
    id: 'security-hygiene',
    track: 'security',
    title: 'Account and wallet security',
    level: 'Beginner',
    minutes: 24,
    summary: 'The five controls that stop most real-world losses, ranked by how often they are skipped.',
    lessons: [
      { id: 'phishing', title: 'Recognising phishing', minutes: 6, route: '/account', body: 'The domain is the tell, not the design. Bookmark the exchange and never reach it from a link in a message.' },
      { id: 'mfa', title: 'MFA that actually helps', minutes: 6, route: '/account', body: 'SMS is better than nothing and worse than an authenticator. A hardware key resists real-time phishing, which a code does not.' },
      { id: 'poisoning', title: 'Address poisoning', minutes: 6, route: '/wallet-lab', body: 'An attacker sends dust from a lookalike address so yours appears in history. Always verify the full address, or use a saved contact.' },
      { id: 'incident', title: 'If an account is compromised', minutes: 6, route: '/status', body: 'Revoke sessions, rotate credentials, move remaining funds to a clean wallet, then report. Speed matters more than completeness.' }
    ],
    quiz: [
      { q: 'The strongest phishing signal is…', options: ['Poor design', 'A wrong domain', 'Missing HTTPS'], answer: 1 },
      { q: 'Which factor resists real-time phishing?', options: ['SMS code', 'Hardware security key', 'Security question'], answer: 1 },
      { q: 'Address poisoning relies on…', options: ['Breaking cryptography', 'A lookalike address in your history', 'A malicious wallet app'], answer: 1 },
      { q: 'First action after a compromise…', options: ['Email support', 'Revoke sessions and move funds', 'Change your username'], answer: 1 },
      { q: 'A seed phrase is safe when…', options: ['Stored in cloud notes', 'Typed into a support chat', 'Offline, on paper, in two places'], answer: 2 }
    ]
  }
];

export const courseById = (id) => COURSES.find((c) => c.id === id) || null;

export function coursesByTrack(track) {
  return COURSES.filter((c) => c.track === track);
}

/** Deterministic ID so the same achievement always verifies to the same value. */
export function certificateId({ accountId, courseId, issuedAt = Date.now() } = {}) {
  const source = `${accountId}|${courseId}|${new Date(issuedAt).toISOString().slice(0, 10)}`;
  let h = 5381;
  for (let i = 0; i < source.length; i += 1) h = ((h << 5) + h + source.charCodeAt(i)) >>> 0;
  const day = new Date(issuedAt).toISOString().slice(0, 10).replace(/-/g, '');
  return `CXA-${String(courseId).slice(0, 8).toUpperCase()}-${day}-${h.toString(36).toUpperCase().slice(0, 6)}`;
}

/** Score a quiz. `answers` is an array of chosen option indices, -1 for skipped. */
export function gradeQuiz(quiz = [], answers = []) {
  if (!quiz.length) return { total: 0, correct: 0, score: 0, passed: false, breakdown: [] };
  const breakdown = quiz.map((q, i) => {
    const given = Number.isInteger(answers[i]) ? answers[i] : -1;
    return { index: i, given, expected: q.answer, correct: given === q.answer };
  });
  const correct = breakdown.filter((b) => b.correct).length;
  const score = correct / quiz.length;
  return {
    total: quiz.length,
    correct,
    score,
    passed: score >= PASS_THRESHOLD,
    breakdown
  };
}

/**
 * Issue a certificate, or explain why not.
 * The registry is passed in: this function never invents a prior achievement.
 */
export function issueCertificate({ accountId, course, answers, issuedAt = Date.now(), holder = null } = {}) {
  if (!accountId) return { ok: false, reason: 'Sign in to record progress.' };
  if (!course) return { ok: false, reason: 'Unknown course.' };
  const result = gradeQuiz(course.quiz, answers);
  if (!result.passed) {
    return {
      ok: false,
      reason: `Score ${(result.score * 100).toFixed(0)}% is below the ${PASS_THRESHOLD * 100}% pass mark.`,
      result
    };
  }
  return {
    ok: true,
    result,
    certificate: {
      id: certificateId({ accountId, courseId: course.id, issuedAt }),
      courseId: course.id,
      courseTitle: course.title,
      track: course.track,
      holder,
      issuedAt: new Date(issuedAt).toISOString(),
      score: result.score,
      note: CERTIFICATE_NOTE
    }
  };
}

/** Verify a certificate against a registry of issued records. */
export function verifyCertificate(id, registry = [], now = Date.now()) {
  const found = registry.find((c) => c.id === id);
  if (!found) return { valid: false, reason: 'No certificate with that ID has been issued.' };
  const ageDays = (now - new Date(found.issuedAt).getTime()) / 86400000;
  if (ageDays > CERTIFICATE_VALID_DAYS) {
    return { valid: false, reason: `Issued ${Math.round(ageDays)} days ago; certificates are re-verifiable for ${CERTIFICATE_VALID_DAYS}.`, record: found };
  }
  return { valid: true, record: found, note: CERTIFICATE_NOTE };
}

/** Lesson-level progress with the next thing to do. */
export function progressFor(course, completedLessonIds = []) {
  if (!course) return { completed: 0, total: 0, pct: 0, next: null, complete: false };
  const done = new Set(completedLessonIds);
  const completed = course.lessons.filter((l) => done.has(l.id)).length;
  const total = course.lessons.length;
  return {
    completed,
    total,
    pct: total ? (completed / total) * 100 : 0,
    next: course.lessons.find((l) => !done.has(l.id)) || null,
    complete: completed === total
  };
}

/**
 * Demo-trading milestones, so the "practise" half of the academy is checkable
 * rather than a link that says "try paper trading".
 */
export const DEMO_TASKS = [
  { id: 'place-limit', title: 'Place a limit order and let it fill', route: '/exchange', check: 'orders.limit >= 1' },
  { id: 'place-stop', title: 'Attach a stop to an open position', route: '/derivatives', check: 'positions.withStop >= 1' },
  { id: 'size-from-stop', title: 'Size a position from its invalidation', route: '/calculator', check: 'calculator.used >= 1' },
  { id: 'review-drawdown', title: 'Review a 20% drawdown on the equity curve', route: '/paper-trading', check: 'paper.maxDrawdown >= 0.2' },
  { id: 'set-alert', title: 'Create a price alert', route: '/alerts', check: 'alerts.created >= 1' }
];

export function demoTasksDone(flags = {}) {
  return DEMO_TASKS.map((t) => ({ ...t, done: Boolean(flags[t.id]) }));
}
