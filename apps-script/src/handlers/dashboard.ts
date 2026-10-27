// Student dashboard, topics page, admin student overview and source calibration.
import { MODES, OTHER_TOPIC_LABEL, TASK_TYPES } from '../../../shared/constants';
import {
  applyFilters,
  bandOverTime,
  criterionAverages,
  type DashEssay,
  essaysPerWeek,
  progressHighlights,
  rewriteImprovements,
  topErrorsByCriterion,
  topicsCovered,
} from '../../../shared/dashboard';
import type { AuthUser } from '../auth';
import { authorize } from '../authorize';
import { calibrationFor } from '../calibration';
import { essayLabel } from '../category';
import { ApiError, bool, type Ctx, num } from '../context';
import { cached } from '../dashboardCache';
import type { ActionDef } from '../router';
import { Reader } from '../validate';
import { errorsView, essaySummary, rewriteView, scoreView } from '../views';
import { recurringErrors } from './admin';

/** The student's submitted essays; scores and errors only for scored ones. */
export function dashEssays(ctx: Ctx, user: AuthUser | null, studentId: string): DashEssay[] {
  return ctx.db
    .find('Essays', (e) => e.student_id === studentId && e.status !== 'draft')
    .map((e) => {
      const scoreAllowed =
        e.status === 'scored' &&
        (user === null ||
          (() => {
            try {
              authorize('dashboard.get', user, { type: 'score', essay: e });
              return true;
            } catch {
              return false;
            }
          })());
      const score = scoreAllowed ? scoreView(ctx, e.id) : null;
      return {
        id: e.id,
        taskType: e.task_type,
        mode: e.mode,
        topicId: e.topic_id,
        topic: essayLabel(ctx, e),
        diagramType: e.diagram_type,
        essayType: e.essay_type,
        submittedAt: e.submitted_at,
        scoredAt: e.scored_at,
        wordCount: num(e.word_count) ?? 0,
        overall: score ? score.overall : null,
        criteria: score ? score.criteria : null,
        errors: score
          ? errorsView(ctx, e.id).map((x) => ({
              categoryId: x.categoryId,
              category: x.category,
              criterion: x.criterion,
              excerpt: x.excerpt,
              correction: x.correction,
            }))
          : [],
        isRewrite: Boolean(e.parent_essay_id),
        parentId: e.parent_essay_id || null,
      };
    });
}

function readFilters(payload: unknown) {
  const r = new Reader(payload);
  const taskType = r.oneOf('taskType', TASK_TYPES, true);
  const mode = r.oneOf('mode', MODES, true);
  return { r, filters: { taskType: taskType || undefined, mode: mode || undefined } };
}

function stats(
  ctx: Ctx,
  user: AuthUser | null,
  studentId: string,
  filters: { taskType?: string; mode?: string },
) {
  return cached(ctx, studentId, `stats:${filters.taskType ?? ''}:${filters.mode ?? ''}`, () => {
    const all = dashEssays(ctx, user, studentId);
    const essays = applyFilters(all, filters);
    return {
      // A rewrite may use a different mode from its original, so pair them before the mode filter.
      rewriteImprovements: rewriteImprovements(applyFilters(all, { taskType: filters.taskType })),
      bandOverTime: bandOverTime(essays),
      criterionAverages: criterionAverages(essays),
      topErrors: {
        last30: topErrorsByCriterion(essays, ctx.now, 30),
        last90: topErrorsByCriterion(essays, ctx.now, 90),
      },
      highlights: progressHighlights(essays),
      perWeek: essaysPerWeek(essays, ctx.now),
      counts: {
        submitted: essays.length,
        scored: essays.filter((e) => e.overall !== null).length,
      },
    };
  });
}

/** Open rewrite requests (time-sensitive, so not cached). */
function openRewrites(ctx: Ctx, studentId: string) {
  const essays = new Map(
    ctx.db
      .find('Essays', (e) => e.student_id === studentId && e.status === 'scored')
      .map((e) => [e.id, e]),
  );
  return ctx.db
    .find('RewriteRequests', (r) => essays.has(r.essay_id))
    .map((r) => ({
      ...rewriteView(ctx, r)!,
      topic: essayLabel(ctx, essays.get(r.essay_id)!),
    }))
    .filter((r) => r.status === 'requested' || r.status === 'overdue')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

function topicHistory(ctx: Ctx, user: AuthUser | null, studentId: string) {
  const topics = ctx.db
    .find('Topics', (t) => bool(t.active))
    .map((t) => ({ id: t.id, label: t.label, seeded: t.label !== OTHER_TOPIC_LABEL }));
  return topicsCovered(dashEssays(ctx, user, studentId), topics);
}

function studentDashboard(ctx: Ctx, payload: unknown, user: AuthUser) {
  const { r, filters } = readFilters(payload);
  r.done();
  return {
    ...stats(ctx, user, user.id, filters),
    targetBand: num(user.row.target_band),
    examDate: user.row.exam_date,
    rewrites: openRewrites(ctx, user.id),
    filters,
  };
}

function studentsList(ctx: Ctx) {
  const classes = new Map(ctx.db.all('Classes').map((c) => [c.id, c.label]));
  return ctx.db
    .find('Users', (u) => u.role !== 'admin')
    .map((u) => {
      const essays = ctx.db.find('Essays', (e) => e.student_id === u.id && e.status !== 'draft');
      const scored = essays.filter((e) => e.status === 'scored');
      const overalls = scored
        .map((e) => scoreView(ctx, e.id)?.overall)
        .filter((x): x is number => typeof x === 'number');
      const overdue = openRewrites(ctx, u.id).filter((r) => r.status === 'overdue').length;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        className: classes.get(u.class) ?? '',
        essays: essays.length,
        scored: scored.length,
        pending: essays.length - scored.length,
        averageBand: overalls.length
          ? Math.round((overalls.reduce((a, b) => a + b, 0) / overalls.length) * 10) / 10
          : null,
        lastSubmittedAt:
          essays
            .map((e) => e.submitted_at)
            .sort()
            .pop() ?? null,
        overdueRewrites: overdue,
        targetBand: num(u.target_band),
        hasPassword: !!u.password_hash,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function studentOverview(ctx: Ctx, payload: unknown) {
  const { r, filters } = readFilters(payload);
  const studentId = r.id('studentId');
  r.done();
  const u = ctx.db.byId('Users', studentId);
  if (!u) throw new ApiError('not_found', 'Student not found.');
  const essays = ctx.db
    .find('Essays', (e) => e.student_id === u.id)
    .map((e) => essaySummary(ctx, e))
    .sort((a, b) => (b.submittedAt ?? b.savedAt).localeCompare(a.submittedAt ?? a.savedAt));
  const rewriteHistory = ctx.db
    .find('RewriteRequests', (x) => essays.some((e) => e.id === x.essay_id))
    .map((x) => ({
      ...rewriteView(ctx, x)!,
      topic: essays.find((e) => e.id === x.essay_id)?.topic ?? '',
    }))
    .sort((a, b) => b.dueAt.localeCompare(a.dueAt));
  // Band scores across assignments, with the class average on the same prompt.
  const assignments = ctx.db
    .find('Essays', (e) => e.student_id === u.id && Boolean(e.assignment_id))
    .map((e) => {
      const a = ctx.db.byId('Assignments', e.assignment_id);
      const peers = ctx.db
        .find('Essays', (x) => x.assignment_id === e.assignment_id && x.status === 'scored')
        .map((x) => scoreView(ctx, x.id)?.overall)
        .filter((x): x is number => typeof x === 'number');
      return {
        assignmentId: e.assignment_id,
        title: a?.title ?? '',
        essayId: e.id,
        overall: e.status === 'scored' ? (scoreView(ctx, e.id)?.overall ?? null) : null,
        classAverage: peers.length
          ? Math.round((peers.reduce((s, x) => s + x, 0) / peers.length) * 10) / 10
          : null,
        scoredCount: peers.length,
      };
    });
  return {
    student: {
      id: u.id,
      name: u.name,
      email: u.email,
      className: ctx.db.byId('Classes', u.class)?.label ?? '',
      targetBand: num(u.target_band),
      examDate: u.exam_date,
      createdAt: u.created_at,
    },
    essays,
    stats: stats(ctx, null, u.id, filters),
    recurringErrors: recurringErrors(ctx, u.id, '', 90),
    topics: topicHistory(ctx, null, u.id),
    rewriteHistory,
    overdueRewrites: rewriteHistory.filter((x) => x.status === 'overdue'),
    assignments,
    filters,
  };
}

export const dashboardActions: Record<string, ActionDef> = {
  'dashboard.get': { write: false, handler: (ctx, p, user) => studentDashboard(ctx, p, user!) },
  'topics.history': { write: false, handler: (ctx, _p, user) => topicHistory(ctx, user, user!.id) },
  'admin.students': { write: false, handler: (ctx) => studentsList(ctx) },
  'admin.studentOverview': { write: false, handler: (ctx, p) => studentOverview(ctx, p) },
  'admin.calibration': {
    write: false,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const taskType = r.oneOf('taskType', TASK_TYPES, true);
      r.done();
      return { taskType: taskType || null, sources: calibrationFor(ctx, taskType, true) };
    },
  },
};
