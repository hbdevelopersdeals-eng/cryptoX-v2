import { describe, it, expect } from 'vitest';
import {
  COURSES, TRACKS, gradeQuiz, issueCertificate, verifyCertificate, certificateId,
  progressFor, demoTasksDone, DEMO_TASKS, PASS_THRESHOLD, CERTIFICATE_NOTE, courseById
} from './academy.js';

describe('catalogue integrity', () => {
  it('has a course in every track', () => {
    for (const track of TRACKS) {
      expect(COURSES.some((c) => c.track === track.id)).toBe(true);
    }
  });

  it('gives every course lessons that link into the product', () => {
    for (const c of COURSES) {
      expect(c.lessons.length).toBeGreaterThan(0);
      for (const l of c.lessons) {
        expect(l.route.startsWith('/')).toBe(true);
        expect(l.minutes).toBeGreaterThan(0);
      }
    }
  });

  it('has a quiz whose answer index is valid for every course', () => {
    for (const c of COURSES) {
      expect(c.quiz.length).toBeGreaterThanOrEqual(4);
      for (const q of c.quiz) {
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
      }
    }
  });

  it('has no duplicate course or lesson ids', () => {
    const courseIds = COURSES.map((c) => c.id);
    expect(new Set(courseIds).size).toBe(courseIds.length);
    const lessonIds = COURSES.flatMap((c) => c.lessons.map((l) => `${c.id}:${l.id}`));
    expect(new Set(lessonIds).size).toBe(lessonIds.length);
  });
});

describe('grading', () => {
  const quiz = [
    { q: 'a', options: ['1', '2'], answer: 0 },
    { q: 'b', options: ['1', '2'], answer: 1 }
  ];

  it('scores and passes a perfect answer set', () => {
    const r = gradeQuiz(quiz, [0, 1]);
    expect(r.correct).toBe(2);
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
  });

  it('fails anything below the pass mark', () => {
    const r = gradeQuiz(quiz, [1, 1]);
    expect(r.score).toBe(0.5);
    expect(r.passed).toBe(false);
    expect(r.breakdown[0].correct).toBe(false);
  });

  it('treats a missing answer as wrong rather than as correct', () => {
    const r = gradeQuiz(quiz, [0]);
    expect(r.correct).toBe(1);
    expect(r.breakdown[1].given).toBe(-1);
  });

  it('handles an empty quiz without dividing by zero', () => {
    const r = gradeQuiz([], []);
    expect(r.score).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('enforces the documented pass threshold', () => {
    const four = Array.from({ length: 5 }, () => ({ q: '', options: ['a', 'b'], answer: 0 }));
    expect(gradeQuiz(four, [0, 0, 0, 0, 1]).passed).toBe(PASS_THRESHOLD <= 0.8);
  });
});

describe('certificates', () => {
  const course = courseById('crypto-basics');
  const answers = course.quiz.map((q) => q.answer);

  it('issues a certificate for a passing attempt', () => {
    const r = issueCertificate({ accountId: 'u1', course, answers, issuedAt: '2026-06-01T00:00:00Z' });
    expect(r.ok).toBe(true);
    expect(r.certificate.id).toMatch(/^CXA-/);
    expect(r.certificate.note).toBe(CERTIFICATE_NOTE);
  });

  it('refuses a failing attempt and states the score', () => {
    const r = issueCertificate({ accountId: 'u1', course, answers: course.quiz.map(() => -1) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/below the 80% pass mark/);
  });

  it('refuses to issue without an account', () => {
    expect(issueCertificate({ course, answers }).ok).toBe(false);
  });

  it('produces a stable id for the same account, course and day', () => {
    const a = certificateId({ accountId: 'u1', courseId: 'c', issuedAt: '2026-06-01T10:00:00Z' });
    const b = certificateId({ accountId: 'u1', courseId: 'c', issuedAt: '2026-06-01T22:00:00Z' });
    expect(a).toBe(b);
  });

  it('verifies only records that exist in the registry', () => {
    const issued = issueCertificate({ accountId: 'u1', course, answers, issuedAt: '2026-06-01T00:00:00Z' }).certificate;
    expect(verifyCertificate(issued.id, [issued]).valid).toBe(true);
    expect(verifyCertificate('CXA-NOPE', [issued]).valid).toBe(false);
  });

  it('treats a stale certificate as not current', () => {
    const issued = issueCertificate({ accountId: 'u1', course, answers, issuedAt: '2020-01-01T00:00:00Z' }).certificate;
    const r = verifyCertificate(issued.id, [issued], Date.parse('2026-06-01T00:00:00Z'));
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/re-verifiable/);
  });
});

describe('progress', () => {
  const course = courseById('order-types');

  it('reports the next unfinished lesson', () => {
    const p = progressFor(course, [course.lessons[0].id]);
    expect(p.completed).toBe(1);
    expect(p.next.id).toBe(course.lessons[1].id);
    expect(p.complete).toBe(false);
  });

  it('reports completion when every lesson is done', () => {
    const p = progressFor(course, course.lessons.map((l) => l.id));
    expect(p.complete).toBe(true);
    expect(p.pct).toBe(100);
    expect(p.next).toBeNull();
  });

  it('handles an unknown course', () => {
    expect(progressFor(null, []).pct).toBe(0);
  });
});

describe('demo tasks', () => {
  it('marks only the tasks with a recorded flag', () => {
    const t = demoTasksDone({ 'place-limit': true });
    expect(t).toHaveLength(DEMO_TASKS.length);
    expect(t.find((x) => x.id === 'place-limit').done).toBe(true);
    expect(t.find((x) => x.id === 'set-alert').done).toBe(false);
  });
});
