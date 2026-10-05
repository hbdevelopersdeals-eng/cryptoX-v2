/* Real-time stream catalog.
 *
 * The engine in realtime.js owns the socket, the sequence tracker, the replay
 * ring, the dead-letter queue and the backpressure queue. What was missing was a
 * single statement of WHICH data types are streamed, which ones are sequenced,
 * and how heartbeat and failover behave — so that coverage is checkable rather
 * than implied.
 *
 * Everything here is data plus pure helpers, so the policy is testable without
 * opening a socket.
 */

/** The data types the spec requires the engine to stream. */
export const REQUIRED_KINDS = [
  'trades', 'tickers', 'orderbook', 'klines', 'funding', 'openInterest', 'liquidations'
];

/**
 * Stream definitions.
 *   sequencedBy — the field carrying the venue's monotonic id, used for gap
 *                 detection; null means the venue publishes no usable sequence.
 */
export const STREAMS = [
  { kind: 'trades', id: 'aggTrade', suffix: '@aggTrade', sequencedBy: 'a',
    payload: 'Aggregated trade', default: true,
    note: 'Aggregated by price level — one event per fill group rather than per maker/taker.' },

  { kind: 'tickers', id: 'ticker', suffix: '@ticker', sequencedBy: null,
    payload: '24h rolling ticker', default: true,
    note: 'Rolling 24h window (price change, high, low, volume). No venue sequence, so it is not gap-checked.' },

  { kind: 'orderbook', id: 'depth20', suffix: '@depth20@100ms', sequencedBy: 'u',
    payload: 'Top-20 book snapshot', default: true,
    note: 'Partial depth snapshots 10×/s. The update id lets the tracker detect a missed snapshot.' },

  { kind: 'klines', id: 'kline_1m', suffix: '@kline_1m', sequencedBy: 'k.t',
    payload: '1-minute candle', default: true,
    note: 'Only the final (closed) candle should drive signals; the forming candle mutates in place.' },

  { kind: 'funding', id: 'markPrice', suffix: '@markPrice@1s', sequencedBy: 'E',
    payload: 'Mark price + funding rate', default: true,
    note: 'Carries the mark price, index price, funding rate and next funding time — the inputs liquidation and funding PnL need.' },

  { kind: 'liquidations', id: 'forceOrder', suffix: '@forceOrder', sequencedBy: 'o.T',
    payload: 'Liquidation order', default: false,
    note: 'Per-symbol, so a full-market view needs one subscription per watched symbol.' },

  { kind: 'openInterest', id: null, suffix: null, sequencedBy: null,
    payload: 'Open interest', default: false, transport: 'rest',
    note: 'No public WebSocket on the venues used here — polled over REST on an interval and labelled as polled, not streamed.' }
];

export const streamByKind = (kind) => STREAMS.find((s) => s.kind === kind) || null;
export const streamById = (id) => STREAMS.find((s) => s.id === id) || null;

/** Streams that actually travel over the socket. */
export const socketStreams = () => STREAMS.filter((s) => s.transport !== 'rest');

/** Streams the venue does not sequence, so gap detection cannot apply. */
export const unsequencedStreams = () => socketStreams().filter((s) => !s.sequencedBy).map((s) => s.kind);

/**
 * Build the combined-stream list for a set of symbols.
 * `kinds` defaults to the socket streams flagged `default: true`.
 */
export function buildStreamSet({ symbols = ['btcusdt'], kinds = null, includeLiquidations = false } = {}) {
  const base = kinds || STREAMS.filter((s) => s.default && s.transport !== 'rest').map((s) => s.kind);
  // Liquidations default to off, so the opt-in must ADD the kind — otherwise the
  // `default` filter would exclude it before the flag is ever consulted and the
  // parameter would silently do nothing.
  const wanted = includeLiquidations && !base.includes('liquidations')
    ? [...base, 'liquidations']
    : base;

  const out = [];
  symbols.forEach((sym) => {
    const s = String(sym).toLowerCase();
    STREAMS.forEach((def) => {
      if (!def.suffix || def.transport === 'rest') return;
      if (def.kind === 'liquidations' && !includeLiquidations) return;
      if (!wanted.includes(def.kind)) return;
      out.push(`${s}${def.suffix}`);
    });
  });
  return out;
}

/** Which required data types are wired, and which are not. */
export function catalogCoverage({ enabledKinds = null } = {}) {
  const enabled = enabledKinds || STREAMS.filter((s) => s.default).map((s) => s.kind);
  const covered = REQUIRED_KINDS.filter((k) => enabled.includes(k));
  const missing = REQUIRED_KINDS.filter((k) => !enabled.includes(k));
  return {
    required: REQUIRED_KINDS.length,
    covered: covered.length,
    missing,
    coveredKinds: covered,
    restPolled: STREAMS.filter((s) => s.transport === 'rest').map((s) => s.kind)
  };
}

/* ---------------- connection policy ---------------- */

/**
 * Heartbeat policy.
 *
 * IMPORTANT and non-obvious: a browser CANNOT send a WebSocket ping frame — the
 * WebSocket API exposes no such method — and the market-data streams do not
 * accept a JSON `ping` command (only the separate WS *API* does). So an
 * application-level ping is not available here, and claiming one would be false.
 *
 * Instead, liveness is proven by always subscribing to at least one
 * high-frequency stream (@markPrice@1s, @ticker). That guarantees inbound
 * traffic about once a second, which makes the silence watchdog reliable even
 * when the order book is idle.
 */
export const HEARTBEAT = {
  mechanism: 'silence-watchdog',
  livenessSource: 'high-frequency stream',
  requiredFastStreams: ['markPrice', 'ticker'],
  expectedMessageIntervalMs: 1000,
  silenceTimeoutMs: 30000,
  action: 'reconnect',
  note: 'A silent-but-open socket and a genuinely idle market look identical from JS, so a fast stream is always included to disambiguate. Without one, the watchdog would fire on a healthy but quiet connection.'
};

/** Ordered failover hosts. First is preferred; later ones are used on failure. */
export const FAILOVER = {
  websocket: [
    { url: 'wss://stream.binance.com:9443', label: 'Binance stream (primary)' },
    { url: 'wss://data-stream.binance.vision', label: 'Binance market-data mirror' }
  ],
  rest: [
    { url: 'https://api.binance.com', label: 'Binance REST (primary)' },
    { url: 'https://data-api.binance.vision', label: 'Binance REST mirror' }
  ],
  strategy: 'ordered',
  note: 'Hosts are tried in order; a failure quarantines that host and the next is promoted. The mirror serves market data without account access.'
};

/** Delivery guarantees the engine provides, stated explicitly. */
export const DELIVERY = {
  atMostOnce: 'Socket events are delivered at most once — a duplicate is dropped by the sequence tracker.',
  replayWindow: 200,
  dlqCapacity: 50,
  queueCapacity: 1000,
  gapDetection: 'Per-stream monotonic ids; a forward jump is recorded as a gap and triggers a REST resync of that stream.',
  reconciliation: 'Top-of-book is periodically compared against REST; a divergence beyond tolerance is flagged.',
  note: 'Replay is an in-memory ring for UI continuity, not durable storage — a reload starts a fresh window.'
};

/** Next host after a failure, wrapping to the start. */
export function nextHost(hosts = [], current = null) {
  if (!hosts.length) return null;
  if (current == null) return hosts[0];
  const i = hosts.findIndex((h) => (h.url || h) === current);
  if (i < 0) return hosts[0];
  return hosts[(i + 1) % hosts.length];
}
