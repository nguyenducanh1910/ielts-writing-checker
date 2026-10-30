// Shapes returned to the front end. Student-facing views never include
// Claude drafts, external tool feedback or other students' data.
import {
  CRITERIA,
  type Criterion,
  type RewriteStatus,
  TIME_LIMITS,
  type TaskType,
} from '../../shared/constants';
import { buildPracticeTasks, type PracticeError } from '../../shared/practice';
import type { AuthUser } from './auth';
import { essayLabel, topicName } from './category';
import { bool, type Ctx, type EssayRow, num, parseJson } from './context';
import type { Row } from './schema';

export type StudentEssayStatus =
  'draft' | 'pending' | 'practice' | 'scored' | 'rewrite_due' | 'rewrite_submitted' | 'overdue';

/** The score is submitted but the student has not finished the error practice yet. */
export function resultLocked(essay: EssayRow): boolean {
  return essay.status === 'scored' && essay.practice_required === 'true' && !essay.practice_done_at;
}

/** Whether this viewer must still do the practice before seeing this essay's result. */
export function lockedFor(essay: EssayRow, viewer: AuthUser | null | undefined): boolean {
  return Boolean(viewer && viewer.role !== 'admin' && resultLocked(essay));
}

/** The practice tasks for an essay, built from its tagged errors (same tasks on every load). */
export function practiceTasks(ctx: Ctx, essay: EssayRow) {
  const errors: PracticeError[] = errorsView(ctx, essay.id).map((e) => ({
    id: e.id,
    category: e.category,
    criterion: e.criterion,
    excerpt: e.excerpt,
    correction: e.correction,
    note: e.note,
    start: e.start,
    end: e.end,
  }));
  const labels = ctx.db.all('ErrorCategories').map((c) => c.label);
  return buildPracticeTasks(essay.body, errors, labels, essay.id);
}

export function timeLimitMinutes(ctx: Ctx, essay: EssayRow): number | null {
  if (essay.mode === 'practice') return null;
  if (essay.mode === 'assigned') {
    const a = ctx.db.byId('Assignments', essay.assignment_id);
    const n = a ? num(a.time_limit_minutes) : null;
    if (n) return n;
  }
  return TIME_LIMITS[essay.task_type as TaskType] ?? 40;
}

export function deadlineAt(ctx: Ctx, essay: EssayRow): string | null {
  const limit = timeLimitMinutes(ctx, essay);
  if (!limit || !essay.started_at) return null;
  return new Date(Date.parse(essay.started_at) + limit * 60000).toISOString();
}

/** The current rewrite request for an essay (latest one), if any. */
export function rewriteRequestFor(ctx: Ctx, essayId: string): Row<'RewriteRequests'> | undefined {
  return ctx.db
    .find('RewriteRequests', (r) => r.essay_id === essayId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

/** "overdue" is computed as soon as the due date passes, even before the daily job runs. */
export function effectiveRewriteStatus(rr: Row<'RewriteRequests'>, now: Date): RewriteStatus {
  if (rr.status === 'requested' && Date.parse(rr.due_at) < now.getTime()) return 'overdue';
  return rr.status as RewriteStatus;
}

export function rewriteView(ctx: Ctx, rr: Row<'RewriteRequests'> | undefined) {
  if (!rr) return null;
  const rewrite = rr.rewrite_essay_id ? ctx.db.byId('Essays', rr.rewrite_essay_id) : undefined;
  return {
    id: rr.id,
    essayId: rr.essay_id,
    dueAt: rr.due_at,
    note: rr.note,
    status: effectiveRewriteStatus(rr, ctx.now),
    rewriteEssayId: rr.rewrite_essay_id || null,
    late: Boolean(
      rewrite?.submitted_at && Date.parse(rewrite.submitted_at) > Date.parse(rr.due_at),
    ),
  };
}

export function studentStatus(ctx: Ctx, essay: EssayRow, forStudent = false): StudentEssayStatus {
  if (essay.status === 'draft') return 'draft';
  if (essay.status !== 'scored') return 'pending';
  if (forStudent && resultLocked(essay)) return 'practice';
  const rr = rewriteRequestFor(ctx, essay.id);
  if (!rr) return 'scored';
  switch (effectiveRewriteStatus(rr, ctx.now)) {
    case 'requested':
      return 'rewrite_due';
    case 'overdue':
      return 'overdue';
    case 'submitted':
      return 'rewrite_submitted';
    default:
      return 'scored';
  }
}

export interface ScoreView {
  criteria: Record<Criterion, number>;
  overall: number;
  feedback: Record<Criterion, string>;
  generalComment: string;
  updatedAt: string;
}

export function scoreView(ctx: Ctx, essayId: string): ScoreView | null {
  const s = ctx.db.findOne('Scores', (r) => r.essay_id === essayId);
  if (!s) return null;
  const feedback = parseJson<Partial<Record<Criterion, string>>>(s.feedback_json, {});
  const values = [s.criterion_1, s.criterion_2, s.criterion_3, s.criterion_4].map(
    (v) => num(v) ?? 0,
  );
  return {
    criteria: Object.fromEntries(CRITERIA.map((c, i) => [c, values[i]])) as Record<
      Criterion,
      number
    >,
    overall: num(s.overall) ?? 0,
    feedback: Object.fromEntries(CRITERIA.map((c) => [c, feedback[c] ?? ''])) as Record<
      Criterion,
      string
    >,
    generalComment: s.general_comment,
    updatedAt: s.updated_at,
  };
}

export function errorsView(ctx: Ctx, essayId: string) {
  const categories = new Map(ctx.db.all('ErrorCategories').map((c) => [c.id, c]));
  return ctx.db
    .find('ErrorLog', (r) => r.essay_id === essayId)
    .map((r) => {
      const cat = categories.get(r.category_id);
      return {
        id: r.id,
        categoryId: r.category_id,
        category: cat?.label ?? 'Uncategorised',
        criterion: (cat?.criterion ?? 'grammar') as Criterion,
        excerpt: r.excerpt,
        start: num(r.start_offset),
        end: num(r.end_offset),
        correction: r.correction,
        note: r.note,
      };
    })
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
}

/** `forStudent`: hide the band of a result the student has not unlocked yet. */
export function essaySummary(ctx: Ctx, essay: EssayRow, forStudent = false) {
  const hidden = forStudent && resultLocked(essay);
  const score = essay.status === 'scored' && !hidden ? scoreView(ctx, essay.id) : null;
  const assignment = essay.assignment_id ? ctx.db.byId('Assignments', essay.assignment_id) : null;
  return {
    id: essay.id,
    mode: essay.mode,
    taskType: essay.task_type as TaskType,
    topicId: essay.topic_id,
    /** Display label: diagram type (Task 1) or "Topic · Essay type" (Task 2). */
    topic: essayLabel(ctx, essay),
    topicName: topicName(ctx, essay.topic_id),
    diagramType: essay.diagram_type,
    essayType: essay.essay_type,
    promptPreview: essay.prompt.slice(0, 140),
    wordCount: num(essay.word_count) ?? 0,
    status: essay.status,
    studentStatus: studentStatus(ctx, essay, forStudent),
    overall: score?.overall ?? null,
    savedAt: essay.saved_at,
    submittedAt: essay.submitted_at || null,
    scoredAt: essay.scored_at || null,
    parentEssayId: essay.parent_essay_id || null,
    assignmentId: essay.assignment_id || null,
    assignmentTitle: assignment?.title ?? null,
    overTime: bool(essay.over_time),
    uploadedByAdmin: essay.source === 'admin',
    startedAt: essay.started_at || null,
    deadlineAt: deadlineAt(ctx, essay),
  };
}

/**
 * Full essay for its owner (or admin). Results only once the essay is scored, and for a student
 * only once they have done the error practice: until then `practice` holds the tasks instead.
 */
export function essayDetail(ctx: Ctx, essay: EssayRow, viewer?: AuthUser | null) {
  const locked = lockedFor(essay, viewer);
  const scored = essay.status === 'scored' && !locked;
  const parent = essay.parent_essay_id ? ctx.db.byId('Essays', essay.parent_essay_id) : undefined;
  const rr = rewriteRequestFor(ctx, essay.id);
  const rewriteEssay = rr?.rewrite_essay_id ? ctx.db.byId('Essays', rr.rewrite_essay_id) : null;
  const visibleScore = (e: EssayRow) =>
    e.status === 'scored' && !lockedFor(e, viewer) ? scoreView(ctx, e.id) : null;
  return {
    ...essaySummary(ctx, essay, Boolean(viewer && viewer.role !== 'admin')),
    practice: locked ? { tasks: practiceTasks(ctx, essay) } : null,
    resultViewed: Boolean(essay.result_viewed_at),
    prompt: essay.prompt,
    body: essay.body,
    hasImage: Boolean(essay.image_file_id),
    timeLimitMinutes: timeLimitMinutes(ctx, essay),
    timeUsedSeconds: num(essay.time_used_seconds),
    autoSubmitted: bool(essay.auto_submitted),
    pasteAttempts: num(essay.paste_attempts) ?? 0,
    testDate: essay.test_date,
    /** Lets the browser correct its clock for the test countdown. */
    serverNow: ctx.nowIso,
    score: scored ? scoreView(ctx, essay.id) : null,
    errors: scored ? errorsView(ctx, essay.id) : [],
    // A rewrite request stays visible while locked: the student needs its deadline.
    rewrite: essay.status === 'scored' ? rewriteView(ctx, rr) : null,
    parent: parent
      ? {
          id: parent.id,
          score: visibleScore(parent),
          submittedAt: parent.submitted_at,
        }
      : null,
    rewriteEssay:
      rewriteEssay && scored
        ? {
            id: rewriteEssay.id,
            status: rewriteEssay.status,
            score: visibleScore(rewriteEssay),
          }
        : null,
  };
}

/** For the teacher: whether the student got, opened and acted on a result. */
export function resultActivity(ctx: Ctx, essay: EssayRow) {
  const events = ctx.db
    .find(
      'EmailEvents',
      (e) => e.essay_id === essay.id && (e.type === 'result' || e.type === 'result_resent'),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const opened =
    events
      .filter((e) => e.opened_at)
      .map((e) => e.opened_at)
      .sort()[0] ?? null;
  const sent = events.filter((e) => e.status === 'sent');
  const last = events[events.length - 1];
  const student = ctx.db.byId('Users', essay.student_id);
  const email = opened
    ? 'opened'
    : sent.length
      ? 'sent'
      : last
        ? (last.status as 'queued' | 'failed')
        : student && !student.email
          ? 'no_email'
          : 'none';
  return {
    email,
    emailSentAt: sent[0]?.created_at ?? null,
    emailOpenedAt: opened,
    viewedAt: essay.result_viewed_at || null,
    practice:
      essay.practice_required !== 'true'
        ? ('not_required' as const)
        : essay.practice_done_at
          ? ('done' as const)
          : ('waiting' as const),
    practiceDoneAt: essay.practice_done_at || null,
  };
}
