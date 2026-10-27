// Student essay actions: drafts, timed tests, submission, images.
import {
  LIMITS,
  MODES,
  OVER_TIME_GRACE_SECONDS,
  TASK_TYPES,
  type TaskType,
} from '../../../shared/constants';
import { checkImage } from '../../../shared/image';
import { countWords } from '../../../shared/wordCount';
import type { AuthUser } from '../auth';
import { authorize } from '../authorize';
import { type Category, categoryColumns, hasCategory, readCategory } from '../category';
import { ApiError, type Ctx, type EssayRow, getNumberSetting, num } from '../context';
import { clearDashboardCache } from '../dashboardCache';
import { archiveEssay, isSharedImage, saveUploadedImage } from '../drive';
import type { ActionDef } from '../router';
import { Reader } from '../validate';
import {
  deadlineAt,
  effectiveRewriteStatus,
  essayDetail,
  essaySummary,
  rewriteRequestFor,
} from '../views';

interface ImageInput {
  base64: string;
  mimeType: string;
  name: string;
}

function readImage(r: Reader, key = 'image'): ImageInput | null {
  const obj = r.object(key, true);
  if (!obj) return null;
  const base64 = obj.str('base64', { max: 7_100_000 });
  const mimeType = obj.str('mimeType', { max: 20 });
  const name = obj.str('name', { max: 120, optional: true }) || 'chart';
  r.absorb(key, obj);
  if (base64 && mimeType) {
    const problem = checkImage({ base64, mimeType });
    if (problem) r.addError(key, problem);
  }
  return { base64, mimeType, name: name.replace(/[^\w .-]/g, '_') };
}

function loadEssay(ctx: Ctx, id: string): EssayRow {
  const essay = ctx.db.byId('Essays', id);
  if (!essay) throw new ApiError('not_found', 'Essay not found.');
  return essay;
}

/** Essays this student submitted in the last 24 hours that count toward the daily cap. */
export function submissionsInLastDay(ctx: Ctx, studentId: string): EssayRow[] {
  const since = ctx.now.getTime() - 86400000;
  return ctx.db.find(
    'Essays',
    (e) =>
      e.student_id === studentId &&
      e.status !== 'draft' &&
      e.mode !== 'assigned' &&
      e.source !== 'admin' &&
      Boolean(e.submitted_at) &&
      Date.parse(e.submitted_at) > since,
  );
}

function enforceDailyCap(ctx: Ctx, studentId: string): void {
  const cap = getNumberSetting(ctx, 'daily_submission_cap');
  const recent = submissionsInLastDay(ctx, studentId);
  if (cap > 0 && recent.length >= cap) {
    const oldest = recent.map((e) => Date.parse(e.submitted_at)).sort((a, b) => a - b)[0];
    throw new ApiError('limit', `You have reached the limit of ${cap} essays in 24 hours.`, {
      nextAllowedAt: new Date(oldest + 86400000).toISOString(),
    });
  }
}

function replaceImage(ctx: Ctx, essay: EssayRow | null, image: ImageInput | null): string | null {
  if (!image) return null;
  if (essay?.image_file_id && !isSharedImage(ctx, essay)) {
    try {
      ctx.svc.drive.trashFile(essay.image_file_id);
    } catch {
      // Old image already gone; nothing to do.
    }
  }
  return saveUploadedImage(ctx, image);
}

/** Validate the open rewrite request on a scored parent essay. */
function rewriteParent(ctx: Ctx, user: AuthUser, parentId: string): EssayRow {
  const parent = loadEssay(ctx, parentId);
  authorize('essays.rewrite', user, { type: 'essay', essay: parent });
  const rr = rewriteRequestFor(ctx, parent.id);
  const status = rr ? effectiveRewriteStatus(rr, ctx.now) : null;
  if (!rr || (status !== 'requested' && status !== 'overdue')) {
    throw new ApiError('conflict', 'There is no open rewrite request for this essay.');
  }
  return parent;
}

/** Practice time is capped at 6 hours (a tab left open for days must not count). */
export const MAX_PRACTICE_SECONDS = 6 * 3600;

function saveDraft(ctx: Ctx, payload: unknown, user: AuthUser) {
  const r = new Reader(payload);
  const id = r.id('id', true);
  const body = r.str('body', { max: LIMITS.body, optional: true, trim: false });
  const pasteAttempts = r.int('pasteAttempts', { min: 0, max: 100000, optional: true });
  const image = readImage(r);
  const existing = id ? loadEssay(ctx, id) : null;
  if (existing) authorize('essays.saveDraft', user, { type: 'essay', essay: existing });

  // Timed essays: the prompt, topic and image are fixed when the test starts.
  if (existing && existing.mode !== 'practice') {
    r.done();
    ctx.db.update('Essays', (e) => e.id === existing.id, {
      body,
      word_count: countWords(body),
      saved_at: ctx.nowIso,
      ...(pasteAttempts !== null
        ? { paste_attempts: Math.max(pasteAttempts, num(existing.paste_attempts) ?? 0) }
        : {}),
    });
    return essayDetail(ctx, loadEssay(ctx, existing.id));
  }

  const parentId = r.id('parentEssayId', true);
  // A rewrite takes its task type, topic/diagram/essay type, prompt and image from the original.
  const isRewrite = Boolean(parentId || existing?.parent_essay_id);
  let taskType = r.oneOf('taskType', TASK_TYPES, isRewrite) as TaskType;
  let category: Category = isRewrite
    ? { topicId: '', diagramType: '', essayType: '' }
    : readCategory(ctx, r, taskType, { activeTopicsOnly: true });
  let prompt = r.str('prompt', { max: LIMITS.prompt, optional: true });
  const testDate = r.date('testDate', true);
  // Practice: time spent writing, counted by the student's browser (a guide, not proof).
  const timeSpent = r.int('timeSpentSeconds', {
    min: 0,
    max: MAX_PRACTICE_SECONDS,
    optional: true,
  });
  const removeImage = r.bool('removeImage');
  if (taskType === 'task2' && image) r.addError('image', 'Task 2 essays do not have an image');
  r.done();

  let imageFileId = existing?.image_file_id ?? '';
  let parent: EssayRow | null = null;
  const effectiveParent = existing?.parent_essay_id || parentId;
  if (effectiveParent) {
    parent = rewriteParent(ctx, user, effectiveParent);
    // A rewrite keeps the original's task type, prompt, topic and image.
    taskType = parent.task_type as TaskType;
    prompt = parent.prompt;
    category = {
      topicId: parent.topic_id,
      diagramType: parent.diagram_type as Category['diagramType'],
      essayType: parent.essay_type as Category['essayType'],
    };
    imageFileId = parent.image_file_id;
  } else {
    const newImage = replaceImage(ctx, existing, image);
    if (newImage) imageFileId = newImage;
    if ((removeImage || taskType === 'task2') && imageFileId && existing) {
      if (!isSharedImage(ctx, existing)) ctx.svc.drive.trashFile(imageFileId);
      imageFileId = '';
    }
  }

  const fields = {
    task_type: taskType,
    ...categoryColumns(category),
    prompt,
    body,
    word_count: countWords(body),
    image_file_id: imageFileId,
    test_date: testDate,
    saved_at: ctx.nowIso,
    ...(pasteAttempts !== null ? { paste_attempts: pasteAttempts } : {}),
    // Never goes down (an older tab saving later must not shorten it).
    ...(timeSpent !== null
      ? { time_used_seconds: Math.max(timeSpent, num(existing?.time_used_seconds ?? '') ?? 0) }
      : {}),
  };

  if (existing) {
    ctx.db.update('Essays', (e) => e.id === existing.id, fields);
    return essayDetail(ctx, loadEssay(ctx, existing.id));
  }
  if (parent) {
    // One draft rewrite per original: reuse it if it already exists.
    const draft = ctx.db.findOne(
      'Essays',
      (e) => e.parent_essay_id === parent!.id && e.student_id === user.id && e.status === 'draft',
    );
    if (draft) {
      ctx.db.update('Essays', (e) => e.id === draft.id, fields);
      return essayDetail(ctx, loadEssay(ctx, draft.id));
    }
  }
  const created = ctx.db.insert('Essays', {
    id: ctx.svc.uuid(),
    student_id: user.id,
    parent_essay_id: parent?.id ?? '',
    mode: 'practice',
    assignment_id: '',
    started_at: '',
    time_used_seconds: '',
    auto_submitted: false,
    over_time: false,
    paste_attempts: pasteAttempts ?? 0,
    status: 'draft',
    drive_folder_id: '',
    drive_sync_status: '',
    submitted_at: '',
    scored_at: '',
    ...fields,
  });
  return essayDetail(ctx, created);
}

function startTest(ctx: Ctx, payload: unknown, user: AuthUser) {
  const r = new Reader(payload);
  const taskType = r.oneOf('taskType', TASK_TYPES) as TaskType;
  const category = readCategory(ctx, r, taskType, { activeTopicsOnly: true });
  const prompt = r.str('prompt', { max: LIMITS.prompt, min: 10 });
  const image = readImage(r);
  if (taskType === 'task1_academic' && !image) {
    r.addError('image', 'Attach the chart or diagram image before starting the test.');
  }
  if (taskType === 'task2' && image) r.addError('image', 'Task 2 essays do not have an image');
  r.done();
  enforceDailyCap(ctx, user.id);
  const imageId = image ? saveUploadedImage(ctx, image) : '';
  const essay = ctx.db.insert('Essays', {
    id: ctx.svc.uuid(),
    student_id: user.id,
    mode: 'test',
    started_at: ctx.nowIso,
    auto_submitted: false,
    over_time: false,
    paste_attempts: 0,
    task_type: taskType,
    ...categoryColumns(category),
    prompt,
    body: '',
    word_count: 0,
    image_file_id: imageId,
    status: 'draft',
    saved_at: ctx.nowIso,
  });
  return essayDetail(ctx, essay);
}

/** Lock a draft as submitted. Shared by the submit action and the auto-submit job. */
export function finalizeSubmission(
  ctx: Ctx,
  essay: EssayRow,
  /**
   * `at`: when the hourly job submits an abandoned test, the moment the time
   * ran out, so the essay is not marked over time for a delay that was ours.
   */
  options: { autoSubmitted: boolean; at?: string },
): EssayRow {
  const problems: Record<string, string> = {};
  if (!essay.prompt.trim()) problems.prompt = 'Enter the task prompt';
  if (!hasCategory(essay)) {
    if (essay.task_type === 'task1_academic') problems.diagramType = 'Choose the diagram type';
    else problems.topicId = 'Choose a topic';
  }
  if (countWords(essay.body) === 0 && essay.mode === 'practice') problems.body = 'Write your essay';
  if (essay.task_type === 'task1_academic' && !essay.image_file_id) {
    problems.image = 'Task 1 Academic needs the chart or diagram image.';
  }
  if (Object.keys(problems).length) {
    throw new ApiError('bad_request', 'Please complete the essay before submitting.', problems);
  }
  const patch: Record<string, unknown> = {
    status: 'pending',
    submitted_at: ctx.nowIso,
    saved_at: ctx.nowIso,
    word_count: countWords(essay.body),
    drive_sync_status: 'pending',
  };
  if (essay.mode !== 'practice' && essay.started_at) {
    // Timing is computed on the server; the browser clock is never trusted.
    const endMs = options.at ? Date.parse(options.at) : ctx.now.getTime();
    const used = Math.round((endMs - Date.parse(essay.started_at)) / 1000);
    const deadline = deadlineAt(ctx, essay);
    patch.time_used_seconds = used;
    patch.auto_submitted = options.autoSubmitted;
    patch.over_time = deadline
      ? endMs > Date.parse(deadline) + OVER_TIME_GRACE_SECONDS * 1000
      : false;
  }
  ctx.db.update('Essays', (e) => e.id === essay.id, patch);
  if (essay.parent_essay_id) {
    const rr = rewriteRequestFor(ctx, essay.parent_essay_id);
    if (rr && rr.status !== 'waived') {
      ctx.db.update('RewriteRequests', (x) => x.id === rr.id, {
        status: 'submitted',
        rewrite_essay_id: essay.id,
      });
    }
  }
  archiveEssay(ctx, essay.id);
  clearDashboardCache(ctx, essay.student_id);
  return loadEssay(ctx, essay.id);
}

function submit(ctx: Ctx, payload: unknown, user: AuthUser) {
  const r = new Reader(payload);
  const id = r.id('id');
  const autoSubmitted = r.bool('autoSubmitted');
  r.done();
  const essay = loadEssay(ctx, id);
  authorize('essays.submit', user, { type: 'essay', essay });
  // Apply the latest text first (same rules as saving a draft).
  saveDraft(ctx, payload, user);
  const fresh = loadEssay(ctx, id);
  if (fresh.mode !== 'assigned') {
    // Timed tests passed the cap check when they started.
    if (fresh.mode === 'practice') enforceDailyCap(ctx, user.id);
  }
  const submitted = finalizeSubmission(ctx, fresh, { autoSubmitted });
  return { essay: essayDetail(ctx, submitted), driveStatus: submitted.drive_sync_status };
}

function deleteDraft(ctx: Ctx, payload: unknown, user: AuthUser) {
  const r = new Reader(payload);
  const id = r.id('id');
  r.done();
  const essay = loadEssay(ctx, id);
  authorize('essays.deleteDraft', user, { type: 'essay', essay });
  if (essay.mode !== 'practice') {
    throw new ApiError('conflict', 'A started test cannot be deleted.');
  }
  if (essay.image_file_id && !isSharedImage(ctx, essay)) {
    try {
      ctx.svc.drive.trashFile(essay.image_file_id);
    } catch {
      // ignore
    }
  }
  ctx.db.remove('Essays', (e) => e.id === essay.id);
  return { deleted: true };
}

function getImage(ctx: Ctx, payload: unknown, user: AuthUser) {
  const r = new Reader(payload);
  const id = r.id('essayId');
  r.done();
  const essay = loadEssay(ctx, id);
  authorize('essays.image', user, { type: 'image', essay });
  if (!essay.image_file_id) throw new ApiError('not_found', 'This essay has no image.');
  const file = ctx.svc.drive.readFile(essay.image_file_id);
  return { mimeType: file.mimeType, base64: file.base64 };
}

export const essayActions: Record<string, ActionDef> = {
  'essays.listMine': {
    write: false,
    handler: (ctx, p, user) => {
      const r = new Reader(p);
      const mode = r.oneOf('mode', MODES, true);
      r.done();
      return ctx.db
        .find('Essays', (e) => e.student_id === user!.id && (!mode || e.mode === mode))
        .map((e) => essaySummary(ctx, e))
        .sort((a, b) => (b.submittedAt ?? b.savedAt).localeCompare(a.submittedAt ?? a.savedAt));
    },
  },
  'essays.get': {
    write: false,
    handler: (ctx, p, user) => {
      const r = new Reader(p);
      const id = r.id('id');
      r.done();
      const essay = loadEssay(ctx, id);
      authorize('essays.get', user, { type: 'essay', essay });
      return essayDetail(ctx, essay);
    },
  },
  'essays.saveDraft': { write: true, handler: (ctx, p, user) => saveDraft(ctx, p, user!) },
  'essays.startTest': { write: true, handler: (ctx, p, user) => startTest(ctx, p, user!) },
  'essays.submit': { write: true, handler: (ctx, p, user) => submit(ctx, p, user!) },
  'essays.deleteDraft': { write: true, handler: (ctx, p, user) => deleteDraft(ctx, p, user!) },
  'essays.image': { write: false, handler: (ctx, p, user) => getImage(ctx, p, user!) },
};
