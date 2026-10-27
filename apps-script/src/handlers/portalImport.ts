// IELTS Harper Portal, server to server:
// - portal.essays.import: essays written in the portal (the daily task and students' own
//   questions) join the normal queue and scoring flow, like an essay added by the teacher.
//   A retried request with the same submissionId returns the essay created the first time.
// - portal.signin: a one-time login link for a student signed in to the portal, so they open
//   Harper without logging in again. Never for an admin account.
//
// The portal's Apps Script sends the shared secret (Script Property PORTAL_SECRET here,
// HARPER_SECRET in the portal). Browsers never see it.
import { LIMITS, TASK_TYPES, type TaskType } from '../../../shared/constants';
import { checkImage } from '../../../shared/image';
import { countWords } from '../../../shared/wordCount';
import { categoryColumns, readCategory } from '../category';
import { newToken, takeRate } from '../auth';
import { adminTimezone, ApiError, appUrl, type Ctx } from '../context';
import { saveUploadedImage } from '../drive';
import type { ActionDef } from '../router';
import { Reader } from '../validate';
import { finalizeSubmission, MAX_PRACTICE_SECONDS } from './essays';

/** Compares two strings in time that does not depend on where they first differ. */
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Reads and checks the shared secret first, before any other field. */
function checkSecret(ctx: Ctx, r: Reader) {
  const expected = ctx.svc.props.PORTAL_SECRET ?? '';
  const secret = r.str('secret', { max: 200 });
  if (expected.length < 32 || !sameSecret(secret, expected)) {
    throw new ApiError('forbidden', 'Not allowed.');
  }
}

/** The Harper student with this email; created when they have no account yet. */
function portalStudent(ctx: Ctx, email: string, name: string) {
  const student = ctx.db.findOne('Users', (u) => u.email.toLowerCase() === email);
  if (student && student.role === 'admin') {
    throw new ApiError('bad_request', 'This email belongs to an admin account.');
  }
  if (student) return student;
  // A portal student without a Harper account: create one (they can also log in to Harper
  // directly later with this email).
  return ctx.db.insert('Users', {
    id: ctx.svc.uuid(),
    name,
    email,
    class: '',
    role: 'student',
    target_band: '',
    exam_date: '',
    timezone: adminTimezone(ctx),
    consent_at: '',
    created_at: ctx.nowIso,
  });
}

/** One-time login links from the portal live 2 minutes (the browser opens them at once). */
export const PORTAL_SIGNIN_MINUTES = 2;
const PORTAL_SIGNINS_PER_HOUR = 60;
/** Paths inside Harper the link may open after logging in, e.g. /essays/abc-123. */
const NEXT_PATH = /^\/[A-Za-z0-9/_-]{0,100}$/;

function signIn(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  checkSecret(ctx, r);
  const email = r.email('studentEmail');
  const name = r.str('studentName', { max: LIMITS.name, min: 1 });
  const next = r.str('next', { max: 101, optional: true });
  if (next && !NEXT_PATH.test(next)) r.addError('next', 'Not a page of IELTS Harper.');
  r.done();
  const rateKey = `rl:portal-signin:${ctx.svc.sha256Hex(email).slice(0, 32)}`;
  if (!takeRate(ctx, rateKey, PORTAL_SIGNINS_PER_HOUR)) {
    throw new ApiError('limit', 'Too many logins from the portal. Please try again later.');
  }
  const student = portalStudent(ctx, email, name);
  const token = newToken(ctx);
  ctx.db.insert('LoginTokens', {
    token_hash: ctx.svc.sha256Hex(token),
    user_id: student.id,
    expires_at: new Date(ctx.now.getTime() + PORTAL_SIGNIN_MINUTES * 60000).toISOString(),
    used_at: '',
  });
  const query = `token=${encodeURIComponent(token)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  return { url: appUrl(ctx, `/auth?${query}`) };
}

function importEssay(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  checkSecret(ctx, r);
  const submissionId = r.str('submissionId', { min: 8, max: 64 });
  const email = r.email('studentEmail');
  const name = r.str('studentName', { max: LIMITS.name, min: 1 });
  const taskType = r.oneOf('taskType', TASK_TYPES) as TaskType;
  const category = readCategory(ctx, r, taskType, { activeTopicsOnly: false });
  const prompt = r.str('prompt', { max: LIMITS.prompt, min: 10 });
  const body = r.str('body', { max: LIMITS.body, trim: false });
  const mode = r.oneOf('mode', ['practice', 'test'] as const) as 'practice' | 'test';
  const startedAt = r.isoTime('startedAt', true);
  // When the student submitted (a retried request can arrive later): used for test timing.
  const submittedAt = r.isoTime('submittedAt', true);
  const autoSubmitted = r.has('autoSubmitted') ? r.bool('autoSubmitted') : false;
  const pasteAttempts = r.int('pasteAttempts', { min: 0, max: 10000, optional: true }) ?? 0;
  // Practice: seconds spent writing, counted by the portal page (shown as Time spent).
  const timeSpent = r.int('timeSpentSeconds', {
    min: 0,
    max: MAX_PRACTICE_SECONDS,
    optional: true,
  });
  const imageR = r.object('image', true);
  let image: { base64: string; mimeType: string; name: string } | null = null;
  if (imageR) {
    image = {
      base64: imageR.str('base64', { max: 7_100_000 }),
      mimeType: imageR.str('mimeType', { max: 20 }),
      name: (imageR.str('name', { max: 120, optional: true }) || 'chart').replace(/[^\w .-]/g, '_'),
    };
    r.absorb('image', imageR);
    const problem = checkImage(image);
    if (problem) r.addError('image', problem);
  }
  if (taskType === 'task1_academic' && !image) {
    r.addError('image', 'Task 1 Academic needs the chart or diagram image.');
  }
  if (taskType === 'task2' && image) r.addError('image', 'Task 2 essays do not have an image');
  if (mode === 'test' && !startedAt) {
    r.addError('startedAt', 'Test mode needs the start time.');
  }
  r.done();

  const source = `portal:${submissionId}`;
  const existing = ctx.db.findOne('Essays', (e) => e.source === source);
  if (existing) return { essayId: existing.id, duplicate: true };

  const student = portalStudent(ctx, email, name);
  const essay = ctx.db.insert('Essays', {
    id: ctx.svc.uuid(),
    student_id: student.id,
    parent_essay_id: '',
    mode,
    assignment_id: '',
    started_at: mode === 'test' ? new Date(startedAt).toISOString() : '',
    time_used_seconds: mode === 'practice' && timeSpent ? timeSpent : '',
    auto_submitted: false,
    over_time: false,
    paste_attempts: pasteAttempts,
    task_type: taskType,
    ...categoryColumns(category),
    prompt,
    body,
    word_count: countWords(body),
    image_file_id: image ? saveUploadedImage(ctx, image) : '',
    status: 'draft',
    drive_folder_id: '',
    drive_sync_status: '',
    saved_at: ctx.nowIso,
    submitted_at: '',
    scored_at: '',
    test_date: '',
    source,
  });
  const submitted = finalizeSubmission(ctx, essay, {
    autoSubmitted,
    at: submittedAt || undefined,
  });
  return { essayId: submitted.id, duplicate: false, driveStatus: submitted.drive_sync_status };
}

export const portalImportActions: Record<string, ActionDef> = {
  'portal.essays.import': { write: true, handler: (ctx, p) => importEssay(ctx, p) },
  'portal.signin': { write: true, handler: (ctx, p) => signIn(ctx, p) },
};
