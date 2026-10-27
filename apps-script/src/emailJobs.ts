// Builders for every email type. Content is never stored: a queued or failed
// email is rebuilt from its EmailEvents row (type + idempotency key).
import {
  CRITERIA,
  type Criterion,
  criterionLabel,
  MODE_LABELS,
  type Mode,
  TASK_TYPE_LABELS,
  type TaskType,
} from '../../shared/constants';
import { formatForEmail, assignmentNoticeJob } from './handlers/assignments';
import { loginJob } from './auth';
import { essayLabel } from './category';
import { appUrl, type Ctx, type EssayRow } from './context';
import { type EmailJob, type EmailType, parseEmailKey } from './email';
import { resultEmail, rewriteReminderEmail } from './emailTemplates';
import type { Row } from './schema';
import { errorsView, rewriteRequestFor, scoreView } from './views';

/** Plain-text summary of Markdown feedback for the email (full feedback stays behind login). */
export function summarize(markdownText: string, max = 400): string {
  // Remove Markdown syntax only, so punctuation such as "!" and hyphenated words survive.
  const plain = markdownText
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images → their text
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '') // headings, quotes, list markers
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2') // bold, strikethrough
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2') // italics
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** The 3 most frequent error categories in this essay, with one example correction each. */
export function topErrors(ctx: Ctx, essayId: string, limit = 3) {
  return groupTopErrors(errorsView(ctx, essayId), limit);
}

/** Group errors (sorted by position) by category, most frequent first. */
export function groupTopErrors(
  errors: Array<{ category: string; excerpt: string; correction: string }>,
  limit = 3,
) {
  const groups = new Map<string, typeof errors>();
  for (const e of errors) {
    const list = groups.get(e.category) ?? [];
    list.push(e);
    groups.set(e.category, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category, list]) => ({
      category,
      count: list.length,
      excerpt: list[0].excerpt,
      correction: list[0].correction,
    }));
}

export function resultJob(
  ctx: Ctx,
  essay: EssayRow,
  type: 'result' | 'result_resent',
  version: string,
): EmailJob {
  const student = ctx.db.byId('Users', essay.student_id);
  if (!student) throw new Error('Student not found');
  return {
    type,
    refId: essay.id,
    version,
    userId: student.id,
    essayId: essay.id,
    to: student.email,
    build: () => {
      const score = scoreView(ctx, essay.id);
      if (!score) throw new Error('This essay has no score');
      const rr = rewriteRequestFor(ctx, essay.id);
      return resultMessage(ctx, essay, student, {
        criteria: score.criteria,
        overall: score.overall,
        generalComment: score.generalComment,
        topErrors: topErrors(ctx, essay.id),
        rewriteDueAt:
          rr && (rr.status === 'requested' || rr.status === 'overdue') ? rr.due_at : null,
        resent: type === 'result_resent',
      });
    },
  };
}

export function rewriteJob(
  ctx: Ctx,
  rr: Row<'RewriteRequests'>,
  type: 'rewrite_reminder' | 'rewrite_overdue',
): EmailJob {
  const essay = ctx.db.byId('Essays', rr.essay_id);
  const student = essay ? ctx.db.byId('Users', essay.student_id) : undefined;
  if (!essay || !student) throw new Error('Essay or student not found');
  return {
    type,
    refId: rr.id,
    version: '1',
    userId: student.id,
    essayId: essay.id,
    to: student.email,
    build: () =>
      rewriteReminderEmail({
        to: student.email,
        name: student.name,
        topic: essayLabel(ctx, essay),
        due: formatForEmail(ctx, rr.due_at, student.timezone),
        overdue: type === 'rewrite_overdue',
        url: appUrl(ctx, `/essays/${essay.id}`),
      }),
  };
}

/** Recreate the job for a queued or failed EmailEvents row. */
export function jobFromEvent(ctx: Ctx, event: Row<'EmailEvents'>): EmailJob | null {
  const { type, refId, version } = parseEmailKey(event.idempotency_key);
  switch (type as EmailType) {
    case 'login': {
      const user = ctx.db.byId('Users', refId);
      return user ? loginJob(ctx, user, version) : null;
    }
    case 'result':
    case 'result_resent': {
      const essay = ctx.db.byId('Essays', refId);
      if (!essay || essay.status !== 'scored') return null;
      return resultJob(ctx, essay, type as 'result' | 'result_resent', version);
    }
    case 'rewrite_reminder':
    case 'rewrite_overdue': {
      const rr = ctx.db.byId('RewriteRequests', refId);
      if (!rr || rr.status === 'waived' || rr.status === 'submitted') return null;
      return rewriteJob(ctx, rr, type as 'rewrite_reminder' | 'rewrite_overdue');
    }
    case 'assignment_notice': {
      const a = ctx.db.byId('Assignments', refId);
      const student = ctx.db.byId('Users', version);
      return a && student ? assignmentNoticeJob(ctx, a, student) : null;
    }
    default:
      return null;
  }
}

/** The result email for an essay and a score (saved, or a preview of the form). */
export function resultMessage(
  ctx: Ctx,
  essay: EssayRow,
  student: Row<'Users'>,
  data: {
    criteria: Record<Criterion, number>;
    overall: number;
    generalComment: string;
    topErrors: ReturnType<typeof groupTopErrors>;
    rewriteDueAt: string | null;
    resent: boolean;
  },
) {
  const taskType = essay.task_type as TaskType;
  return resultEmail({
    to: student.email,
    name: student.name,
    taskTypeLabel: TASK_TYPE_LABELS[taskType],
    topic: essayLabel(ctx, essay),
    modeLabel: MODE_LABELS[essay.mode as Mode] ?? essay.mode,
    overall: data.overall,
    criteria: CRITERIA.map((c) => ({
      label: criterionLabel(c, taskType),
      score: data.criteria[c],
    })),
    summary: summarize(data.generalComment),
    topErrors: data.topErrors,
    rewriteDue: data.rewriteDueAt ? formatForEmail(ctx, data.rewriteDueAt, student.timezone) : null,
    url: appUrl(ctx, `/essays/${essay.id}`),
    resent: data.resent,
  });
}
