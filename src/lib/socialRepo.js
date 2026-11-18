/* Adapter over the social tables that ALREADY EXIST in the deployment.
 *
 * Measured from production on 18 Nov 2026 (information_schema + pg_policies), not
 * assumed. The schema is:
 *
 *   cx_profiles              user_id PK, username, display_name, avatar_url, bio,
 *                            profile_visibility ('private'|'public'), read own-or-public
 *   cx_community_posts       user_id, post_type, title, body, asset_id,
 *                            chart_payload, visibility, moderation_status
 *   cx_community_comments    post_id, user_id, parent_comment_id, body, moderation_status
 *   cx_community_reactions   (post_id, user_id, reaction) PK; like|insightful|bullish|bearish
 *   cx_user_follows          (follower_id, followed_id) PK
 *   cx_moderation_reports    reporter_id, target_type, target_id (text), reason, status
 *   cx_user_verification_status  user_id, status
 *
 * THREE THINGS THE SCHEMA DOES THAT THE UI MUST NOT PRETEND ABOUT
 *
 * 1. A post is born `pending` and the INSERT policy REQUIRES that value. Nothing
 *    a normal user can do sets `published`. So after a successful submit the post
 *    is invisible to everyone but its author. The UI therefore says "pending
 *    review", never "published", and the author sees their own pending row with a
 *    badge.
 *
 * 2. `followers` visibility is NOT honoured. The read policy is
 *    (published AND public) OR own OR admin — there is no follow check, so a
 *    followers-only post is readable by its author alone. This module reports
 *    that as a defect (`SCHEMA_FINDINGS`) rather than offering a control that
 *    silently behaves like `private`.
 *
 * 3. Profiles cannot be inserted from a client: `cx_profiles` has SELECT and
 *    UPDATE policies but no INSERT policy. Claim-a-handle is impossible without a
 *    trigger or the privileged path, so the page does not show that form.
 *
 * `canView` mirrors the measured policy expression, and the tests pin the two
 * together. A client predicate that disagrees with RLS either hides content the
 * server would serve or shows content it would refuse; both are defects.
 */

export const POST_TYPES = [
  { id: 'analysis', label: 'Analysis' },
  { id: 'research', label: 'Research' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'market_insight', label: 'Market insight' },
  { id: 'discussion', label: 'Discussion' }
];

export const VISIBILITIES = [
  { id: 'public', label: 'Everyone', honoured: true },
  {
    id: 'followers',
    label: 'Followers',
    honoured: false,
    note: 'The current read policy has no follow check, so this behaves like "Only me" until the policy changes.'
  },
  { id: 'private', label: 'Only me', honoured: true }
];

export const REACTIONS = [
  { id: 'like', label: 'Like' },
  { id: 'insightful', label: 'Insightful' },
  { id: 'bullish', label: 'Bullish' },
  { id: 'bearish', label: 'Bearish' }
];

export const REPORT_REASONS = ['spam', 'abuse', 'scam', 'impersonation', 'illegal', 'other'];

export const BODY_LIMIT = 5000;
export const TITLE_LIMIT = 140;

/** What the schema permits, stated once so the page can print it. */
export const SCHEMA_FINDINGS = [
  {
    id: 'moderation-gate',
    severity: 'by-design',
    title: 'Posts start as pending review',
    detail: 'The INSERT policy requires moderation_status = pending and no user-writable path sets published. A submitted post is visible only to its author until a moderator publishes it.'
  },
  {
    id: 'followers-visibility',
    severity: 'defect',
    title: 'Followers-only posts are readable by the author alone',
    detail: 'The read policy checks (published AND public) OR own OR admin. It never consults cx_user_follows, so "followers" is currently equivalent to "only me".'
  },
  {
    id: 'profile-insert',
    severity: 'defect',
    title: 'A profile cannot be created from the client',
    detail: 'cx_profiles has SELECT and UPDATE policies but no INSERT policy. Rows must be provisioned by a trigger or service role; a client insert is refused.'
  },
  {
    id: 'no-delete',
    severity: 'limitation',
    title: 'Authors cannot delete their own posts',
    detail: 'cx_community_posts has SELECT, INSERT and UPDATE policies only. There is no DELETE policy, and UPDATE is restricted to rows still pending.'
  },
  {
    id: 'anon-author-gap',
    severity: 'limitation',
    title: 'Anonymous readers cannot see who wrote a post',
    detail: 'anon holds no privilege on cx_profiles, while posts are readable anonymously. A signed-out feed therefore has no author names; the page shows "author hidden" rather than inventing one.'
  }
];

/* ------------------------------------------------------------------ mapping */

/** Database row -> view model. Nullable text becomes null, never ''. */
export function toPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.user_id,
    postType: row.post_type,
    title: row.title || null,
    body: row.body || '',
    assetId: row.asset_id || null,
    chartPayload: row.chart_payload || {},
    visibility: row.visibility,
    moderationStatus: row.moderation_status,
    editedAt: row.edited_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

export function toProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    username: row.username || null,
    displayName: row.display_name || null,
    avatarUrl: row.avatar_url || null,
    bio: row.bio || null,
    visibility: row.profile_visibility || 'private'
  };
}

/** The label a card shows for its author, honest about a missing profile. */
export function authorLabel(profile) {
  if (!profile) return { text: 'author hidden', handle: null };
  const handle = profile.username ? `@${profile.username}` : null;
  const name = profile.displayName || handle || 'unnamed';
  return { text: name, handle };
}

/**
 * Mirror of cx_community_posts_read, including the admin escape hatch:
 *   (published AND public) OR own OR content_admin OR super_admin
 */
export function canView(post, viewer = {}) {
  if (!post) return false;
  /* `viewer || {}` rather than a default parameter: an anonymous caller passes
     null explicitly, and a default only covers `undefined`. */
  const who = viewer || {};
  if (who.id && post.authorId === who.id) return true;
  if (who.isAdmin) return true;
  return post.moderationStatus === 'published' && post.visibility === 'public';
}

/** Comments carry no visibility of their own; they inherit the post's. */
export function canComment(post, viewer = {}) {
  return Boolean(viewer.id) && post?.moderationStatus === 'published' && canView(post, viewer);
}

/* -------------------------------------------------------------- composition */

export function validateDraft({ postType = 'analysis', title = '', body = '', visibility = 'public' } = {}) {
  const errors = [];

  if (!POST_TYPES.some((t) => t.id === postType)) {
    errors.push(`Unknown post type "${postType}".`);
  }
  const text = String(body ?? '').trim();
  if (!text) errors.push('Write something before posting.');
  else if (text.length > BODY_LIMIT) errors.push(`Posts are limited to ${BODY_LIMIT} characters.`);

  const heading = String(title ?? '').trim();
  if (heading.length > TITLE_LIMIT) errors.push(`Title must be at most ${TITLE_LIMIT} characters.`);

  if (!VISIBILITIES.some((v) => v.id === visibility)) errors.push(`Unknown visibility "${visibility}".`);

  return {
    valid: errors.length === 0,
    errors,
    warnings: visibility === 'followers'
      ? ['Followers-only is not honoured by the current read policy; the post will be visible only to you.']
      : [],
    insert: {
      post_type: postType,
      title: heading || null,
      body: text,
      visibility,
      /* Sent explicitly: the default is already 'pending', and relying on a
         default for a value a policy checks is how an insert fails unexpectedly. */
      moderation_status: 'pending'
    }
  };
}

/** Exact message after a successful insert, so nobody thinks it went live. */
export function publishOutcome(row) {
  const status = row?.moderation_status || 'pending';
  if (status === 'published') {
    return { tone: 'live', message: 'Published. It is visible in the public feed now.' };
  }
  return {
    tone: 'pending',
    message: 'Submitted for review. It is visible to you only until a moderator publishes it.'
  };
}

/* -------------------------------------------------------------- engagement */

/** Reaction counts grouped by kind, plus what this viewer sent. */
export function summariseReactions(rows = [], viewerId = null) {
  const counts = Object.fromEntries(REACTIONS.map((r) => [r.id, 0]));
  const mine = new Set();
  for (const r of rows) {
    if (counts[r.reaction] != null) counts[r.reaction] += 1;
    if (viewerId && r.user_id === viewerId) mine.add(r.reaction);
  }
  return { counts, mine: [...mine], total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** Toggle semantics for the composite primary key (post_id, user_id, reaction). */
export function reactionAction(currentlyMine, kind) {
  return currentlyMine ? { op: 'delete', kind } : { op: 'insert', kind };
}

/* --------------------------------------------------------------- reporting */

export function validateReport({ targetType, targetId, reason, details = '' } = {}) {
  const errors = [];
  if (!['user', 'post', 'comment', 'asset', 'news'].includes(targetType)) {
    errors.push('Unknown report target.');
  }
  if (!targetId) errors.push('A report needs a target id.');
  if (!REPORT_REASONS.includes(reason)) errors.push('Choose a reason.');
  if (String(details).length > 1000) errors.push('Details must be at most 1000 characters.');
  return {
    valid: errors.length === 0,
    errors,
    insert: {
      target_type: targetType,
      /* The column is text, not uuid, so a post id is passed as a string. */
      target_id: String(targetId ?? ''),
      reason,
      details: String(details || '') || null
    }
  };
}

/* ------------------------------------------------------------- capabilities */

/**
 * Capability rows for the page header. `profileExists` matters because there is
 * no way to create one from the client: showing a create form would be a control
 * that always fails.
 */
export function capabilities({ signedIn = false, profileExists = false, tablesReady = false } = {}) {
  return [
    { id: 'read', label: 'Read the public feed', ready: tablesReady, needs: 'cx_community_posts' },
    { id: 'post', label: 'Publish a post (queued for review)', ready: tablesReady && signedIn && profileExists, needs: !signedIn ? 'sign in' : !profileExists ? 'a provisioned profile row' : 'cx_community_posts' },
    { id: 'comment', label: 'Comment on a published post', ready: tablesReady && signedIn, needs: signedIn ? 'cx_community_comments' : 'sign in' },
    { id: 'react', label: 'React: like, insightful, bullish, bearish', ready: tablesReady && signedIn, needs: signedIn ? 'cx_community_reactions' : 'sign in' },
    { id: 'follow', label: 'Follow an author', ready: tablesReady && signedIn, needs: signedIn ? 'cx_user_follows' : 'sign in' },
    { id: 'report', label: 'Report content for moderation', ready: tablesReady && signedIn, needs: signedIn ? 'cx_moderation_reports' : 'sign in' },
    { id: 'create-profile', label: 'Create a profile from the app', ready: false, needs: 'no INSERT policy — needs a trigger or privileged path' },
    { id: 'delete-own', label: 'Delete your own post', ready: false, needs: 'no DELETE policy' },
    { id: 'followers-only', label: 'Followers-only visibility', ready: false, needs: 'read policy has no follow check' },
    { id: 'media', label: 'Image upload', ready: false, needs: 'object storage + scanning (not built)' }
  ];
}
