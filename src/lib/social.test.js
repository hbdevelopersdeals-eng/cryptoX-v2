import { describe, it, expect } from 'vitest';
import {
  validateHandle, validateProfile, validatePost, canViewPost, canEdit, parseMentions,
  parseCashtags, feedScore, orderFeed, threadComments, reputation, moderationDecision,
  threadSummary, canStartThread, socialCapabilities, EDIT_WINDOW_MINUTES, BODY_LIMIT
} from './social.js';

describe('handles and profiles', () => {
  it('accepts a lowercase handle and normalises case', () => {
    expect(validateHandle('Satoshi_21')).toEqual({ valid: true, value: 'satoshi_21' });
  });

  it('rejects handles that are too short, too long or oddly cased characters', () => {
    expect(validateHandle('ab').valid).toBe(false);
    expect(validateHandle('a'.repeat(21)).valid).toBe(false);
    expect(validateHandle('has space').valid).toBe(false);
    expect(validateHandle('emoji😀').valid).toBe(false);
    expect(validateHandle('').valid).toBe(false);
  });

  it('validates a full profile', () => {
    const ok = validateProfile({ handle: 'traderjoe', displayName: 'Trader Joe' });
    expect(ok.valid).toBe(true);
    expect(ok.handle).toBe('traderjoe');
  });

  it('names every profile problem', () => {
    const r = validateProfile({ handle: 'x', displayName: '', bio: 'b'.repeat(300), avatarUrl: 'http://insecure' });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(4);
  });
});

describe('post composition', () => {
  it('requires a body for an ordinary post', () => {
    expect(validatePost({ body: '   ' }).errors[0]).toMatch(/Write something/);
  });

  it('allows an empty body only for a repost', () => {
    const bare = validatePost({ kind: 'repost', body: '', parenId: null, parentId: 'p1' });
    expect(bare.valid).toBe(true);
    expect(validatePost({ kind: 'post', body: '' }).valid).toBe(false);
  });

  it('requires a parent for reposts and quotes', () => {
    expect(validatePost({ kind: 'repost', body: '', parentId: null }).errors.join(' ')).toMatch(/point at an existing post/);
    expect(validatePost({ kind: 'quote', body: 'agreed' }).errors.join(' ')).toMatch(/reference another post/);
  });

  it('enforces the body limit', () => {
    expect(validatePost({ body: 'x'.repeat(BODY_LIMIT + 1) }).errors.join(' ')).toMatch(/limited to 5000/);
  });

  it('pairs community visibility with a community, both directions', () => {
    expect(validatePost({ body: 'hi', visibility: 'community' }).errors.join(' ')).toMatch(/needs a community/);
    expect(validatePost({ body: 'hi', visibility: 'public', communityId: 'c1' }).errors.join(' ')).toMatch(/must use community visibility/);
    expect(validatePost({ body: 'hi', visibility: 'community', communityId: 'c1' }).valid).toBe(true);
  });

  it('requires an instrument and a side on a trading idea', () => {
    const r = validatePost({ kind: 'idea', body: 'breakout', payload: {} });
    expect(r.errors.join(' ')).toMatch(/instrument/);
    expect(r.errors.join(' ')).toMatch(/side/);
    expect(validatePost({ kind: 'idea', body: 'breakout', payload: { instrument: 'BTC', side: 'long' } }).valid).toBe(true);
  });

  it('rejects an unknown kind or visibility', () => {
    expect(validatePost({ kind: 'manifesto', body: 'x' }).valid).toBe(false);
    expect(validatePost({ body: 'x', visibility: 'world' }).valid).toBe(false);
  });
});

describe('visibility predicate mirrors the database', () => {
  const base = { authorId: 'a1', status: 'published', communityId: 'c1', createdAt: '2026-06-01T00:00:00Z' };

  it('lets the author always see their own post, even hidden', () => {
    expect(canViewPost({ ...base, visibility: 'private', status: 'hidden' }, { id: 'a1' })).toBe(true);
  });

  it('hides non-published posts from everyone else', () => {
    expect(canViewPost({ ...base, visibility: 'public', status: 'hidden' }, { id: 'u2' })).toBe(false);
    expect(canViewPost({ ...base, visibility: 'public', status: 'removed' }, { id: 'u2' })).toBe(false);
  });

  it('shows public posts to anonymous readers', () => {
    expect(canViewPost({ ...base, visibility: 'public' }, null)).toBe(true);
  });

  it('gates followers-only posts on an actual follow', () => {
    const post = { ...base, visibility: 'followers' };
    expect(canViewPost(post, { id: 'u2', following: [] })).toBe(false);
    expect(canViewPost(post, { id: 'u2', following: ['a1'] })).toBe(true);
  });

  it('gates community posts on membership', () => {
    const post = { ...base, visibility: 'community' };
    expect(canViewPost(post, { id: 'u2', communities: [] })).toBe(false);
    expect(canViewPost(post, { id: 'u2', communities: ['c1'] })).toBe(true);
  });

  it('never shows a private post to another account', () => {
    expect(canViewPost({ ...base, visibility: 'private' }, { id: 'u2', following: ['a1'] })).toBe(false);
  });

  it('fails closed on a missing post or unknown visibility', () => {
    expect(canViewPost(null, { id: 'u2' })).toBe(false);
    expect(canViewPost({ ...base, visibility: 'nonsense' }, { id: 'u2' })).toBe(false);
  });
});

describe('edit window', () => {
  const post = { authorId: 'a1', createdAt: '2026-06-01T12:00:00Z' };
  const at = (mins) => Date.parse('2026-06-01T12:00:00Z') + mins * 60000;

  it('allows the author to edit inside the window', () => {
    expect(canEdit(post, { id: 'a1' }, at(EDIT_WINDOW_MINUTES - 1))).toBe(true);
  });

  it('closes the window afterwards', () => {
    expect(canEdit(post, { id: 'a1' }, at(EDIT_WINDOW_MINUTES + 1))).toBe(false);
  });

  it('never allows another account to edit', () => {
    expect(canEdit(post, { id: 'u2' }, at(0))).toBe(false);
  });
});

describe('mentions and cashtags', () => {
  it('finds handles once, in order, with positions', () => {
    const out = parseMentions('hi @alice and @bob, cc @alice');
    expect(out.map((m) => m.handle)).toEqual(['alice', 'bob']);
    expect(out[0].index).toBe(3);
  });

  it('ignores an email-shaped token', () => {
    expect(parseMentions('mail me at a@b.com')).toEqual([]);
  });

  it('uppercases cashtags and dedupes', () => {
    expect(parseCashtags('$btc and $BTC plus $eth').map((c) => c.symbol)).toEqual(['BTC', 'ETH']);
  });
});

describe('feed ordering', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  const fresh = { id: 'fresh', createdAt: '2026-06-01T11:00:00Z', likes: 5, comments: 1, reposts: 0 };
  const old = { id: 'old', createdAt: '2026-05-30T12:00:00Z', likes: 40, comments: 5, reposts: 2 };

  it('decays with age', () => {
    expect(feedScore(fresh, { now })).toBeGreaterThan(feedScore(old, { now }));
  });

  it('orders latest chronologically and top by score', () => {
    expect(orderFeed([old, fresh], { mode: 'latest', now })[0].id).toBe('fresh');
    expect(orderFeed([old, fresh], { mode: 'top', now })[0].id).toBe('fresh');
  });

  it('survives a post with no engagement and a bad date', () => {
    expect(Number.isFinite(feedScore({ createdAt: 'nonsense' }, { now }))).toBe(true);
  });

  it('does not mutate the input array', () => {
    const input = [old, fresh];
    orderFeed(input, { mode: 'top', now });
    expect(input[0].id).toBe('old');
  });
});

describe('comment threading', () => {
  it('nests replies and stops at depth three', () => {
    const rows = [
      { id: '1', parentId: null, createdAt: '2026-06-01T10:00:00Z' },
      { id: '2', parentId: '1', createdAt: '2026-06-01T10:01:00Z' },
      { id: '3', parentId: '2', createdAt: '2026-06-01T10:02:00Z' },
      { id: '4', parentId: '3', createdAt: '2026-06-01T10:03:00Z' }
    ];
    const tree = threadComments(rows);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].id).toBe('3');
    // The fourth reply is flattened into the deepest node rather than dropped.
    const deep = tree[0].children[0].children[0].children;
    expect(deep.map((c) => c.id)).toEqual(['4']);
    expect(deep[0].children).toEqual([]);
  });

  it('keeps orphans out rather than inventing a parent', () => {
    expect(threadComments([{ id: 'x', parentId: 'missing', createdAt: '2026-06-01T10:00:00Z' }])).toEqual([]);
  });
});

describe('reputation', () => {
  it('sums weights and reports the tier', () => {
    const r = reputation([{ kind: 'post', weight: 2 }, { kind: 'post', weight: 2 }]);
    expect(r.score).toBe(4);
    expect(r.tier.id).toBe('new');
    expect(r.byKind.post).toBe(4);
  });

  it('reaches a higher tier as the score grows', () => {
    expect(reputation(Array.from({ length: 60 }, () => ({ kind: 'like_received', weight: 1 }))).tier.id).toBe('member');
    expect(reputation(Array.from({ length: 120 }, () => ({ kind: 'like_received', weight: 1 }))).tier.id).toBe('contributor');
  });

  it('clamps at zero rather than going negative', () => {
    expect(reputation([{ kind: 'report_upheld', weight: -10 }]).score).toBe(0);
  });

  it('falls back to the documented weight when one is missing', () => {
    expect(reputation([{ kind: 'comment' }]).score).toBe(1);
  });
});

describe('moderation triage', () => {
  it('hides a scam report immediately', () => {
    const d = moderationDecision({ reason: 'scam' });
    expect(d.action).toBe('hide');
    expect(d.note).toMatch(/immediate/);
  });

  it('sends abuse and impersonation to review', () => {
    expect(moderationDecision({ reason: 'abuse' }).action).toBe('review');
    expect(moderationDecision({ reason: 'impersonation' }).action).toBe('review');
  });

  it('escalates a repeat offender whatever the reason', () => {
    expect(moderationDecision({ reason: 'spam', priorActions: 3 }).action).toBe('review');
    expect(moderationDecision({ reason: 'spam', priorActions: 3 }).note).toMatch(/3 prior actions/);
  });

  it('warns on a first minor report', () => {
    expect(moderationDecision({ reason: 'spam' }).action).toBe('dismiss-or-warn');
  });

  it('refuses an unknown reason instead of guessing', () => {
    expect(moderationDecision({ reason: 'dislike' }).action).toBe('reject');
  });
});

describe('direct messages', () => {
  const msgs = [
    { id: 'm1', senderId: 'u1', body: 'hi', createdAt: '2026-06-01T10:00:00Z', readAt: null },
    { id: 'm2', senderId: 'u2', body: 'yo', createdAt: '2026-06-01T10:05:00Z', readAt: '2026-06-01T10:06:00Z' },
    { id: 'm3', senderId: 'u2', body: 'again', createdAt: '2026-06-01T10:07:00Z', readAt: null }
  ];

  it('summarises the last message and unread count for the viewer', () => {
    const s = threadSummary(msgs, 'u1');
    expect(s.last.id).toBe('m3');
    expect(s.unread).toBe(1);
    expect(s.others).toEqual(['u2']);
  });

  it('counts the other side unread from the opposite view', () => {
    expect(threadSummary(msgs, 'u2').unread).toBe(1);
  });

  it('returns null for an empty thread', () => {
    expect(threadSummary([], 'u1')).toBeNull();
  });

  it('bounds thread size and rejects duplicates', () => {
    expect(canStartThread({ participants: ['u1'] }).ok).toBe(false);
    expect(canStartThread({ participants: Array.from({ length: 11 }, (_, i) => `u${i}`) }).ok).toBe(false);
    expect(canStartThread({ participants: ['u1', 'u1'] }).ok).toBe(false);
    expect(canStartThread({ participants: ['u1', 'u2'] }).ok).toBe(true);
  });
});

describe('capability report', () => {
  it('marks unbuilt capabilities as not ready and says why', () => {
    const rows = socialCapabilities({ configured: true, signedIn: true, tablesReady: true });
    const media = rows.find((r) => r.id === 'media');
    expect(media.ready).toBe(false);
    expect(media.needs).toMatch(/not built/);
    const ranking = rows.find((r) => r.id === 'ranking');
    expect(ranking.ready).toBe(false);
  });

  it('requires sign-in for anything that writes', () => {
    const rows = socialCapabilities({ configured: true, signedIn: false, tablesReady: true });
    expect(rows.find((r) => r.id === 'posts').ready).toBe(false);
    expect(rows.find((r) => r.id === 'profiles').ready).toBe(true);
  });

  it('requires the tables as well as a client', () => {
    const rows = socialCapabilities({ configured: true, signedIn: true, tablesReady: false });
    expect(rows.every((r) => !r.ready || r.id === 'media' || r.id === 'fanout' || r.id === 'ranking')).toBe(true);
  });
});
