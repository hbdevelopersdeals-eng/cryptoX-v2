import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, BookOpen, Award, ExternalLink, CheckCircle2, Circle } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import {
  COURSES, TRACKS, courseById, coursesByTrack, gradeQuiz, issueCertificate,
  progressFor, CERTIFICATE_NOTE, PASS_THRESHOLD, DEMO_TASKS, demoTasksDone
} from '../lib/academy.js';
import { lsGet, lsSet } from '../lib/storage.js';
import { Card, SectionTitle, Stat } from '../components/ui.jsx';

/* CryptoX Academy.
 *
 * Lessons link into the product so "learn" ends somewhere you can practise. The
 * quiz is graded locally and the certificate says so in its own note: a browser
 * grade is evidence of study, not proof of identity or skill, and a certificate
 * that overstates itself is a dispute waiting to happen.
 */

const progressKey = (account) => `cx_academy_${account || 'local'}`;

export default function AcademyPage() {
  const auth = useAuth() || {};
  const account = auth.user?.id || auth.user?.email || 'local';

  const [store, setStore] = useState(() => lsGet(progressKey(account), { lessons: {}, certificates: [] }));
  const [selectedId, setSelectedId] = useState(COURSES[0].id);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [track, setTrack] = useState('all');

  const course = courseById(selectedId) || COURSES[0];
  const completed = store.lessons?.[course.id] || [];
  const progress = progressFor(course, completed);
  const visible = track === 'all' ? COURSES : coursesByTrack(track);

  const persist = (next) => {
    setStore(next);
    lsSet(progressKey(account), next);
  };

  const toggleLesson = (lessonId) => {
    const done = new Set(completed);
    if (done.has(lessonId)) done.delete(lessonId);
    else done.add(lessonId);
    persist({ ...store, lessons: { ...store.lessons, [course.id]: [...done] } });
  };

  const submitQuiz = () => {
    const ordered = course.quiz.map((_, i) => (Number.isInteger(answers[i]) ? answers[i] : -1));
    const issued = issueCertificate({ accountId: account, course, answers: ordered });
    const graded = gradeQuiz(course.quiz, ordered);
    setResult({ ...graded, certificate: issued.ok ? issued.certificate : null, reason: issued.reason });

    if (issued.ok && !(store.certificates || []).some((c) => c.id === issued.certificate.id)) {
      persist({ ...store, certificates: [...(store.certificates || []), issued.certificate] });
    }
  };

  const certificate = useMemo(
    () => (store.certificates || []).find((c) => c.courseId === course.id) || null,
    [store.certificates, course.id]
  );

  return (
    <div className="space-y-4">
      <SectionTitle
        title="CryptoX Academy"
        sub="Five tracks, each lesson linked to the screen where you practise it. Quizzes are graded in the browser and the certificate says exactly what that means."
      />

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setTrack('all')}
          className={'rounded-full border px-3 py-1 text-xs ' + (track === 'all' ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
        >
          All tracks
        </button>
        {TRACKS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTrack(t.id)}
            className={'rounded-full border px-3 py-1 text-xs ' + (track === t.id ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-1">
          {visible.map((c) => {
            const p = progressFor(c, store.lessons?.[c.id] || []);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => { setSelectedId(c.id); setAnswers({}); setResult(null); }}
                className={
                  'w-full rounded-xl border px-3 py-2.5 text-left transition-colors ' +
                  (c.id === course.id ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.title}</span>
                  <span className="num shrink-0 text-[11px] text-muted-foreground">{Math.round(p.pct)}%</span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{c.level} · {c.minutes} min · {c.lessons.length} lessons</p>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${p.pct}%` }} />
                </div>
              </button>
            );
          })}
          {!visible.length ? <p className="text-sm text-muted-foreground">No courses in this track yet.</p> : null}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <BookOpen size={17} className="text-primary" aria-hidden="true" /> {course.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{course.summary}</p>
              </div>
              {certificate ? (
                <span className="chip border-emerald-400/30 bg-emerald-400/10 text-emerald-400">Certified</span>
              ) : null}
            </div>

            <ol className="mt-4 space-y-2">
              {course.lessons.map((lesson, i) => {
                const done = completed.includes(lesson.id);
                return (
                  <li key={lesson.id} className="rounded-xl border border-border px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() => toggleLesson(lesson.id)}
                        aria-pressed={done}
                        aria-label={`Mark “${lesson.title}” as ${done ? 'not complete' : 'complete'}`}
                        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
                      >
                        {done
                          ? <CheckCircle2 size={16} className="text-emerald-400" aria-hidden="true" />
                          : <Circle size={16} aria-hidden="true" />}
                      </button>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{i + 1}. {lesson.title} <span className="text-[11px] font-normal text-muted-foreground">· {lesson.minutes} min</span></p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{lesson.body}</p>
                        <Link to={lesson.route} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                          Practise this <ExternalLink size={11} aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <GraduationCap size={15} className="text-primary" aria-hidden="true" /> Quiz
              <span className="text-[11px] font-normal text-muted-foreground">{Math.round(PASS_THRESHOLD * 100)}% to pass</span>
            </h2>

            <div className="mt-3 space-y-3">
              {course.quiz.map((q, qi) => (
                <fieldset key={q.q} className="rounded-xl border border-border px-3 py-2.5">
                  <legend className="px-1 text-xs font-medium">{qi + 1}. {q.q}</legend>
                  <div className="mt-1 space-y-1">
                    {q.options.map((opt, oi) => (
                      <label key={opt} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <input
                          type="radio"
                          name={`q-${qi}`}
                          checked={answers[qi] === oi}
                          onChange={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                          aria-label={`Question ${qi + 1} option ${oi + 1}: ${opt}`}
                          className="h-3.5 w-3.5"
                        />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>

            <button
              type="button"
              onClick={submitQuiz}
              className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2"
            >
              Submit answers
            </button>

            {result ? (
              <div className="mt-3 rounded-lg border border-border px-3 py-2.5" aria-live="polite">
                <p className={'text-xs font-semibold ' + (result.passed ? 'text-emerald-400' : 'text-amber-400')}>
                  {result.correct}/{result.total} correct · {(result.score * 100).toFixed(0)}%
                  {result.passed ? ' — passed' : ' — below the pass mark'}
                </p>
                {result.certificate ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Certificate <span className="font-mono">{result.certificate.id}</span> recorded in this browser.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">{result.reason}</p>
                )}
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                  {result.breakdown.map((b) => (
                    <li key={b.index}>
                      Q{b.index + 1}: {b.correct ? 'correct' : `expected option ${b.expected + 1}`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {certificate ? (
              <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                  <Award size={14} aria-hidden="true" /> {certificate.courseTitle}
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{certificate.id}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{CERTIFICATE_NOTE}</p>
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold">Practise before you certify</h2>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Lessons done" value={`${progress.completed}/${progress.total}`} />
              <Stat label="Next up" value={progress.next ? progress.next.title : 'All lessons complete'} />
            </div>
            <ul className="mt-3 space-y-1.5">
              {demoTasksDone({}).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <Link to={t.route} className="text-muted-foreground hover:text-primary">{t.title}</Link>
                  <span className="shrink-0 text-[11px] text-muted-foreground">not tracked</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Demo milestones report “not tracked” rather than a tick: the paper-trading engine records orders but does not
              emit progress events the academy can read, and a fake tick is worse than an honest gap. {DEMO_TASKS.length}{' '}
              milestones are defined in <span className="font-mono">academy.js</span> waiting for that feed.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
