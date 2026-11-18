/* Public research guides — the site's citable content layer.
 *
 * WHY THESE EXIST
 * The product pages describe what CryptoX is. They do not answer the questions
 * people actually type into an answer engine ("is paper trading the same as
 * backtesting", "why does a backtest fill at the close", "how is FIFO cost basis
 * calculated"). Those questions are where a citation is won or lost, so each
 * guide answers one of them in the product's own terms.
 *
 * RULES
 *  - Every claim must be true of this product or of the method itself. No
 *    invented statistics, no "studies show", no performance numbers.
 *  - One source of truth: `scripts/prerender-content.mjs` derives the crawler
 *    copy from this file, so a page and its static HTML cannot drift.
 *  - Adding a guide means adding it here and to PUBLIC_ROUTES — the sitemap
 *    and the prerender both read that manifest.
 */

export const GUIDE_GLOSSARY = [
  ['Backtest', 'Replaying a fixed set of historical candles through a strategy to see what it would have done.'],
  ['Paper trading', 'Running a strategy forward on live data against a virtual balance. Nothing is sent to an exchange.'],
  ['Lookahead bias', 'Using information that was not available at the moment the decision had to be made — the most common way a backtest lies.'],
  ['Next-bar fill', 'An order decided on one candle executes at the next candle, never at the price that produced the signal.'],
  ['Slippage', 'The gap between the price a backtest assumes and the price a real order would have received.'],
  ['Fee drag', 'The cumulative cost of trading fees on a strategy that trades often; it can turn a positive edge negative.'],
  ['Max drawdown', 'The largest peak-to-trough fall in equity over the tested period.'],
  ['Sharpe ratio', 'Return above the risk-free rate divided by volatility. It penalises both losses and wild swings.'],
  ['Sortino ratio', 'Like Sharpe, but only downside volatility is penalised.'],
  ['Profit factor', 'Gross profit divided by gross loss. Below 1 means the strategy lost money.'],
  ['FIFO cost basis', 'Matching the oldest acquired units to the units sold first, which fixes the cost of each realised gain.'],
  ['Realised vs unrealised P&L', 'Realised is locked in by a sale; unrealised is the paper gain or loss on what is still held.'],
  ['RSI (14)', 'A momentum oscillator over 14 periods; CryptoX presets treat below 30 as oversold and above 70 as overbought.'],
  ['Moving-average cross', 'A shorter average crossing a longer one; the Golden Cross preset uses MA20 over MA50.']
];

export const GUIDES = [
  {
    slug: 'paper-trading-vs-backtesting',
    title: 'Paper trading vs backtesting: what each one actually proves',
    description:
      'A backtest and a paper-trading run answer different questions. One tests a rule against history, the other tests it against live data and your own patience. Here is which one to trust for what.',
    sections: [
      {
        heading: 'They are not the same experiment',
        paragraphs: [
          'A backtest replays a fixed set of historical candles. You already know how the period ended, the data set does not change while you look at it, and the result is reproducible: run it again tomorrow and you get the same numbers. That makes it good at one thing — telling you whether a rule has any edge at all in the sample you gave it.',
          'Paper trading runs the same rule forward, on live data, against a virtual balance. The candles after the start do not exist yet, so the result cannot be reproduced exactly. What it tests is different: whether the rule survives real sequencing, gaps and quiet hours, and whether you can hold a position while it behaves badly.'
        ]
      },
      {
        heading: 'What a backtest cannot tell you',
        paragraphs: [
          'A historical sample is a small slice of market conditions. A strategy tuned until it looks good on that slice has learned the slice, not the market — which is why CryptoX reports a walk-forward split alongside the headline result instead of a single number.',
          'A backtest also cannot model the thing that usually breaks a strategy: you. It will happily show a 40% drawdown that you would have closed out at 15%.'
        ]
      },
      {
        heading: 'What paper trading cannot tell you',
        paragraphs: [
          'A paper fill has no market impact and no queue position. Your order would have moved a real book, and at small size it may not matter, but pretending it is free is how a simulated edge becomes a real loss.',
          'A short paper run also has no statistical weight. Twenty trades tell you almost nothing about whether a rule works; they mostly tell you what the last two weeks looked like.'
        ]
      },
      {
        heading: 'How CryptoX keeps the two honest',
        paragraphs: [
          'The backtester fills on the next bar with fees and slippage applied, long-only, so it cannot buy the candle that produced the signal. Metrics include Sharpe, Sortino, max drawdown, win rate and profit factor against buy-and-hold.',
          'The paper trader runs on a virtual balance with an equity curve, trade log and win rate. Both refuse to run on synthetic candles: if the live feeds fail, the generated fallback data is badged SIMULATED and the strategy engine will not arm on it.'
        ],
        bullets: [
          'Use the backtest to reject a rule, not to approve one.',
          'Use paper trading to find out how the rule behaves in sequence, and whether you can sit through it.',
          'Neither one predicts a return. Nothing here is investment advice.'
        ]
      }
    ],
    faq: [
      ['Is paper trading the same as a demo account?', 'A demo account usually mirrors a broker’s order types with simulated fills. CryptoX paper trading runs a strategy forward on live public market data with a virtual balance; no exchange account is connected and no order leaves the browser.'],
      ['Do CryptoX backtests include fees?', 'Yes. Every backtest applies trading fees and slippage, and fills on the next bar rather than at the close of the signal candle.']
    ]
  },
  {
    slug: 'next-bar-fill',
    title: 'Why next-bar fills matter more than which indicator you pick',
    description:
      'Most bad backtests are not caused by a bad indicator. They are caused by filling an order at a price that did not exist when the decision was made. Here is the difference next-bar filling makes.',
    sections: [
      {
        heading: 'The bug that hides inside a good-looking equity curve',
        paragraphs: [
          'A candle closes at a known price. If a strategy says "the close crossed below 30, so buy at that close", it has used the close to decide and then bought at the same close. In a live market that price was already gone by the time the signal existed.',
          'This is lookahead bias, and it is generous in a way that is hard to notice: it improves entries just enough to turn a losing rule into a plausible one. The equity curve looks smoother, not obviously fake.'
        ]
      },
      {
        heading: 'What next-bar filling changes',
        paragraphs: [
          'A next-bar fill does the boring, correct thing: the decision is recorded on the signal candle, and the order executes at the following bar. Whatever the market did between those two bars is now part of the result, including the gap that ruins the trade.',
          'It costs you return in the backtest and buys you honesty. A rule that only works with same-bar fills did not work; it was measuring the future.'
        ]
      },
      {
        heading: 'The rest of the cost model',
        paragraphs: [
          'Fills are only half of it. Fees and slippage decide whether a high-frequency rule survives at all: a strategy that flips in and out twenty times over a sample can lose its entire edge to costs, and an equity curve without them is fiction.',
          'CryptoX applies fees and slippage to every backtest, keeps the engine long-only so a "profit" cannot come from an unmodelled short, and reports profit factor against buy-and-hold so a strategy has to beat simply holding the asset.'
        ],
        bullets: [
          'Next-bar fills remove the ability to trade on information you did not have.',
          'Fees and slippage decide whether an edge survives contact with trading frequency.',
          'Buy-and-hold is the benchmark; a strategy that loses to it has not earned its complexity.'
        ]
      }
    ],
    faq: [
      ['Why not fill at the open of the next bar instead of anywhere in it?', 'A next-bar fill is an approximation either way. Placing it at the next bar rather than inside the signal bar is what removes the lookahead bias; which exact price inside that bar you assume is a smaller error than using a price you could not have traded.'],
      ['Can a next-bar backtest still be wrong?', 'Yes. It cannot model order-book depth, exchange outages, partial fills or funding costs. It is a stricter approximation, not a simulation of the market.']
    ]
  },
  {
    slug: 'fifo-cost-basis',
    title: 'FIFO cost basis for a crypto portfolio, without the spreadsheet',
    description:
      'When you sell part of a position, the gain depends on which units you sold. FIFO is the default most jurisdictions expect, and it is the one CryptoX computes — lot by lot, with fees folded into the basis.',
    sections: [
      {
        heading: 'Why one average price is not enough',
        paragraphs: [
          'If you bought one coin at 30,000 and another at 60,000, your average is 45,000 — but you never paid 45,000 for anything. Sell one coin at 50,000 and your realised gain is either +20,000 or −10,000 depending on which unit you sold.',
          'An average-based portfolio view hides that choice. It is fine for "what am I worth", and wrong for "what did I realise".'
        ]
      },
      {
        heading: 'What FIFO does',
        paragraphs: [
          'FIFO matches the oldest units you still hold to the units you just sold. Sell one coin in the example above and the 30,000 lot is consumed first, so the realised gain is +20,000 and the remaining position is carried at 60,000.',
          'Every sale produces a tax lot: quantity, acquisition cost, proceeds, and the gain between them. CryptoX keeps those lots, folds trading fees into both basis and proceeds, and separates realised from unrealised P&L instead of showing one blended number.'
        ]
      },
      {
        heading: 'Where people get it wrong',
        paragraphs: [
          'Fees are the usual casualty. A fee paid to acquire is part of the cost basis; a fee paid to sell reduces the proceeds. Ignore both and every gain is overstated by exactly the amount you paid to trade.',
          'Transfers are the other one. Moving a coin between your own wallets is not a disposal, and a tracker that treats it as one invents a taxable event that never happened.'
        ],
        bullets: [
          'FIFO: oldest units sold first — the common default, and what CryptoX computes.',
          'Fees in the basis, fees against proceeds, realised and unrealised reported separately.',
          'Tax lots and a P&L calendar are exportable as CSV for your own records.'
        ]
      }
    ],
    faq: [
      ['Does CryptoX file my taxes?', 'No. It computes FIFO lots and realised/unrealised P&L from the trades you enter and exports them as CSV. Whether FIFO is the right method, and how the numbers map to a return, depends on your jurisdiction — that is a question for an accountant.'],
      ['What happens if I move coins between my own wallets?', 'A transfer between wallets you control is not a sale. It changes where the units are held, not their cost basis.']
    ]
  }
];

export const guideBySlug = (slug) => GUIDES.find((g) => g.slug === slug) || null;

/** Plain-text body for a guide, used by the prerenderer and by tests. */
export function guidePlainText(guide) {
  const parts = [guide.description];
  for (const section of guide.sections) {
    parts.push(section.heading, ...section.paragraphs, ...(section.bullets || []));
  }
  for (const [q, a] of guide.faq || []) parts.push(q, a);
  return parts.join(' ');
}
