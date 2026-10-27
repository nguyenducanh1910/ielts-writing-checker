// Admin queue, scoring page data, Claude drafts, external tool feedback.
import { overallBand } from '../../../shared/band';
import { parseClaudeReply } from '../../../shared/claude';
import { CRITERIA, LIMITS, TASK_TYPES } from '../../../shared/constants';
import { calibrationFor } from '../calibration';
import { essayLabel } from '../category';
import { ApiError, bool, type Ctx, type EssayRow, num, parseJson } from '../context';
import { clearDashboardCache } from '../dashboardCache';
import { MAX_CELL } from '../db';
import { archiveEssay } from '../drive';
import type { ActionDef } from '../router';
import type { Row } from '../schema';
import { Reader } from '../validate';
import { errorsView, essayDetail, rewriteRequestFor, rewriteView, scoreView } from '../views';

export type QueueStatus = 'new' | 'claude_pasted' | 'in_review' | 'drive_failed' | 'scored';

export function queueStatus(ctx: Ctx, essay: EssayRow): QueueStatus {
  if (essay.status === 'scored') return 'scored';
  if (essay.drive_sync_status === 'failed') return 'drive_failed';
  if (essay.status === 'in_review') return 'in_review';
  if (ctx.db.findOne('Drafts', (d) => d.essay_id === essay.id && d.kind === 'initial')) {
    return 'claude_pasted';
  }
  return 'new';
}

function loadEssay(ctx: Ctx, id: string): EssayRow {
  const essay = ctx.db.byId('Essays', id);
  if (!essay) throw new ApiError('not_found', 'Essay not found.');
  return essay;
}

function queue(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const taskType = r.oneOf('taskType', TASK_TYPES, true);
  const studentId = r.id('studentId', true);
  const assignmentId = r.id('assignmentId', true);
  const status = r.oneOf(
    'status',
    ['new', 'claude_pasted', 'in_review', 'drive_failed', 'scored'] as const,
    true,
  );
  r.done();
  const users = new Map(ctx.db.all('Users').map((u) => [u.id, u]));
  const assignments = new Map(ctx.db.all('Assignments').map((a) => [a.id, a]));
  const items = ctx.db
    .find('Essays', (e) => {
      if (e.status === 'draft') return false;
      if (status !== 'scored' && e.status === 'scored') return false;
      if (taskType && e.task_type !== taskType) return false;
      if (studentId && e.student_id !== studentId) return false;
      if (assignmentId && e.assignment_id !== assignmentId) return false;
      return true;
    })
    .map((e) => ({ essay: e, qs: queueStatus(ctx, e) }))
    .filter((x) => !status || x.qs === status)
    .map(({ essay: e, qs }) => ({
      id: e.id,
      studentId: e.student_id,
      studentName: users.get(e.student_id)?.name ?? '(deleted)',
      taskType: e.task_type,
      mode: e.mode,
      topic: essayLabel(ctx, e),
      submittedAt: e.submitted_at,
      scoredAt: e.scored_at || null,
      wordCount: num(e.word_count) ?? 0,
      queueStatus: qs,
      isRewrite: Boolean(e.parent_essay_id),
      uploadedByAdmin: e.source === 'admin',
      assignmentId: e.assignment_id || null,
      assignmentTitle: assignments.get(e.assignment_id)?.title ?? null,
      overTime: bool(e.over_time),
      pasteAttempts: num(e.paste_attempts) ?? 0,
    }));
  // Oldest first; recently scored essays newest first.
  items.sort((a, b) =>
    status === 'scored'
      ? (b.scoredAt ?? '').localeCompare(a.scoredAt ?? '')
      : a.submittedAt.localeCompare(b.submittedAt),
  );
  const emailQueued = ctx.db.find('EmailEvents', (e) => e.status === 'queued').length;
  const emailFailed = ctx.db.find(
    'EmailEvents',
    (e) =>
      e.status === 'failed' &&
      !ctx.db.findOne(
        'EmailEvents',
        (x) => x.idempotency_key === e.idempotency_key && x.status === 'sent',
      ),
  ).length;
  return {
    items,
    students: ctx.db
      .find('Users', (u) => u.role !== 'admin')
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    assignments: [...assignments.values()].map((a) => ({ id: a.id, title: a.title })),
    emailQueued,
    emailFailed,
  };
}

/** The student's most frequent error categories in the last 30 days (excluding this essay). */
export function recurringErrors(ctx: Ctx, studentId: string, excludeEssayId: string, days = 30) {
  const since = ctx.now.getTime() - days * 86400000;
  const recent = new Set(
    ctx.db
      .find(
        'Essays',
        (e) =>
          e.student_id === studentId &&
          e.id !== excludeEssayId &&
          e.status === 'scored' &&
          Date.parse(e.scored_at || e.submitted_at) >= since,
      )
      .map((e) => e.id),
  );
  const labels = new Map(ctx.db.all('ErrorCategories').map((c) => [c.id, c.label]));
  const counts = new Map<string, number>();
  for (const row of ctx.db.find('ErrorLog', (x) => recent.has(x.essay_id))) {
    const label = labels.get(row.category_id) ?? 'Uncategorised';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .slice(0, 5);
}

function sourceFeedbackView(row: Row<'SourceFeedback'>) {
  return {
    id: row.id,
    sourceId: row.source_id,
    scores: {
      task: num(row.criterion_1),
      coherence: num(row.criterion_2),
      lexical: num(row.criterion_3),
      grammar: num(row.criterion_4),
    },
    overall: num(row.overall),
    feedbackText: row.feedback_text,
    createdAt: row.created_at,
  };
}

function latestDraft(ctx: Ctx, essayId: string, kind: 'initial' | 'reconcile') {
  const d = ctx.db
    .find('Drafts', (x) => x.essay_id === essayId && x.kind === kind)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return d
    ? {
        id: d.id,
        rawText: d.raw_text,
        parsed: parseJson(d.parsed_json, null),
        createdAt: d.created_at,
      }
    : null;
}

function adminEssay(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const id = r.id('id');
  r.done();
  const essay = loadEssay(ctx, id);
  const student = ctx.db.byId('Users', essay.student_id);
  const parent = essay.parent_essay_id ? ctx.db.byId('Essays', essay.parent_essay_id) : undefined;
  const classLabel = student ? (ctx.db.byId('Classes', student.class)?.label ?? '') : '';
  const assignment = essay.assignment_id
    ? ctx.db.byId('Assignments', essay.assignment_id)
    : undefined;
  const rr = rewriteRequestFor(ctx, essay.id);
  return {
    // Admin sees the working score and errors even before Submit score.
    essay: {
      ...essayDetail(ctx, essay),
      score: scoreView(ctx, essay.id),
      errors: errorsView(ctx, essay.id),
      rewrite: rewriteView(ctx, rr),
      driveStatus: essay.drive_sync_status,
      driveFolderId: essay.drive_folder_id,
      queueStatus: queueStatus(ctx, essay),
      startedAt: essay.started_at || null,
    },
    student: student
      ? { id: student.id, name: student.name, email: student.email, className: classLabel }
      : null,
    assignment: assignment ? { id: assignment.id, title: assignment.title } : null,
    parent: parent
      ? {
          id: parent.id,
          prompt: parent.prompt,
          body: parent.body,
          submittedAt: parent.submitted_at,
          score: scoreView(ctx, parent.id),
          errors: errorsView(ctx, parent.id),
        }
      : null,
    claudeDraft: latestDraft(ctx, essay.id, 'initial'),
    reconcile: latestDraft(ctx, essay.id, 'reconcile'),
    sourceFeedback: ctx.db
      .find('SourceFeedback', (x) => x.essay_id === essay.id)
      .map(sourceFeedbackView),
    sources: ctx.db
      .all('FeedbackSources')
      .map((s) => ({ id: s.id, name: s.name, active: bool(s.active) })),
    calibration: calibrationFor(ctx, essay.task_type),
    categories: ctx.db.all('ErrorCategories').map((c) => ({
      id: c.id,
      criterion: c.criterion,
      label: c.label,
      active: bool(c.active),
    })),
    topics: ctx.db.all('Topics').map((t) => ({ id: t.id, label: t.label, active: bool(t.active) })),
    recurringErrors: recurringErrors(ctx, essay.student_id, essay.id),
    isSample: Boolean(ctx.db.findOne('CalibrationSamples', (s) => s.essay_id === essay.id)),
    emailEvents: ctx.db
      .find('EmailEvents', (e) => e.essay_id === essay.id)
      .map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        error: e.error,
        createdAt: e.created_at,
        key: e.idempotency_key,
      })),
  };
}

function saveClaudeDraft(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const essayId = r.id('essayId');
  const rawText = r.str('rawText', { max: LIMITS.rawText, trim: false });
  r.done();
  const essay = loadEssay(ctx, essayId);
  const parsed = parseClaudeReply(rawText);
  if (!parsed.ok) {
    throw new ApiError('bad_request', 'The Claude reply is not valid.', {
      rawText: parsed.errors.join(' '),
    });
  }
  const parsedJson = JSON.stringify(parsed.value);
  const draft = ctx.db.insert('Drafts', {
    id: ctx.svc.uuid(),
    essay_id: essay.id,
    kind: 'initial',
    raw_text: rawText,
    // The raw reply can always be parsed again, so drop the parsed copy if it would not fit a cell.
    parsed_json: parsedJson.length < MAX_CELL ? parsedJson : '',
    created_at: ctx.nowIso,
  });
  return { id: draft.id, createdAt: draft.created_at };
}

function saveReconcile(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const essayId = r.id('essayId');
  const rawText = r.str('rawText', { max: LIMITS.rawText, trim: false });
  r.done();
  loadEssay(ctx, essayId);
  const draft = ctx.db.insert('Drafts', {
    id: ctx.svc.uuid(),
    essay_id: essayId,
    kind: 'reconcile',
    raw_text: rawText,
    parsed_json: '',
    created_at: ctx.nowIso,
  });
  return { id: draft.id, createdAt: draft.created_at };
}

function saveSourceFeedback(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const essayId = r.id('essayId');
  const sourceId = r.id('sourceId');
  const scores = r.object('scores', true);
  const values = CRITERIA.map((c) => (scores ? scores.band(c, true) : null));
  if (scores) r.absorb('scores', scores);
  let overall = r.band('overall', true);
  const feedbackText = r.str('feedbackText', { max: LIMITS.rawText, optional: true, trim: false });
  r.done();
  const essay = loadEssay(ctx, essayId);
  if (!ctx.db.byId('FeedbackSources', sourceId)) throw new ApiError('not_found', 'Unknown source.');
  if (overall === null && values.every((v) => v !== null))
    overall = overallBand(values as number[]);
  const fields = {
    criterion_1: values[0] ?? '',
    criterion_2: values[1] ?? '',
    criterion_3: values[2] ?? '',
    criterion_4: values[3] ?? '',
    overall: overall ?? '',
    feedback_text: feedbackText,
  };
  const existing = ctx.db.findOne(
    'SourceFeedback',
    (x) => x.essay_id === essay.id && x.source_id === sourceId,
  );
  if (existing) {
    ctx.db.update('SourceFeedback', (x) => x.id === existing.id, fields);
  } else {
    ctx.db.insert('SourceFeedback', {
      id: ctx.svc.uuid(),
      essay_id: essay.id,
      source_id: sourceId,
      created_at: ctx.nowIso,
      ...fields,
    });
  }
  if (essay.status === 'scored') clearDashboardCache(ctx, essay.student_id);
  const row = ctx.db.findOne(
    'SourceFeedback',
    (x) => x.essay_id === essay.id && x.source_id === sourceId,
  )!;
  return sourceFeedbackView(row);
}

function retryDrive(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const essayId = r.id('essayId');
  r.done();
  const essay = loadEssay(ctx, essayId);
  if (essay.status === 'draft') throw new ApiError('conflict', 'Drafts are not copied to Drive.');
  return { driveStatus: archiveEssay(ctx, essay.id) };
}

function toggleSample(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const essayId = r.id('essayId');
  const sample = r.bool('sample');
  r.done();
  loadEssay(ctx, essayId);
  ctx.db.remove('CalibrationSamples', (s) => s.essay_id === essayId);
  if (sample) {
    ctx.db.insert('CalibrationSamples', {
      id: ctx.svc.uuid(),
      essay_id: essayId,
      created_at: ctx.nowIso,
    });
  }
  return { sample };
}

export const adminActions: Record<string, ActionDef> = {
  'admin.queue': { write: false, handler: (ctx, p) => queue(ctx, p) },
  'admin.essay': { write: false, handler: (ctx, p) => adminEssay(ctx, p) },
  'admin.essayImage': {
    write: false,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const id = r.id('essayId');
      r.done();
      const essay = loadEssay(ctx, id);
      if (!essay.image_file_id) throw new ApiError('not_found', 'This essay has no image.');
      const f = ctx.svc.drive.readFile(essay.image_file_id);
      return { mimeType: f.mimeType, base64: f.base64 };
    },
  },
  'admin.saveClaudeDraft': { write: true, handler: (ctx, p) => saveClaudeDraft(ctx, p) },
  'admin.saveReconcile': { write: true, handler: (ctx, p) => saveReconcile(ctx, p) },
  'admin.saveSourceFeedback': { write: true, handler: (ctx, p) => saveSourceFeedback(ctx, p) },
  'admin.retryDrive': { write: true, handler: (ctx, p) => retryDrive(ctx, p) },
  'admin.setSample': { write: true, handler: (ctx, p) => toggleSample(ctx, p) },
};
