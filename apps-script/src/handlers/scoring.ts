// Save draft / Submit score, rewrite requests, and email retry.
import { overallBand } from '../../../shared/band';
import {
  CLAUDE_SOURCE_NAME,
  CRITERIA,
  type Criterion,
  DIAGRAM_TYPE_IDS,
  ESSAY_TYPE_IDS,
  LIMITS,
} from '../../../shared/constants';
import { endOfDayUtc } from '../../../shared/dates';
import { adminTimezone, ApiError, type Ctx, type EssayRow, parseJson } from '../context';
import { type Category, categoryColumns } from '../category';
import { clearDashboardCache } from '../dashboardCache';
import { MAX_CELL } from '../db';
import { renameEssayFolder } from '../drive';
import { processEmailQueue, type SendOutcome, sendEmail } from '../email';
import { groupTopErrors, jobFromEvent, resultJob, resultMessage } from '../emailJobs';
import type { ActionDef } from '../router';
import type { Row } from '../schema';
import { Reader } from '../validate';
import { effectiveRewriteStatus, rewriteRequestFor } from '../views';

interface ErrorInput {
  categoryId: string;
  excerpt: string;
  start: number | null;
  end: number | null;
  correction: string;
  note: string;
}

function loadEssay(ctx: Ctx, id: string): EssayRow {
  const essay = ctx.db.byId('Essays', id);
  if (!essay) throw new ApiError('not_found', 'Essay not found.');
  return essay;
}

function readErrors(ctx: Ctx, r: Reader, essay: EssayRow, requirePlaced: boolean): ErrorInput[] {
  const categories = new Set(ctx.db.all('ErrorCategories').map((c) => c.id));
  const out: ErrorInput[] = [];
  r.array('errors', LIMITS.errorsPerEssay).forEach((raw, i) => {
    const e = new Reader(raw);
    const categoryId = e.id('categoryId');
    let excerpt = e.str('excerpt', { max: LIMITS.excerpt, trim: false });
    const start = e.int('start', { min: 0, max: essay.body.length, optional: true });
    const end = e.int('end', { min: 0, max: essay.body.length, optional: true });
    const correction = e.str('correction', { max: LIMITS.correction, optional: true });
    const note = e.str('note', { max: LIMITS.note, optional: true });
    if (categoryId && !categories.has(categoryId)) e.addError('categoryId', 'Unknown category');
    const placed = start !== null && end !== null;
    if ((start === null) !== (end === null)) e.addError('start', 'Start and end go together');
    if (placed && end! <= start!) e.addError('end', 'End must be after start');
    if (requirePlaced && !placed)
      e.addError('start', 'Place or delete this error before submitting');
    // The stored excerpt always matches the essay text at the offsets.
    if (placed && end! > start!) excerpt = essay.body.slice(start!, end!);
    r.absorb(`errors[${i}]`, e);
    out.push({
      categoryId,
      excerpt,
      start: placed ? start : null,
      end: placed ? end : null,
      correction,
      note,
    });
  });
  return out;
}

/** Store each source's criterion scores next to the final score, including Claude's first draft. */
function ensureClaudeSourceRow(ctx: Ctx, essayId: string): void {
  const claude = ctx.db.findOne('FeedbackSources', (s) => s.name === CLAUDE_SOURCE_NAME);
  if (!claude) return;
  if (
    ctx.db.findOne('SourceFeedback', (s) => s.essay_id === essayId && s.source_id === claude.id)
  ) {
    return;
  }
  const first = ctx.db
    .find('Drafts', (d) => d.essay_id === essayId && d.kind === 'initial')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (!first) return;
  const parsed = parseJson<{ scores?: Record<string, number>; generalComment?: string } | null>(
    first.parsed_json,
    null,
  );
  if (!parsed?.scores) return;
  const values = CRITERIA.map((c) => parsed.scores![c]);
  ctx.db.insert('SourceFeedback', {
    id: ctx.svc.uuid(),
    essay_id: essayId,
    source_id: claude.id,
    criterion_1: values[0],
    criterion_2: values[1],
    criterion_3: values[2],
    criterion_4: values[3],
    overall: values.every((v) => typeof v === 'number') ? overallBand(values) : '',
    feedback_text: parsed.generalComment ?? '',
    created_at: first.created_at,
  });
}

function applyRewrite(
  ctx: Ctx,
  essay: EssayRow,
  input: { required: boolean; dueDate: string; note: string },
): void {
  const rr = rewriteRequestFor(ctx, essay.id);
  const open = rr && ['requested', 'overdue'].includes(rr.status);
  if (!input.required) {
    if (rr && open) ctx.db.update('RewriteRequests', (x) => x.id === rr.id, { status: 'waived' });
    return;
  }
  const student = ctx.db.byId('Users', essay.student_id);
  const tz = student?.timezone || adminTimezone(ctx);
  const dueAt = endOfDayUtc(input.dueDate, tz, ctx.svc.tzOffsetMinutes);
  if (rr && open) {
    const status = Date.parse(dueAt) < ctx.now.getTime() ? 'overdue' : 'requested';
    ctx.db.update('RewriteRequests', (x) => x.id === rr.id, {
      due_at: dueAt,
      note: input.note,
      status,
    });
  } else if (rr && rr.status === 'submitted') {
    ctx.db.update('RewriteRequests', (x) => x.id === rr.id, { note: input.note });
  } else {
    ctx.db.insert('RewriteRequests', {
      id: ctx.svc.uuid(),
      essay_id: essay.id,
      due_at: dueAt,
      note: input.note,
      status: 'requested',
      rewrite_essay_id: '',
      created_at: ctx.nowIso,
    });
  }
}

/** Read and validate the score form (shared by Save, Submit and Preview). */
function readScoreForm(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const essayId = r.id('essayId');
  const submit = r.bool('submit');
  const notifyAgain = r.bool('notifyAgain');
  const requestId = r.id('requestId', !(submit && notifyAgain));
  r.done();
  const essay = loadEssay(ctx, essayId);
  if (essay.status === 'draft')
    throw new ApiError('conflict', 'This essay has not been submitted yet.');
  if (essay.status === 'scored' && !submit) {
    throw new ApiError(
      'conflict',
      'This essay is already scored. Use “Preview and submit score” to update it.',
    );
  }

  const scoresR = r.object('scores');
  const scores = CRITERIA.map((c) => (scoresR ? scoresR.band(c, !submit) : null));
  if (scoresR) r.absorb('scores', scoresR);
  const feedbackR = r.object('feedback', true);
  const feedback = Object.fromEntries(
    CRITERIA.map((c) => [
      c,
      feedbackR ? feedbackR.str(c, { max: LIMITS.feedback, optional: true, trim: false }) : '',
    ]),
  );
  if (feedbackR) r.absorb('feedback', feedbackR);
  const generalComment = r.str('generalComment', {
    max: LIMITS.feedback,
    optional: true,
    trim: false,
  });
  // Fields that are not sent keep their current value (older essays may lack them).
  const category = {
    topicId: r.has('topicId') ? r.id('topicId') : essay.topic_id,
    diagramType: r.has('diagramType')
      ? r.oneOf('diagramType', DIAGRAM_TYPE_IDS)
      : essay.diagram_type,
    essayType: r.has('essayType') ? r.oneOf('essayType', ESSAY_TYPE_IDS) : essay.essay_type,
  } as Category;
  if (category.topicId && !ctx.db.byId('Topics', category.topicId)) {
    r.addError('topicId', 'Unknown topic');
  }
  const errors = readErrors(ctx, r, essay, submit);
  const rewriteR = r.object('rewrite', true);
  const rewrite = {
    required: rewriteR ? rewriteR.bool('required') : false,
    dueDate: '',
    note: rewriteR ? rewriteR.str('note', { max: LIMITS.note, optional: true }) : '',
  };
  if (rewriteR) {
    rewrite.dueDate = rewriteR.date('dueDate', !rewrite.required);
    r.absorb('rewrite', rewriteR);
  }
  const feedbackJson = JSON.stringify(feedback);
  if (feedbackJson.length > MAX_CELL - 1000) {
    r.addError('feedback', 'The feedback is too long in total. Please shorten it.');
  }
  r.done();
  return {
    essay,
    submit,
    notifyAgain,
    requestId,
    scores,
    feedback,
    feedbackJson,
    generalComment,
    category,
    errors,
    rewrite,
  };
}

function saveScore(ctx: Ctx, payload: unknown) {
  const {
    essay,
    submit,
    notifyAgain,
    requestId,
    scores,
    feedbackJson,
    generalComment,
    category,
    errors,
    rewrite,
  } = readScoreForm(ctx, payload);

  // Scores (overall always recomputed with the app's rounding).
  const complete = scores.every((s) => s !== null);
  const fields = {
    criterion_1: scores[0] ?? '',
    criterion_2: scores[1] ?? '',
    criterion_3: scores[2] ?? '',
    criterion_4: scores[3] ?? '',
    overall: complete ? overallBand(scores as number[]) : '',
    feedback_json: feedbackJson,
    general_comment: generalComment,
    updated_at: ctx.nowIso,
  };
  if (ctx.db.findOne('Scores', (s) => s.essay_id === essay.id)) {
    ctx.db.update('Scores', (s) => s.essay_id === essay.id, fields);
  } else {
    ctx.db.insert('Scores', { essay_id: essay.id, ...fields });
  }

  // Error log: replace the essay's errors. student_id always equals the essay's student.
  ctx.db.remove('ErrorLog', (x) => x.essay_id === essay.id);
  for (const e of errors) {
    ctx.db.insert('ErrorLog', {
      id: ctx.svc.uuid(),
      essay_id: essay.id,
      student_id: essay.student_id,
      category_id: e.categoryId,
      excerpt: e.excerpt,
      start_offset: e.start ?? '',
      end_offset: e.end ?? '',
      correction: e.correction,
      note: e.note,
      created_at: ctx.nowIso,
    });
  }

  const columns = categoryColumns(category);
  if (
    columns.topic_id !== essay.topic_id ||
    columns.diagram_type !== essay.diagram_type ||
    columns.essay_type !== essay.essay_type
  ) {
    ctx.db.update('Essays', (x) => x.id === essay.id, columns);
    renameEssayFolder(ctx, essay.id);
  }
  applyRewrite(ctx, essay, rewrite);

  if (!submit) {
    ctx.db.update('Essays', (x) => x.id === essay.id, { status: 'in_review' });
    return { email: 'draft', status: 'in_review' };
  }

  const wasScored = essay.status === 'scored';
  ctx.db.update('Essays', (x) => x.id === essay.id, {
    status: 'scored',
    scored_at: wasScored && essay.scored_at ? essay.scored_at : ctx.nowIso,
  });
  ensureClaudeSourceRow(ctx, essay.id);
  clearDashboardCache(ctx, essay.student_id);

  let email: SendOutcome | 'none' = 'none';
  const fresh = loadEssay(ctx, essay.id);
  if (!wasScored) {
    email = sendEmail(ctx, resultJob(ctx, fresh, 'result', '1'));
  } else if (notifyAgain) {
    email = sendEmail(ctx, resultJob(ctx, fresh, 'result_resent', requestId));
  }
  return { email, status: 'scored' };
}

/**
 * What the student will receive if this form is submitted now: the email
 * (subject, recipient, HTML and text) built from the unsaved form. Nothing is
 * written or sent.
 */
function previewResult(ctx: Ctx, payload: unknown) {
  const form = readScoreForm(ctx, { ...(payload as object), submit: true });
  const { essay, scores, category, errors, rewrite, generalComment, notifyAgain } = form;
  const student = ctx.db.byId('Users', essay.student_id);
  if (!student) throw new ApiError('not_found', 'Student not found.');
  const overall = overallBand(scores as number[]);
  const criteria = Object.fromEntries(CRITERIA.map((c, i) => [c, scores[i] as number])) as Record<
    Criterion,
    number
  >;
  const labels = new Map(ctx.db.all('ErrorCategories').map((c) => [c.id, c.label]));
  const sorted = [...errors].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  const rr = rewriteRequestFor(ctx, essay.id);
  const rewriteDueAt =
    rewrite.required && (!rr || rr.status !== 'submitted')
      ? endOfDayUtc(
          rewrite.dueDate,
          student.timezone || adminTimezone(ctx),
          ctx.svc.tzOffsetMinutes,
        )
      : null;
  const wasScored = essay.status === 'scored';
  const willEmail = !wasScored || notifyAgain;
  const message = resultMessage(ctx, { ...essay, ...categoryColumns(category) }, student, {
    criteria,
    overall,
    generalComment,
    topErrors: groupTopErrors(
      sorted.map((e) => ({
        category: labels.get(e.categoryId) ?? 'Uncategorised',
        excerpt: e.excerpt,
        correction: e.correction,
      })),
    ),
    rewriteDueAt,
    resent: wasScored,
  });
  return {
    to: student.email,
    studentName: student.name,
    overall,
    rewriteDueAt,
    /** 'send' | 'no_email' (student has no address) | 'none' (already scored, not notifying). */
    delivery: !willEmail ? 'none' : student.email ? 'send' : 'no_email',
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
}

/** Keys whose latest attempts all failed (no "sent" row for the key). */
function failedEvents(ctx: Ctx, filter: (e: Row<'EmailEvents'>) => boolean) {
  const all = ctx.db.all('EmailEvents');
  const sentKeys = new Set(all.filter((e) => e.status === 'sent').map((e) => e.idempotency_key));
  const queuedKeys = new Set(
    all.filter((e) => e.status === 'queued').map((e) => e.idempotency_key),
  );
  const byKey = new Map<string, Row<'EmailEvents'>>();
  for (const e of all) {
    if (
      e.status !== 'failed' ||
      sentKeys.has(e.idempotency_key) ||
      queuedKeys.has(e.idempotency_key)
    )
      continue;
    if (!filter(e)) continue;
    byKey.set(e.idempotency_key, e);
  }
  return [...byKey.values()];
}

function retryEvents(ctx: Ctx, events: Row<'EmailEvents'>[]) {
  const outcomes: Record<string, number> = {};
  for (const event of events) {
    const job = jobFromEvent(ctx, event);
    const outcome = job ? sendEmail(ctx, job) : 'skipped';
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { outcomes };
}

function emailStatus(ctx: Ctx) {
  const users = new Map(ctx.db.all('Users').map((u) => [u.id, u]));
  const view = (e: Row<'EmailEvents'>) => ({
    id: e.id,
    type: e.type,
    status: e.status,
    error: e.error,
    createdAt: e.created_at,
    essayId: e.essay_id || null,
    studentName: users.get(e.user_id)?.name ?? '',
  });
  const all = ctx.db.all('EmailEvents');
  return {
    remainingQuota: ctx.svc.mail.remainingQuota(),
    queued: all.filter((e) => e.status === 'queued').map(view),
    failed: failedEvents(ctx, () => true).map(view),
    recent: all.slice(-50).reverse().map(view),
  };
}

export const scoringActions: Record<string, ActionDef> = {
  'admin.saveScore': { write: true, handler: (ctx, p) => saveScore(ctx, p) },
  'admin.previewResult': { write: false, handler: (ctx, p) => previewResult(ctx, p) },
  'admin.resendEmail': {
    write: true,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const essayId = r.id('essayId', true);
      const eventId = r.id('eventId', true);
      if (!essayId && !eventId) r.addError('essayId', 'Required');
      r.done();
      return retryEvents(
        ctx,
        failedEvents(ctx, (e) => (eventId ? e.id === eventId : e.essay_id === essayId)),
      );
    },
  },
  'admin.emails': { write: false, handler: (ctx) => emailStatus(ctx) },
  'admin.emails.sendQueued': {
    write: true,
    handler: (ctx) => processEmailQueue(ctx, (e) => jobFromEvent(ctx, e)),
  },
  'admin.waiveRewrite': {
    write: true,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const id = r.id('id');
      r.done();
      const rr = ctx.db.byId('RewriteRequests', id);
      if (!rr) throw new ApiError('not_found', 'Rewrite request not found.');
      if (!['requested', 'overdue'].includes(effectiveRewriteStatus(rr, ctx.now))) {
        throw new ApiError('conflict', 'Only open rewrite requests can be waived.');
      }
      ctx.db.update('RewriteRequests', (x) => x.id === id, { status: 'waived' });
      const essay = ctx.db.byId('Essays', rr.essay_id);
      if (essay) clearDashboardCache(ctx, essay.student_id);
      return { status: 'waived' };
    },
  },
};
