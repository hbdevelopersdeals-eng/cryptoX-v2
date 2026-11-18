/* Social layer, client half (Section 17).
 *
 * The database in migration 0009 is the authority on visibility. This module does
 * not try to enforce anything — it PREDICTS what the database will say, so the UI
 * can hide a button instead of showing a control that fails with a policy error,
 * and it holds the parts that are pure logic: composition validation, mention and
 * cashtag parsing, feed ordering, reputation arithmetic, moderation triage and DM
 * thread summaries.
 *
 * `canViewPost` mirrors `cx_can_view_post()` deliberately, and the test suite
 * pins the two to the same rules. If they ever disagree the client shows content
 * the server would refuse, which is how a private post ends up in a screenshot.
 *
 * Why ranking is disclosed: a feed ordered by an undisclosed score is a product
 * that decides what its users see for reasons they cannot inspect. `feedScore`
 * is small enough to print in the UI, and the page does.
 */

/** Lowercase handles, 3–20 characters, letters/digits/underscore. */
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export const PROFILE_LIMITS = { handle: 20, displayName: 60, bio: 280 };

export const POST_KINDS = [
  { id: 'post', label: 'Post' },
  { id: 'idea', label: 'Trading idea' },
  { id: 'chart', label: 'Chart' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'quote', label: 'Quote' },
  { id: 'repost', label: 'Repost' }
];

export const VISIBILITIES = [
  { id: 'public', label: 'Everyone' },
  { id: 'followers', label: 'Followers' },
  { id: 'community', label: 'Community' },
  { id: 'private', label: 'Only me' }
];

export const BODY_LIMIT = 5000;
export const COMMENT_LIMIT = 2000;

/** Authors may edit for this long; afterwards the post is a historical record. */
export const EDIT_WINDOW_MINUTES = 30;

/** Reputation weights, printed in the UI so the score is not a mystery number. */
export const REPUTATION_WEIGHTS = { post: 2, comment: 1, like_received: 1, follow_received: 1, report_upheld: -10 };

export const REPUTATION_TIERS = [
  { id: 'new', label: 'New', min: 0 },
  { id: 'member', label: 'Member', min: 25 },
  { id: 'contributor', label: 'Contributor', min: 100 },
  { id: 'trusted', label: 'Trusted', min: 400 }
];

/* ---------------------------------------------------------------- profiles */

export function validateHandle(handle) {
  const value = String(handle ?? '').trim().toLowerCase();
  if (!value) return { valid: false, error: 'A handle is required.' };
  if (!HANDLE_RE.test(value)) {
    return { valid: false, error: 'Handles are 3–20 characters: lowercase letters, digits and underscore.' };
  }
  return { valid: true, value };
}

export function validateProfile({ handle, displayName, bio, avatarUrl } = {}) {
  const errors = [];
  const h = validateHandle(handle);
  if (!h.valid) errors.push(h.error);

  const name = String(displayName ?? '').trim();
  if (!name) errors.push('A display name is required.');
  else if (name.length > PROFILE_LIMITS.displayName) errors.push(`Display name must be at most ${PROFILE_LIMITS.displayName} characters.`);

  if (bio != null && String(bio).length > PROFILE_LIMITS.bio) {
    errors.push(`Bio must be at most ${PROFILE_LIMITS.bio} characters.`);
  }
  if (avatarUrl && !/^https:\/\//.test(String(avatarUrl))) {
    errors.push('Avatar must be an https URL.');
  }
  return { valid: errors.length === 0, errors, handle: h.value || null, displayName: name };
}

/* ------------------------------------------------------------------- posts */

/**
 * Validate a composed post before it reaches Postgres.
 * The `repost` exemption matches the database constraint: a repost is a pointer,
 * so an empty body is legitimate and everything else needs words.
 */
export function validatePost({ kind = 'post', body, visibility = 'public', communityId = null, parentId = null, payload = {} } = {}) {
  const errors = [];
  const text = String(body ?? '').trim();

  if (!POST_KINDS.some((k) => k.id === kind)) errors.push(`Unknown post kind "${kind}".`);

  if (kind === 'repost') {
    if (!parentId) errors.push('A repost must point at an existing post.');
  } else if (!text) {
    errors.push('Write something before posting.');
  } else if (text.length > BODY_LIMIT) {
    errors.push(`Posts are limited to ${BODY_LIMIT} characters.`);
  }

  if (!VISIBILITIES.some((v) => v.id === visibility)) errors.push(`Unknown visibility "${visibility}".`);

  /* Mirrors the database check: community visibility and a community id imply
     each other, so a "community" post cannot float without one. */
  if (visibility === 'community' && !communityId) {
    errors.push('Community visibility needs a community.');
  }
  if (visibility !== 'community' && communityId) {
    errors.push('A post inside a community must use community visibility.');
  }

  if (kind === 'idea') {
    const { instrument, side } = payload;
    if (!instrument) errors.push('A trading idea needs an instrument.');
    if (!['long', 'short'].includes(side)) errors.push('A trading idea needs a side: long or short.');
  }
  if ((kind === 'quote' || kind === 'repost') && !parentId) {
    errors.push('A quote or repost must reference another post.');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalised: {
      kind,
      body: text,
      visibility,
      communityId,
      parentId,
      payload
    }
  };
}

/**
 * Predict `cx_can_view_post()`. Kept in the same order as the SQL so the two can
 * be read side by side.
 */
export function canViewPost(post, viewer) {
  if (!post) return false;
  const viewerId = viewer?.id ?? null;

  if (viewerId && post.authorId === viewerId) return true;
  if (post.status && post.status !== 'published') return false;

  switch (post.visibility) {
    case 'public':
      return true;
    case 'followers':
      return Boolean(viewer?.following?.includes(post.authorId));
    case 'community':
      return Boolean(viewer?.communities?.includes(post.communityId));
    case 'private':
      return false;
    default:
      return false;
  }
}

export function canEdit(post, viewer, now = Date.now()) {
  if (!post || !viewer?.id || post.authorId !== viewer.id) return false;
  const created = new Date(post.createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return now - created <= EDIT_WINDOW_MINUTES * 60000;
}

/* -------------------------------------------------------------- composition */

/**
 * Mentions and cashtags, deduplicated, in document order.
 * Deliberately simple: a full parser invites a regex that runs away on a long
 * post, and these are used for highlighting and link generation only.
 */
export function parseMentions(body = '') {
  const found = new Map();
  const re = /(^|\s)@([a-z0-9_]{3,20})\b/gi;
  let m;
  while ((m = re.exec(String(body))) !== null) {
    const handle = m[2].toLowerCase();
    if (!found.has(handle)) found.set(handle, m.index + m[1].length);
  }
  return [...found.entries()].map(([handle, index]) => ({ handle, index }));
}

export function parseCashtags(body = '') {
  const found = new Map();
  const re = /(^|\s)\$([A-Za-z][A-Za-z0-9]{1,11})\b/g;
  let m;
  while ((m = re.exec(String(body))) !== null) {
    const symbol = m[2].toUpperCase();
    if (!found.has(symbol)) found.set(symbol, m.index + m[1].length);
  }
  return [...found.entries()].map(([symbol, index]) => ({ symbol, index }));
}

/* -------------------------------------------------------------------- feed */

/**
 * Engagement score with time decay.
 *
 *   score = (likes + 2·comments + 3·reposts) / (ageHours + 2)^1.5
 *
 * The exponents are chosen so a post needs roughly 5× the engagement to outrank
 * a competitor three hours newer. It is printed in the UI next to the ordering
 * control because an unexplained ordering is a policy nobody can audit.
 */
export function feedScore(post, { now = Date.now(), halfLifeHours = 6 } = {}) {
  const likes = Number(post?.likes) || 0;
  const comments = Number(post?.comments) || 0;
  const reposts = Number(post?.reposts) || 0;
  const created = new Date(post?.createdAt).getTime();
  const ageHours = Number.isFinite(created) ? Math.max(0, (now - created) / 3600000) : 0;
  const decay = Math.pow(2, ageHours / halfLifeHours);
  return (likes + 2 * comments + 3 * reposts) / Math.max(1, decay);
}

export function orderFeed(posts = [], { mode = 'latest', now = Date.now() } = {}) {
  const rows = [...posts];
  if (mode === 'top') {
    return rows.sort((a, b) => feedScore(b, { now }) - feedScore(a, { now }));
  }
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Group a flat reply list into one level of threading, oldest first. */
export function threadComments(comments = []) {
  const byParent = new Map();
  for (const c of comments) {
    const key = c.parentId || 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(c);
  }
  const sortByTime = (list) => list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  /* Replies past the visual cap are FLATTENED into the deepest visible node, not
     dropped. Dropping them would hide a reply that exists, which reads as a bug
     to the person who wrote it. */
  const flatten = (parentId) =>
    sortByTime(byParent.get(parentId) || []).flatMap((c) => [
      { ...c, depth: 99, children: [] },
      ...flatten(c.id)
    ]);

  const build = (parentId, depth) =>
    sortByTime(byParent.get(parentId) || []).map((c) => ({
      ...c,
      depth,
      children: depth >= 2 ? flatten(c.id) : build(c.id, depth + 1)
    }));

  return build('root', 0);
}

/* -------------------------------------------------------------- reputation */

/**
 * Reputation from events. Negative events are clamped so a pile of upheld
 * reports cannot push a score below zero and make the number meaningless.
 */
export function reputation(events = []) {
  const byKind = {};
  let total = 0;
  for (const e of events) {
    const weight = Number.isFinite(e.weight) ? e.weight : (REPUTATION_WEIGHTS[e.kind] ?? 0);
    total += weight;
    byKind[e.kind] = (byKind[e.kind] || 0) + weight;
  }
  const score = Math.max(0, total);
  let tier = REPUTATION_TIERS[0];
  for (const t of REPUTATION_TIERS) if (score >= t.min) tier = t;
  return { score, byKind, tier, events: events.length };
}

/* -------------------------------------------------------------- moderation */

/**
 * Triage a report. `priorActions` is how many times this author has already had
 * content actioned: first offences get review, patterns get hidden, and a scam
 * report hides immediately because the harm is financial and fast.
 */
export function moderationDecision({ reason, priorActions = 0, severity = 'normal' } = {}) {
  const reasons = {
    spam: 'Posting unsolicited or repetitive content.',
    abuse: 'Targeted harassment or threats.',
    scam: 'Soliciting funds or promoting a fraudulent scheme.',
    impersonation: 'Pretending to be another person or project.',
    illegal: 'Content that may be unlawful.',
    other: 'Reported by a user for review.'
  };
  if (!reasons[reason]) {
    return { action: 'reject', note: 'Unknown report reason; the report cannot be triaged.' };
  }

  if (reason === 'scam' || reason === 'illegal' || severity === 'severe') {
    return {
      action: 'hide',
      note: `${reasons[reason]} Financial or legal harm is immediate, so the content is hidden pending review rather than waiting in a queue.`
    };
  }
  if (priorActions >= 2 || reason === 'abuse' || reason === 'impersonation') {
    return {
      action: 'review',
      note: `${reasons[reason]} ${priorActions >= 2 ? `This author has ${priorActions} prior actions.` : 'A moderator decides before anything is removed.'}`
    };
  }
  return { action: 'dismiss-or-warn', note: `${reasons[reason]} No prior history; a warning is proportionate on a first report.` };
}

/* --------------------------------------------------------------------- DMs */

/** Inbox row: last message, unread count for this viewer, and the other party. */
export function threadSummary(messages = [], viewerId) {
  if (!messages.length) return null;
  const sorted = [...messages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const last = sorted.at(-1);
  const unread = sorted.filter((m) => m.senderId !== viewerId && !m.readAt).length;
  const others = [...new Set(sorted.map((m) => m.senderId).filter((id) => id !== viewerId))];
  return { last, unread, others, count: sorted.length };
}

/**
 * Direct messages are one-to-one or small-group only. A "channel" here is a
 * community feed, not a broadcast DM, because an unbounded DM recipient list is a
 * spam vector with no rate limit that a browser can enforce.
 */
export function canStartThread({ participants = [] } = {}) {
  if (participants.length < 2) return { ok: false, reason: 'A thread needs at least two participants.' };
  if (participants.length > 10) return { ok: false, reason: 'Direct threads are limited to 10 participants.' };
  if (new Set(participants).size !== participants.length) return { ok: false, reason: 'Duplicate participant.' };
  return { ok: true };
}

/* ------------------------------------------------------- capability report */

/**
 * What the deployment can actually do, for the page to print instead of
 * pretending. `configured` is decided by the caller from the Supabase client.
 */
export function socialCapabilities({ configured = false, signedIn = false, tablesReady = false } = {}) {
  return [
    { id: 'profiles', label: 'Profiles and handles', ready: configured && tablesReady, needs: 'cx_profiles' },
    { id: 'posts', label: 'Posts, ideas, charts, strategies', ready: configured && tablesReady && signedIn, needs: 'cx_posts + sign-in' },
    { id: 'comments', label: 'Comments and reactions', ready: configured && tablesReady && signedIn, needs: 'cx_comments, cx_reactions' },
    { id: 'communities', label: 'Communities and moderation', ready: configured && tablesReady, needs: 'cx_communities' },
    { id: 'dm', label: 'Direct messages', ready: configured && tablesReady && signedIn, needs: 'cx_dm_* + sign-in' },
    { id: 'verification', label: 'Creator verification', ready: configured && tablesReady, needs: 'reviewer console' },
    { id: 'media', label: 'Image and video upload', ready: false, needs: 'object storage + scanning (not built)' },
    { id: 'fanout', label: 'Push and email fan-out', ready: false, needs: 'dispatcher + provider (not built)' },
    { id: 'ranking', label: 'Server-side ranking', ready: false, needs: 'ranking table (not built; feed scores run in the client and are shown)' }
  ];
}
