// Dashboard numbers are cached per student for 10 minutes in CacheService.
// Clearing works by rotating a per-student version stamp that is part of
// every cache key, so all filter combinations are invalidated at once.
import type { Ctx } from './context';

const TTL_SECONDS = 600;
const VERSION_TTL_SECONDS = 21600;

function versionKey(scope: string) {
  return `dashver:${scope}`;
}

function currentVersion(ctx: Ctx, scope: string): string {
  const key = versionKey(scope);
  let v = ctx.svc.cache.get(key);
  if (!v) {
    v = ctx.svc.uuid().slice(0, 8);
    ctx.svc.cache.put(key, v, VERSION_TTL_SECONDS);
  }
  return v;
}

export function cached<T>(ctx: Ctx, scope: string, variant: string, compute: () => T): T {
  const key = `dash:${scope}:${currentVersion(ctx, scope)}:${variant}`.slice(0, 250);
  const hit = ctx.svc.cache.get(key);
  if (hit) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      // fall through and recompute
    }
  }
  const value = compute();
  const text = JSON.stringify(value);
  if (text.length < 90000) ctx.svc.cache.put(key, text, TTL_SECONDS);
  return value;
}

export function clearDashboardCache(ctx: Ctx, studentId: string): void {
  ctx.svc.cache.put(versionKey(studentId), ctx.svc.uuid().slice(0, 8), VERSION_TTL_SECONDS);
  // Admin-wide numbers (source calibration, overviews) depend on every score.
  ctx.svc.cache.put(versionKey('admin'), ctx.svc.uuid().slice(0, 8), VERSION_TTL_SECONDS);
}
