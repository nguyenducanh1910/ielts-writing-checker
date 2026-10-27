// Shapes returned to the front end. Student-facing views never include
// Claude drafts, external tool feedback or other students' data.
import {
  CRITERIA,
  type Criterion,
  type RewriteStatus,
  TIME_LIMITS,
  type TaskType,
} from '../../shared/constants';
import { essayLabel, topicName } from './category';
import { bool, type Ctx, type EssayRow, num, parseJson } from './context';
import type { Row } from './schema';

export type StudentEssayStatus =
  'draft' | 'pending' | 'scored' | 'rewrite_due' | 'rewrite_submitted' | 'overdue';

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

export function studentStatus(ctx: Ctx, essay: EssayRow): StudentEssayStatus {
  if (essay.status === 'draft') return 'draft';
  if (essay.status !== 'scored') return 'pending';
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

export function essaySummary(ctx: Ctx, essay: EssayRow) {
  const score = essay.status === 'scored' ? scoreView(ctx, essay.id) : null;
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
    studentStatus: studentStatus(ctx, essay),
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

/** Full essay for its owner (or admin). Results only once the essay is scored. */
export function essayDetail(ctx: Ctx, essay: EssayRow) {
  const scored = essay.status === 'scored';
  const parent = essay.parent_essay_id ? ctx.db.byId('Essays', essay.parent_essay_id) : undefined;
  const rr = rewriteRequestFor(ctx, essay.id);
  const rewriteEssay = rr?.rewrite_essay_id ? ctx.db.byId('Essays', rr.rewrite_essay_id) : null;
  return {
    ...essaySummary(ctx, essay),
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
    rewrite: scored ? rewriteView(ctx, rr) : null,
    parent: parent
      ? {
          id: parent.id,
          score: parent.status === 'scored' ? scoreView(ctx, parent.id) : null,
          submittedAt: parent.submitted_at,
        }
      : null,
    rewriteEssay:
      rewriteEssay && scored
        ? {
            id: rewriteEssay.id,
            status: rewriteEssay.status,
            score: rewriteEssay.status === 'scored' ? scoreView(ctx, rewriteEssay.id) : null,
          }
        : null,
  };
}
