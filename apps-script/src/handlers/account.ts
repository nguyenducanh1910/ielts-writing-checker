// Public config, sign up, password and link login, sessions and the user's own account.
import { LIMITS } from '../../../shared/constants';
import {
  createSession,
  exchangeLoginToken,
  hashPassword,
  isUnclaimed,
  logout,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordLogin,
  requestLoginLink,
  takeRate,
  verifyPassword,
  type AuthUser,
} from '../auth';
import { authorize } from '../authorize';
import { adminTimezone, ApiError, bool, type Ctx, getNumberSetting, num } from '../context';
import { clearDashboardCache } from '../dashboardCache';
import { trashEssayFiles } from '../drive';
import type { ActionDef } from '../router';
import { Reader } from '../validate';

const SIGNUPS_PER_HOUR = 30;
const ACCOUNT_EXISTS = 'This email already has an account. Log in instead.';

export function publicUser(user: AuthUser) {
  const r = user.row;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    classId: r.class,
    targetBand: num(r.target_band),
    examDate: r.exam_date,
    timezone: r.timezone,
    hasPassword: !!r.password_hash,
  };
}

function readNewPassword(r: Reader, key: string): string {
  return r.str(key, { max: PASSWORD_MAX, min: PASSWORD_MIN, trim: false });
}

function config(ctx: Ctx) {
  return {
    classes: ctx.db
      .find('Classes', (c) => bool(c.active))
      .map((c) => ({ id: c.id, label: c.label })),
    topics: ctx.db.find('Topics', (t) => bool(t.active)).map((t) => ({ id: t.id, label: t.label })),
    dailyCap: getNumberSetting(ctx, 'daily_submission_cap'),
    adminTimezone: adminTimezone(ctx),
  };
}

function signup(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const name = r.str('name', { max: LIMITS.name, min: 2 });
  const email = r.email('email');
  const classId = r.id('classId');
  const password = readNewPassword(r, 'password');
  const consent = r.bool('consent');
  const timezone = r.timezone('timezone');
  if (!consent) r.addError('consent', 'Please agree to the privacy notice to continue.');
  if (classId && !ctx.db.findOne('Classes', (c) => c.id === classId && bool(c.active))) {
    r.addError('classId', 'Choose a class from the list');
  }
  r.done();
  const exists = ctx.db.findOne('Users', (u) => u.email.toLowerCase() === email);
  if (exists) {
    // Only an account nobody has used yet can be claimed (e.g. the login email never arrived).
    if (!isUnclaimed(ctx, exists)) {
      throw new ApiError('conflict', ACCOUNT_EXISTS, { email: ACCOUNT_EXISTS });
    }
    ctx.db.update('Users', (u) => u.id === exists.id, {
      name: exists.name || name,
      class: exists.class || classId,
      timezone: exists.timezone || timezone || adminTimezone(ctx),
      consent_at: exists.consent_at || ctx.nowIso,
      password_hash: hashPassword(ctx, password),
    });
  } else {
    // New accounts are limited per hour so a script cannot flood the Users tab.
    if (!takeRate(ctx, 'rl:signup', SIGNUPS_PER_HOUR)) {
      throw new ApiError('limit', 'Too many new accounts right now. Please try again in an hour.');
    }
    ctx.db.insert('Users', {
      id: ctx.svc.uuid(),
      name,
      email,
      class: classId,
      role: 'student',
      target_band: '',
      exam_date: '',
      timezone: timezone || adminTimezone(ctx),
      consent_at: ctx.nowIso,
      created_at: ctx.nowIso,
      password_hash: hashPassword(ctx, password),
    });
  }
  // Signing up logs the student straight in; no email is needed.
  const row = ctx.db.findOne('Users', (u) => u.email.toLowerCase() === email)!;
  const { sessionToken, user } = createSession(ctx, row);
  return { sessionToken, user: publicUser(user) };
}

function setMyPassword(ctx: Ctx, payload: unknown, user: AuthUser) {
  authorize('me.setPassword', user, { type: 'user', userId: user.id });
  const r = new Reader(payload);
  const current = r.str('currentPassword', { max: PASSWORD_MAX, optional: true, trim: false });
  const password = readNewPassword(r, 'newPassword');
  const row = ctx.db.byId('Users', user.id)!;
  if (row.password_hash && !verifyPassword(ctx, current, row.password_hash)) {
    r.addError('currentPassword', 'The current password is incorrect');
  }
  r.done();
  ctx.db.update('Users', (u) => u.id === user.id, { password_hash: hashPassword(ctx, password) });
  return publicUser({ ...user, row: ctx.db.byId('Users', user.id)! });
}

/** The teacher sets a password for a student and tells them in class. */
function setStudentPassword(ctx: Ctx, payload: unknown, user: AuthUser) {
  const r = new Reader(payload);
  const studentId = r.id('studentId');
  const password = readNewPassword(r, 'password');
  r.done();
  const student = ctx.db.byId('Users', studentId);
  if (!student || student.role === 'admin') throw new ApiError('not_found', 'Student not found.');
  authorize('admin.students.setPassword', user, { type: 'user', userId: student.id });
  ctx.db.update('Users', (u) => u.id === student.id, {
    password_hash: hashPassword(ctx, password),
  });
  return { saved: true };
}

function updateMe(ctx: Ctx, payload: unknown, user: AuthUser) {
  authorize('me.update', user, { type: 'user', userId: user.id });
  const r = new Reader(payload);
  const name = r.str('name', { max: LIMITS.name, min: 2 });
  const targetBand = r.band('targetBand', true);
  const examDate = r.date('examDate', true);
  const timezone = r.timezone('timezone');
  r.done();
  ctx.db.update('Users', (u) => u.id === user.id, {
    name,
    target_band: targetBand ?? '',
    exam_date: examDate,
    ...(timezone ? { timezone } : {}),
  });
  clearDashboardCache(ctx, user.id);
  const row = ctx.db.byId('Users', user.id)!;
  return publicUser({ ...user, name: row.name, row });
}

/** Delete the account: rows in every tab, Drive folders to trash, sessions ended. */
export function deleteUserData(ctx: Ctx, userId: string): void {
  const { db } = ctx;
  const essays = db.find('Essays', (e) => e.student_id === userId);
  const essayIds = new Set(essays.map((e) => e.id));
  for (const essay of essays) trashEssayFiles(ctx, essay);
  const inEssays = (r: { essay_id: string }) => essayIds.has(r.essay_id);
  db.remove('Drafts', inEssays);
  db.remove('SourceFeedback', inEssays);
  db.remove('Scores', inEssays);
  db.remove('RewriteRequests', inEssays);
  db.remove('CalibrationSamples', inEssays);
  db.remove('ErrorLog', (r) => r.student_id === userId || essayIds.has(r.essay_id));
  db.remove('EmailEvents', (r) => r.user_id === userId || essayIds.has(r.essay_id));
  db.remove('Essays', (r) => r.student_id === userId);
  db.remove('LoginTokens', (r) => r.user_id === userId);
  db.remove('Sessions', (r) => r.user_id === userId);
  for (const a of db.all('Assignments')) {
    const ids = JSON.parse(a.student_ids || '[]') as string[];
    if (ids.includes(userId)) {
      db.update('Assignments', (x) => x.id === a.id, {
        student_ids: JSON.stringify(ids.filter((id) => id !== userId)),
      });
    }
  }
  db.remove('Users', (r) => r.id === userId);
  clearDashboardCache(ctx, userId);
}

function deleteMe(ctx: Ctx, payload: unknown, user: AuthUser) {
  authorize('me.delete', user, { type: 'user', userId: user.id });
  const r = new Reader(payload);
  const confirm = r.str('confirm', { max: 10 });
  if (confirm !== 'DELETE') r.addError('confirm', 'Type DELETE to confirm');
  r.done();
  if (user.role === 'admin') {
    throw new ApiError('forbidden', 'The admin account cannot be deleted from the app.');
  }
  deleteUserData(ctx, user.id);
  return { deleted: true };
}

export const accountActions: Record<string, ActionDef> = {
  'config.get': { write: false, handler: (ctx) => config(ctx) },
  'auth.signup': { write: true, handler: (ctx, p) => signup(ctx, p) },
  'auth.login': {
    write: true,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const email = r.str('email', { max: LIMITS.email });
      const password = r.str('password', { max: PASSWORD_MAX, trim: false, optional: true });
      r.done();
      const normalized = email.trim().toLowerCase();
      // No password typed, or an account that has none yet (added by the teacher or by IELTS
      // Harper Portal): email a one-time login link instead of showing an error.
      const row = ctx.db.findOne('Users', (u) => u.email.toLowerCase() === normalized);
      if (!password || (row && !row.password_hash)) {
        requestLoginLink(ctx, normalized);
        // With a password typed we only get here for an existing account (it has none yet), so
        // the page may say the link was sent. With no password, do not reveal whether it exists.
        return { linkSent: true, email: normalized, knownAccount: password ? true : undefined };
      }
      const { sessionToken, user } = passwordLogin(ctx, email, password);
      return { sessionToken, user: publicUser(user) };
    },
  },
  'auth.requestLink': {
    write: true,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const email = r.str('email', { max: LIMITS.email });
      r.done();
      return requestLoginLink(ctx, email);
    },
  },
  'auth.exchange': {
    write: true,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const token = r.str('token', { max: 128 });
      r.done();
      const { sessionToken, user } = exchangeLoginToken(ctx, token);
      return { sessionToken, user: publicUser(user) };
    },
  },
  'auth.logout': {
    write: true,
    handler: (ctx, _p, _u, token) => {
      logout(ctx, token);
      return { loggedOut: true };
    },
  },
  'me.get': { write: false, handler: (_ctx, _p, user) => publicUser(user!) },
  'me.update': { write: true, handler: (ctx, p, user) => updateMe(ctx, p, user!) },
  'me.setPassword': { write: true, handler: (ctx, p, user) => setMyPassword(ctx, p, user!) },
  'admin.students.setPassword': {
    write: true,
    handler: (ctx, p, user) => setStudentPassword(ctx, p, user!),
  },
  'me.delete': { write: true, handler: (ctx, p, user) => deleteMe(ctx, p, user!) },
};
