import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, PenLine, Flag, AlertTriangle, Info, Users } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { supabase, supabaseConfigured } from '../lib/supabase.js';
import {
  POST_TYPES, VISIBILITIES, REACTIONS, SCHEMA_FINDINGS, toPost, toProfile, authorLabel,
  canView, canComment, validateDraft, publishOutcome, summariseReactions, reactionAction,
  validateReport, capabilities, BODY_LIMIT, TITLE_LIMIT
} from '../lib/socialRepo.js';
import { Card, SectionTitle, Stat, EmptyState } from '../components/ui.jsx';

/* Social (Section 17) — bound to the tables that already exist in the deployment.
 *
 * No new schema was added: the project already carries cx_profiles,
 * cx_community_posts, cx_community_comments, cx_community_reactions,
 * cx_user_follows, cx_moderation_reports and cx_user_verification_status. This
 * page is an adapter over those, and it reports what they actually do — including
 * three things they cannot do (see SCHEMA_FINDINGS) instead of hiding them behind
 * controls that fail.
 *
 * The most important sentence on this page is the one after you press Publish:
 * a post is created `pending` and only a moderator can publish it. Saying
 * "published" there would be a lie the database immediately contradicts.
 */

const timeAgo = (iso) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

const errorKind = (message = '') => {
  if (/permission denied|row-level security|policy/i.test(message)) return 'policy';
  if (/does not exist|schema cache|relation/i.test(message)) return 'missing-table';
  return 'other';
};

export default function SocialPage() {
  const auth = useAuth() || {};
  const user = auth.user || null;

  const [posts, setPosts] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [myProfile, setMyProfile] = useState(null);
  const [reactions, setReactions] = useState([]);
  const [comments, setComments] = useState([]);
  const [follows, setFollows] = useState(new Set());
  const [tablesReady, setTablesReady] = useState(supabaseConfigured);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);

  const [draft, setDraft] = useState({ postType: 'analysis', title: '', body: '', visibility: 'public' });
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [formError, setFormError] = useState(null);

  const [reporting, setReporting] = useState(null);
  const [reportReason, setReportReason] = useState('spam');
  const [reportDone, setReportDone] = useState(null);
  const [commentFor, setCommentFor] = useState(null);
  const [commentBody, setCommentBody] = useState('');
  const [commentNotice, setCommentNotice] = useState(null);

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const ability = useMemo(
    () => ({ id: user?.id, isAdmin: Boolean(user?.isAdmin) }),
    [user]
  );

  const load = useCallback(async () => {
    if (!supabase || !supabaseConfigured) return;
    setLoading(true);
    setLoadError(null);

    const { data: rows, error } = await supabase
      .from('cx_community_posts')
      .select('id,user_id,post_type,title,body,asset_id,chart_payload,visibility,moderation_status,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(40);

    if (error) {
      setTablesReady(false);
      setLoadError({ kind: errorKind(error.message), message: error.message });
      setPosts([]);
      setLoading(false);
      return;
    }

    setTablesReady(true);
    const mapped = (rows || []).map(toPost).filter((p) => canView(p, ability));
    setPosts(mapped);

    const ids = [...new Set(mapped.map((p) => p.authorId))];
    if (ids.length && user) {
      /* Profiles are readable only to `authenticated`; an anonymous reader gets
         "author hidden" rather than a fabricated name. */
      const { data: profs } = await supabase
        .from('cx_profiles')
        .select('user_id,username,display_name,avatar_url,bio,profile_visibility')
        .in('user_id', ids);
      const map = {};
      for (const p of profs || []) map[p.user_id] = toProfile(p);
      setProfiles(map);
    }

    const postIds = mapped.map((p) => p.id);
    if (postIds.length && user) {
      const { data: rx } = await supabase
        .from('cx_community_reactions')
        .select('post_id,user_id,reaction')
        .in('post_id', postIds);
      setReactions(rx || []);

      const { data: cm } = await supabase
        .from('cx_community_comments')
        .select('id,post_id,user_id,parent_comment_id,body,moderation_status,created_at')
        .in('post_id', postIds)
        .eq('moderation_status', 'published');
      setComments(cm || []);
    }

    if (user?.id) {
      const { data: mine } = await supabase
        .from('cx_profiles')
        .select('user_id,username,display_name,avatar_url,bio,profile_visibility')
        .eq('user_id', user.id)
        .maybeSingle();
      setMyProfile(toProfile(mine));

      const { data: fol } = await supabase
        .from('cx_user_follows')
        .select('followed_id')
        .eq('follower_id', user.id);
      setFollows(new Set((fol || []).map((f) => f.followed_id)));
    }

    setLoading(false);
  }, [user, ability]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!validation.valid || !user?.id || !supabase) return;
    setSubmitting(true);
    setFormError(null);
    setOutcome(null);

    /* Through a function, not a table. The function enforces auth.uid(), validates
       the type and body length, and always writes moderation_status = 'pending'. */
    const { data: newPostId, error } = await supabase.rpc('cx_social_create_post', {
      p_post_type: validation.insert.post_type,
      p_title: validation.insert.title,
      p_body: validation.insert.body,
      p_visibility: validation.insert.visibility
    });

    setSubmitting(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setOutcome(publishOutcome(newPostId ? { moderation_status: 'pending' } : null));
    setDraft((d) => ({ ...d, title: '', body: '' }));
    load();
  };

  const toggleReaction = async (postId, kind) => {
    if (!user?.id || !supabase) return;
    const mine = summariseReactions(reactions.filter((r) => r.post_id === postId), user.id).mine.includes(kind);
    const action = reactionAction(mine, kind);

    /* One call either way: the function owns the insert-or-delete decision, so the
       client cannot target another user's row. */
    const { error } = await supabase.rpc('cx_social_set_reaction', {
      p_post_id: postId,
      p_reaction: kind,
      p_on: action.op === 'insert'
    });
    if (error) {
      setFormError(error.message);
      return;
    }
    load();
  };

  const toggleFollow = async (authorId) => {
    if (!user?.id || !supabase || authorId === user.id) return;
    const already = follows.has(authorId);
    const { error } = await supabase.rpc('cx_social_set_follow', {
      p_target: authorId,
      p_on: !already
    });
    if (error) {
      setFormError(error.message);
      return;
    }
    setFollows((prev) => {
      const next = new Set(prev);
      if (already) next.delete(authorId);
      else next.add(authorId);
      return next;
    });
  };

  const sendReport = async (postId) => {
    if (!user?.id || !supabase) return;
    const check = validateReport({ targetType: 'post', targetId: postId, reason: reportReason });
    if (!check.valid) {
      setFormError(check.errors.join(' '));
      return;
    }
    const { error } = await supabase.rpc('cx_social_report', {
      p_target_type: check.insert.target_type,
      p_target_id: check.insert.target_id,
      p_reason: check.insert.reason,
      p_details: check.insert.details
    });
    if (error) {
      setFormError(error.message);
      return;
    }
    setReporting(null);
    setReportDone(postId);
  };

  const sendComment = async (postId) => {
    if (!user?.id || !supabase) return;
    const text = commentBody.trim();
    if (!text) {
      setCommentNotice({ postId, tone: 'error', text: 'Write something first.' });
      return;
    }

    /* Sent explicitly as `pending`: the INSERT policy requires it, and a comment
       that claims to be published before a moderator has seen it is the same lie
       the post composer avoids. */
    const { error } = await supabase.rpc('cx_social_create_comment', {
      p_post_id: postId,
      p_body: text.slice(0, 2000)
    });

    if (error) {
      setCommentNotice({ postId, tone: 'error', text: error.message });
      return;
    }
    setCommentBody('');
    setCommentFor(null);
    setCommentNotice({
      postId,
      tone: 'pending',
      text: 'Comment submitted for review. It appears once a moderator publishes it.'
    });
    load();
  };

  const caps = capabilities({ signedIn: Boolean(user), profileExists: Boolean(myProfile), tablesReady });
  const canPublish = caps.find((c) => c.id === 'post').ready;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Social"
        sub="Community analysis, research and discussion, backed by the tables already in the database. Posts are queued for moderation, not published live."
      />

      <Card className="border-sky-400/25 bg-sky-400/5">
        <div className="flex items-start gap-3">
          <Info size={18} className="mt-0.5 shrink-0 text-sky-400" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Schema findings</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Measured from the deployed database. Three of these are defects in the existing schema, not
              limitations of this page — fixing them is a migration, not a UI change.
            </p>
            <ul className="mt-2 space-y-1.5">
              {SCHEMA_FINDINGS.map((f) => (
                <li key={f.id} className="text-[12px] leading-relaxed">
                  <span className={f.severity === 'defect' ? 'text-red-400' : f.severity === 'by-design' ? 'text-amber-400' : 'text-muted-foreground'}>
                    {f.title}
                  </span>
                  <span className="text-muted-foreground"> — {f.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {!supabaseConfigured ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle size={26} className="text-amber-400" aria-hidden="true" />}
            title="No database configured in this build"
            sub="The feed reads Postgres directly. Without VITE_SUPABASE_URL and a publishable key there is nothing to read, so no composer is shown."
          />
        </Card>
      ) : null}

      {supabaseConfigured && !tablesReady ? (
        <Card className="border-amber-400/30 bg-amber-400/5">
          <p className="text-sm font-semibold">
            {loadError?.kind === 'missing-table' ? 'The social tables are not reachable' : 'The feed could not be read'}
          </p>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">{loadError?.message}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Posts visible" value={String(posts.length)} />
        <Stat label="Comments" value={String(comments.length)} />
        <Stat label="Reactions" value={String(reactions.length)} />
        <Stat label="Authors" value={String(Object.keys(profiles).length)} />
      </div>

      {supabaseConfigured && tablesReady ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <PenLine size={15} className="text-primary" aria-hidden="true" /> Share an analysis
            </h2>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-muted-foreground">
                Type
                <select
                  value={draft.postType}
                  onChange={(e) => setDraft((d) => ({ ...d, postType: e.target.value }))}
                  aria-label="Post type"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {POST_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Visible to
                <select
                  value={draft.visibility}
                  onChange={(e) => setDraft((d) => ({ ...d, visibility: e.target.value }))}
                  aria-label="Post visibility"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {VISIBILITIES.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-2 block text-xs font-medium text-muted-foreground">
              Title (optional, {TITLE_LIMIT} max)
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                aria-label="Post title"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <label className="mt-2 block text-xs font-medium text-muted-foreground">
              Body ({draft.body.length}/{BODY_LIMIT})
              <textarea
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                rows={4}
                aria-label="Post body"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:border-primary/60"
              />
            </label>

            {validation.errors.length ? (
              <ul className="mt-2 list-inside list-disc text-[11px] text-amber-400" aria-live="polite">
                {validation.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            ) : null}
            {validation.warnings.map((w) => (
              <p key={w} className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-400">{w}</p>
            ))}
            {formError ? (
              <p className="mt-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-400">{formError}</p>
            ) : null}
            {outcome ? (
              <p
                className={
                  'mt-2 rounded-lg border px-3 py-2 text-[11px] ' +
                  (outcome.tone === 'live'
                    ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-400'
                    : 'border-sky-400/30 bg-sky-400/5 text-sky-400')
                }
                aria-live="polite"
              >
                {outcome.message}
              </p>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={!validation.valid || !canPublish || submitting}
              className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            >
              {submitting ? 'Submitting…' : 'Submit for review'}
            </button>

            {!user ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                <Link to="/account" className="text-primary hover:underline">Sign in</Link> to post. Reading is public.
              </p>
            ) : !myProfile ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Posting needs a profile row for your account. Migration 0010 grants you permission to create one; until it is applied to
                this deployment, an administrator has to provision the row.
              </p>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Users size={15} className="text-primary" aria-hidden="true" /> What works
            </h2>
            <ul className="space-y-1.5">
              {caps.map((c) => (
                <li key={c.id} className="text-[12px] leading-snug">
                  <span className={c.ready ? 'text-foreground' : 'text-muted-foreground'}>
                    {c.ready ? '✓ ' : '· '}{c.label}
                  </span>
                  {!c.ready ? <span className="block pl-3 text-[11px] text-muted-foreground">needs {c.needs}</span> : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {supabaseConfigured && tablesReady ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Community feed</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : posts.length === 0 ? (
            <EmptyState
              icon={<MessageCircle size={26} className="text-muted-foreground" aria-hidden="true" />}
              title="Nothing published yet"
              sub="cx_community_posts is empty, or everything in it is still pending review. This is a real empty result from the same query that drives the counts above."
            />
          ) : (
            <ul className="space-y-2">
              {posts.map((p) => {
                const author = authorLabel(profiles[p.authorId]);
                const rx = summariseReactions(reactions.filter((r) => r.post_id === p.id), user?.id);
                const postComments = comments.filter((c) => c.post_id === p.id);
                const pending = p.moderationStatus !== 'published';
                return (
                  <li key={p.id} className="rounded-xl border border-border px-3 py-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {author.text}
                          {author.handle && author.text !== author.handle ? (
                            <span className="ml-1 text-[11px] font-normal text-muted-foreground">{author.handle}</span>
                          ) : null}
                          {p.authorId !== user?.id ? (
                            <button
                              type="button"
                              onClick={() => toggleFollow(p.authorId)}
                              className="ml-2 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-primary"
                            >
                              {follows.has(p.authorId) ? 'Following' : 'Follow'}
                            </button>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {POST_TYPES.find((t) => t.id === p.postType)?.label || p.postType} · {timeAgo(p.createdAt)} · {p.visibility}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {pending ? <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">Pending review</span> : null}
                      </div>
                    </div>

                    {p.title ? <p className="mt-1.5 text-sm font-semibold">{p.title}</p> : null}
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{p.body}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {REACTIONS.map((r) => {
                        const active = rx.mine.includes(r.id);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => toggleReaction(p.id, r.id)}
                            disabled={!user || p.moderationStatus !== 'published'}
                            aria-pressed={active}
                            className={
                              'rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-40 ' +
                              (active ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground')
                            }
                          >
                            {r.label} {rx.counts[r.id] || 0}
                          </button>
                        );
                      })}
                      <span className="ml-1 text-[11px] text-muted-foreground">{postComments.length} comment(s)</span>
                      <button
                        type="button"
                        onClick={() => { setReporting(reporting === p.id ? null : p.id); setReportDone(null); }}
                        disabled={!user}
                        className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-red-400 disabled:opacity-40"
                      >
                        <Flag size={11} aria-hidden="true" /> Report
                      </button>
                    </div>

                    {reporting === p.id ? (
                      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border px-2.5 py-2">
                        <label className="text-[11px] text-muted-foreground">
                          Reason
                          <select
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value)}
                            aria-label="Report reason"
                            className="ml-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
                          >
                            {['spam', 'abuse', 'scam', 'impersonation', 'illegal', 'other'].map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => sendReport(p.id)}
                          className="rounded bg-red-500/90 px-2 py-1 text-[11px] font-semibold text-white"
                        >
                          Send report
                        </button>
                      </div>
                    ) : null}
                    {reportDone === p.id ? (
                      <p className="mt-1.5 text-[11px] text-emerald-400">Report filed. It is queued in cx_moderation_reports.</p>
                    ) : null}

                    {canComment(p, ability) && commentFor === p.id ? (
                      <div className="mt-2 rounded-lg border border-border px-2.5 py-2">
                        <label className="block text-[11px] text-muted-foreground">
                          Your comment
                          <textarea
                            value={commentBody}
                            onChange={(e) => setCommentBody(e.target.value)}
                            rows={2}
                            aria-label={`Comment on ${p.title || 'this post'}`}
                            className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-[12px]"
                          />
                        </label>
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => sendComment(p.id)}
                            className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground"
                          >
                            Submit for review
                          </button>
                          <button
                            type="button"
                            onClick={() => { setCommentFor(null); setCommentBody(''); }}
                            className="text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : canComment(p, ability) ? (
                      <button
                        type="button"
                        onClick={() => { setCommentFor(p.id); setCommentBody(''); setCommentNotice(null); }}
                        className="mt-2 text-[11px] text-muted-foreground hover:text-primary"
                      >
                        Add a comment
                      </button>
                    ) : null}

                    {commentNotice && commentNotice.postId === p.id ? (
                      <p
                        className={
                          'mt-1.5 text-[11px] ' +
                          (commentNotice.tone === 'error' ? 'text-red-400' : 'text-sky-400')
                        }
                        aria-live="polite"
                      >
                        {commentNotice.text}
                      </p>
                    ) : null}

                    {postComments.length ? (
                      <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                        {postComments.map((c) => (
                          <li key={c.id} className="text-[12px] text-muted-foreground">
                            <span className="text-foreground">{authorLabel(profiles[c.user_id]).text}</span> {c.body}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {!canComment(p, ability) && user ? (
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        Comments open once a moderator publishes this post.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
