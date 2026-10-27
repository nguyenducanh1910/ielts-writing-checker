// Login with email and password, or with an emailed single-use link; 30-day sessions.
// Only SHA-256 hashes of tokens are stored; passwords are salted and hashed many times.
import { ApiError, appUrl, type Ctx, isAdminEmail, type UserRow } from './context';
import { loginEmail } from './emailTemplates';
import { type EmailJob, sendEmail } from './email';

export const LOGIN_TOKEN_MINUTES = 15;
export const SESSION_DAYS = 30;
export const RATE_PER_EMAIL = 3;
export const RATE_GLOBAL = 30;
export const LOGIN_LINK_MESSAGE = 'If that email is registered, a link is on its way.';
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const PASSWORD_ROUNDS = 1000;
export const RATE_LOGIN_PER_EMAIL = 10;
export const RATE_LOGIN_GLOBAL = 300;
export const BAD_LOGIN_MESSAGE = 'The email or password is incorrect.';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'admin';
  row: UserRow;
}

export function newToken(ctx: Ctx): string {
  return `${ctx.svc.uuid()}${ctx.svc.uuid()}`.replace(/-/g, '');
}

/** Role always comes from ADMIN_EMAIL, never from client input or the stored row. */
export function toAuthUser(ctx: Ctx, row: UserRow): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: isAdminEmail(ctx, row.email) ? 'admin' : 'student',
    row,
  };
}

interface Window {
  count: number;
  resetAt: number;
}

/** Fixed one-hour windows in CacheService. Returns false when the limit is reached. */
export function takeRate(ctx: Ctx, key: string, limit: number): boolean {
  const nowMs = ctx.now.getTime();
  const raw = ctx.svc.cache.get(key);
  let w: Window = raw ? (JSON.parse(raw) as Window) : { count: 0, resetAt: nowMs + 3600000 };
  if (w.resetAt <= nowMs) w = { count: 0, resetAt: nowMs + 3600000 };
  if (w.count >= limit) return false;
  w.count++;
  const ttl = Math.max(1, Math.ceil((w.resetAt - nowMs) / 1000));
  ctx.svc.cache.put(key, JSON.stringify(w), ttl);
  return true;
}

export function loginJob(ctx: Ctx, user: UserRow, version: string): EmailJob {
  return {
    type: 'login',
    refId: user.id,
    version,
    userId: user.id,
    to: user.email,
    build: () => {
      // The token is created at send time, so a queued link is still fresh when it goes out.
      const token = newToken(ctx);
      ctx.db.insert('LoginTokens', {
        token_hash: ctx.svc.sha256Hex(token),
        user_id: user.id,
        expires_at: new Date(ctx.now.getTime() + LOGIN_TOKEN_MINUTES * 60000).toISOString(),
        used_at: '',
      });
      return loginEmail(
        user.email,
        user.name,
        appUrl(ctx, `/auth?token=${encodeURIComponent(token)}`),
      );
    },
  };
}

/** Always resolves to the same message so it never reveals whether an email exists. */
export function requestLoginLink(ctx: Ctx, email: string): { message: string } {
  const normalized = email.trim().toLowerCase();
  const emailKey = `rl:email:${ctx.svc.sha256Hex(normalized).slice(0, 32)}`;
  const allowed =
    takeRate(ctx, 'rl:global', RATE_GLOBAL) && takeRate(ctx, emailKey, RATE_PER_EMAIL);
  if (allowed) {
    const user = ctx.db.findOne('Users', (u) => u.email.toLowerCase() === normalized);
    if (user) sendEmail(ctx, loginJob(ctx, user, ctx.svc.uuid()));
  }
  return { message: LOGIN_LINK_MESSAGE };
}

/** Stored as "v1$rounds$salt$hash" so the number of rounds can change later. */
export function hashPassword(
  ctx: Ctx,
  password: string,
  salt = ctx.svc.uuid().replace(/-/g, ''),
  rounds = PASSWORD_ROUNDS,
): string {
  let hash = ctx.svc.sha256Hex(`${salt}:${password}`);
  for (let i = 1; i < rounds; i++) hash = ctx.svc.sha256Hex(hash + salt);
  return ['v1', rounds, salt, hash].join('$');
}

export function verifyPassword(ctx: Ctx, password: string, stored: string): boolean {
  const [version, rounds, salt, hash] = (stored || '').split('$');
  const n = Number(rounds);
  if (version !== 'v1' || !salt || !hash || !Number.isInteger(n) || n < 1 || n > 100000) {
    return false;
  }
  const candidate = hashPassword(ctx, password, salt, n).split('$')[3];
  let diff = candidate.length ^ hash.length;
  for (let i = 0; i < Math.min(candidate.length, hash.length); i++) {
    diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * An account without a password that nobody has used yet: no login so far and no essay the
 * student wrote. Whoever signs up with that email may choose its password. This lets students
 * whose login email never arrived (and students the teacher added) finish signing up.
 */
export function isUnclaimed(ctx: Ctx, user: UserRow): boolean {
  if (user.password_hash || isAdminEmail(ctx, user.email)) return false;
  if (ctx.db.findOne('Sessions', (s) => s.user_id === user.id)) return false;
  if (ctx.db.findOne('LoginTokens', (t) => t.user_id === user.id && !!t.used_at)) return false;
  return !ctx.db.findOne(
    'Essays',
    (e) => e.student_id === user.id && e.source !== 'admin' && !e.source.startsWith('portal:'),
  );
}

export function createSession(
  ctx: Ctx,
  userRow: UserRow,
): { sessionToken: string; user: AuthUser } {
  const nowMs = ctx.now.getTime();
  // Housekeeping: drop expired tokens and sessions.
  ctx.db.remove('LoginTokens', (t) => Date.parse(t.expires_at) < nowMs - 86400000);
  ctx.db.remove('Sessions', (s) => Date.parse(s.expires_at) < nowMs);
  const sessionToken = newToken(ctx);
  ctx.db.insert('Sessions', {
    token_hash: ctx.svc.sha256Hex(sessionToken),
    user_id: userRow.id,
    expires_at: new Date(nowMs + SESSION_DAYS * 86400000).toISOString(),
    created_at: ctx.nowIso,
  });
  return { sessionToken, user: toAuthUser(ctx, userRow) };
}

export function passwordLogin(
  ctx: Ctx,
  email: string,
  password: string,
): { sessionToken: string; user: AuthUser } {
  const normalized = email.trim().toLowerCase();
  const emailKey = `rl:pw:${ctx.svc.sha256Hex(normalized).slice(0, 32)}`;
  if (
    !takeRate(ctx, 'rl:pw:global', RATE_LOGIN_GLOBAL) ||
    !takeRate(ctx, emailKey, RATE_LOGIN_PER_EMAIL)
  ) {
    throw new ApiError('limit', 'Too many login attempts. Please wait an hour and try again.');
  }
  const user = ctx.db.findOne('Users', (u) => u.email.toLowerCase() === normalized);
  if (!user || !user.password_hash || !verifyPassword(ctx, password, user.password_hash)) {
    throw new ApiError('unauthenticated', BAD_LOGIN_MESSAGE);
  }
  return createSession(ctx, user);
}

export function exchangeLoginToken(
  ctx: Ctx,
  token: string,
): { sessionToken: string; user: AuthUser } {
  const hash = ctx.svc.sha256Hex(token);
  const row = ctx.db.findOne('LoginTokens', (t) => t.token_hash === hash);
  if (!row || row.used_at || Date.parse(row.expires_at) <= ctx.now.getTime()) {
    throw new ApiError(
      'unauthenticated',
      'This login link is invalid or has expired. Please request a new one.',
    );
  }
  const userRow = ctx.db.byId('Users', row.user_id);
  if (!userRow) throw new ApiError('unauthenticated', 'This account no longer exists.');
  ctx.db.update('LoginTokens', (t) => t.token_hash === hash, { used_at: ctx.nowIso });
  return createSession(ctx, userRow);
}

export function userFromSession(ctx: Ctx, sessionToken: string | undefined): AuthUser | null {
  if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.length > 128) return null;
  const hash = ctx.svc.sha256Hex(sessionToken);
  const session = ctx.db.findOne('Sessions', (s) => s.token_hash === hash);
  if (!session || Date.parse(session.expires_at) <= ctx.now.getTime()) return null;
  const row = ctx.db.byId('Users', session.user_id);
  return row ? toAuthUser(ctx, row) : null;
}

export function logout(ctx: Ctx, sessionToken: string): void {
  const hash = ctx.svc.sha256Hex(sessionToken);
  ctx.db.remove('Sessions', (s) => s.token_hash === hash);
}
