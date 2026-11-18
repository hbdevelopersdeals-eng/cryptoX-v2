import { describe, it, expect } from 'vitest';
import {
  POST_TYPES, VISIBILITIES, REACTIONS, SCHEMA_FINDINGS, toPost, toProfile, authorLabel,
  canView, canComment, validateDraft, publishOutcome, summariseReactions, reactionAction,
  validateReport, capabilities, BODY_LIMIT, TITLE_LIMIT
} from './socialRepo.js';

const row = {
  id: 'p1',
  user_id: 'u1',
  post_type: 'analysis',
  title: 'BTC structure',
  body: 'Higher lows',
  visibility: 'public',
  moderation_status: 'published',
  created_at: '2026-06-01T10:00:00Z'
};

describe('row mapping', () => {
  it('maps a post row onto the view model', () => {
    const p = toPost(row);
    expect(p).toMatchObject({ id: 'p1', authorId: 'u1', postType: 'analysis', visibility: 'public', moderationStatus: 'published' });
    expect(p.body).toBe('Higher lows');
  });

  it('turns absent optional text into null, never an empty string', () => {
    const p = toPost({ ...row, title: undefined, asset_id: undefined, chart_payload: undefined });
    expect(p.title).toBeNull();
    expect(p.assetId).toBeNull();
    expect(p.chartPayload).toEqual({});
  });

  it('falls back to created_at when updated_at is missing', () => {
    expect(toPost(row).updatedAt).toBe(row.created_at);
  });

  it('returns null for a missing row rather than a half-object', () => {
    expect(toPost(null)).toBeNull();
    expect(toProfile(undefined)).toBeNull();
  });

  it('maps a profile and defaults visibility to private', () => {
    expect(toProfile({ user_id: 'u1', username: 'satoshi_21', display_name: 'Satoshi' }))
      .toMatchObject({ userId: 'u1', username: 'satoshi_21', visibility: 'private' });
  });
});

describe('author labelling', () => {
  it('prefers the display name and keeps the handle', () => {
    expect(authorLabel({ displayName: 'Satoshi', username: 'satoshi_21' }))
      .toEqual({ text: 'Satoshi', handle: '@satoshi_21' });
  });

  it('falls back to the handle, then to unnamed', () => {
    expect(authorLabel({ username: 'anon_1' }).text).toBe('@anon_1');
    expect(authorLabel({}).text).toBe('unnamed');
  });

  it('says "author hidden" when there is no profile at all', () => {
    // This is the anonymous-reader case: anon holds no privilege on cx_profiles.
    expect(authorLabel(null)).toEqual({ text: 'author hidden', handle: null });
  });
});

describe('visibility mirrors cx_community_posts_read', () => {
  const published = { authorId: 'u1', moderationStatus: 'published', visibility: 'public' };

  it('shows a published public post to everyone, including anonymous', () => {
    expect(canView(published, {})).toBe(true);
    expect(canView(published, null)).toBe(true);
  });

  it('hides a pending post from other users but not from its author', () => {
    const pending = { ...published, moderationStatus: 'pending' };
    expect(canView(pending, { id: 'u2' })).toBe(false);
    expect(canView(pending, { id: 'u1' })).toBe(true);
  });

  it('hides hidden and removed posts from everyone except author and admin', () => {
    const hidden = { ...published, moderationStatus: 'hidden' };
    expect(canView(hidden, { id: 'u2' })).toBe(false);
    expect(canView(hidden, { id: 'u1' })).toBe(true);
    expect(canView(hidden, { id: 'u9', isAdmin: true })).toBe(true);
  });

  it('does NOT treat followers-only as visible to followers, because RLS does not', () => {
    const followers = { ...published, visibility: 'followers' };
    expect(canView(followers, { id: 'u2', following: ['u1'] })).toBe(false);
    expect(canView(followers, { id: 'u1' })).toBe(true);
  });

  it('keeps private posts to the author', () => {
    expect(canView({ ...published, visibility: 'private' }, { id: 'u2' })).toBe(false);
  });

  it('documents the defect in SCHEMA_FINDINGS rather than only in code', () => {
    const defect = SCHEMA_FINDINGS.find((f) => f.id === 'followers-visibility');
    expect(defect.severity).toBe('defect');
    expect(defect.detail).toMatch(/never consults cx_user_follows/);
  });
});

describe('commenting', () => {
  it('requires a signed-in viewer and a published post', () => {
    expect(canComment({ authorId: 'u1', moderationStatus: 'published', visibility: 'public' }, {})).toBe(false);
    expect(canComment({ authorId: 'u1', moderationStatus: 'pending', visibility: 'public' }, { id: 'u2' })).toBe(false);
    expect(canComment({ authorId: 'u1', moderationStatus: 'published', visibility: 'public' }, { id: 'u2' })).toBe(true);
  });
});

describe('draft validation', () => {
  it('accepts a valid draft and always sends moderation_status explicitly', () => {
    const d = validateDraft({ postType: 'analysis', title: 'BTC', body: 'Higher lows' });
    expect(d.valid).toBe(true);
    expect(d.insert).toEqual({ post_type: 'analysis', title: 'BTC', body: 'Higher lows', visibility: 'public', moderation_status: 'pending' });
  });

  it('requires a body and bounds it', () => {
    expect(validateDraft({ body: '  ' }).errors[0]).toMatch(/Write something/);
    expect(validateDraft({ body: 'x'.repeat(BODY_LIMIT + 1) }).errors.join(' ')).toMatch(/limited to 5000/);
  });

  it('bounds the title and allows an empty one', () => {
    expect(validateDraft({ body: 'x', title: 'y'.repeat(TITLE_LIMIT + 1) }).valid).toBe(false);
    expect(validateDraft({ body: 'x', title: '' }).insert.title).toBeNull();
  });

  it('rejects a post type the CHECK constraint would reject', () => {
    expect(validateDraft({ postType: 'idea', body: 'x' }).valid).toBe(false);
    expect(POST_TYPES.map((t) => t.id)).toContain('market_insight');
  });

  it('warns that followers-only is not honoured, and still allows it', () => {
    const d = validateDraft({ body: 'x', visibility: 'followers' });
    expect(d.valid).toBe(true);
    expect(d.warnings.join(' ')).toMatch(/visible only to you/);
    expect(VISIBILITIES.find((v) => v.id === 'followers').honoured).toBe(false);
  });

  it('rejects a visibility outside the CHECK constraint', () => {
    expect(validateDraft({ body: 'x', visibility: 'community' }).valid).toBe(false);
  });
});

describe('publish outcome wording', () => {
  it('never says published when the row is pending', () => {
    const o = publishOutcome({ moderation_status: 'pending' });
    expect(o.tone).toBe('pending');
    expect(o.message).not.toMatch(/^Published/);
    expect(o.message).toMatch(/until a moderator publishes/);
  });

  it('says published only for a row that really is published', () => {
    expect(publishOutcome({ moderation_status: 'published' }).tone).toBe('live');
  });

  it('defaults to pending when the row is missing', () => {
    expect(publishOutcome(null).tone).toBe('pending');
  });
});

describe('reactions', () => {
  const rows = [
    { post_id: 'p1', user_id: 'u2', reaction: 'like' },
    { post_id: 'p1', user_id: 'u3', reaction: 'like' },
    { post_id: 'p1', user_id: 'u2', reaction: 'bullish' },
    { post_id: 'p1', user_id: 'u9', reaction: 'not-a-kind' }
  ];

  it('counts known kinds and ignores anything outside the CHECK list', () => {
    const s = summariseReactions(rows, 'u2');
    expect(s.counts.like).toBe(2);
    expect(s.counts.bullish).toBe(1);
    expect(s.counts.bearish).toBe(0);
    expect(s.total).toBe(3);
  });

  it('reports what this viewer already sent', () => {
    expect(summariseReactions(rows, 'u2').mine.sort()).toEqual(['bullish', 'like']);
  });

  it('toggles against the composite primary key', () => {
    expect(reactionAction(false, 'like')).toEqual({ op: 'insert', kind: 'like' });
    expect(reactionAction(true, 'like')).toEqual({ op: 'delete', kind: 'like' });
    expect(REACTIONS.map((r) => r.id)).toEqual(['like', 'insightful', 'bullish', 'bearish']);
  });
});

describe('reports', () => {
  it('builds an insert with a string target id, because the column is text', () => {
    const r = validateReport({ targetType: 'post', targetId: 'p1', reason: 'spam' });
    expect(r.valid).toBe(true);
    expect(r.insert.target_id).toBe('p1');
    expect(typeof r.insert.target_id).toBe('string');
  });

  it('rejects a target type outside the CHECK list', () => {
    expect(validateReport({ targetType: 'thread', targetId: 'x', reason: 'spam' }).valid).toBe(false);
  });

  it('requires a target and a reason', () => {
    const r = validateReport({ targetType: 'post', reason: 'nonsense' });
    expect(r.errors).toContain('A report needs a target id.');
    expect(r.errors).toContain('Choose a reason.');
  });

  it('bounds the detail field', () => {
    expect(validateReport({ targetType: 'post', targetId: 'p', reason: 'spam', details: 'x'.repeat(1001) }).valid).toBe(false);
  });
});

describe('capability rows', () => {
  it('refuses to offer publishing without a provisioned profile', () => {
    const rows = capabilities({ signedIn: true, profileExists: false, tablesReady: true });
    const post = rows.find((r) => r.id === 'post');
    expect(post.ready).toBe(false);
    expect(post.needs).toMatch(/provisioned profile/);
  });

  it('marks the three schema-level impossibilities as not ready', () => {
    const rows = capabilities({ signedIn: true, profileExists: true, tablesReady: true });
    for (const id of ['create-profile', 'delete-own', 'followers-only']) {
      expect(rows.find((r) => r.id === id).ready).toBe(false);
    }
  });

  it('marks reading ready without sign-in, and writing not', () => {
    const rows = capabilities({ signedIn: false, profileExists: false, tablesReady: true });
    expect(rows.find((r) => r.id === 'read').ready).toBe(true);
    expect(rows.find((r) => r.id === 'comment').ready).toBe(false);
  });

  it('marks everything unready when the tables are unreachable', () => {
    const rows = capabilities({ signedIn: true, profileExists: true, tablesReady: false });
    expect(rows.filter((r) => r.ready)).toHaveLength(0);
  });
});
