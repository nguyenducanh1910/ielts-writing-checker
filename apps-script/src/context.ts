// Per-request context: services, the table layer and small shared helpers.
import { DEFAULT_SETTINGS } from '../../shared/constants';
import { Db } from './db';
import type { Row } from './schema';
import type { Services } from './services';

export class ApiError extends Error {
  constructor(
    public readonly code:
      | 'bad_request'
      | 'unauthenticated'
      | 'forbidden'
      | 'not_found'
      | 'conflict'
      | 'limit'
      | 'server_error',
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface Ctx {
  svc: Services;
  db: Db;
  nowIso: string;
  now: Date;
}

export function createCtx(svc: Services): Ctx {
  const now = svc.now();
  return { svc, db: new Db(svc.spreadsheet), now, nowIso: now.toISOString() };
}

export function getSetting(ctx: Ctx, key: string): string {
  const row = ctx.db.findOne('Settings', (r) => r.key === key);
  return row && row.value !== '' ? row.value : (DEFAULT_SETTINGS[key] ?? '');
}

export function getNumberSetting(ctx: Ctx, key: string): number {
  const n = Number(getSetting(ctx, key));
  return Number.isFinite(n) ? n : Number(DEFAULT_SETTINGS[key] ?? 0);
}

export function adminTimezone(ctx: Ctx): string {
  return getSetting(ctx, 'admin_timezone') || 'Asia/Ho_Chi_Minh';
}

export function adminEmails(ctx: Ctx): string[] {
  return (ctx.svc.props.ADMIN_EMAIL ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(ctx: Ctx, email: string): boolean {
  return adminEmails(ctx).includes(email.trim().toLowerCase());
}

export function appUrl(ctx: Ctx, hashPath: string): string {
  const base = (ctx.svc.props.APP_URL ?? '').replace(/#.*$/, '');
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  return `${withSlash}#${hashPath}`;
}

export function num(value: string): number | null {
  if (value === '' || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function bool(value: string): boolean {
  return value === 'true' || value === 'TRUE';
}

export function parseJson<T>(value: string, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export type UserRow = Row<'Users'>;
export type EssayRow = Row<'Essays'>;
