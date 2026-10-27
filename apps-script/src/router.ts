// JSON API router behind doPost. Request: {action, token?, payload?}.
// Response: {ok: true, data} or {ok: false, error: {code, message, fields?}}.
import { type AuthUser, userFromSession } from './auth';
import { authorize } from './authorize';
import { ApiError, createCtx, type Ctx } from './context';
import type { Services } from './services';
import { isObject } from './validate';

export interface ActionDef {
  /** Read-only actions skip the script lock. Everything else is serialized. */
  write: boolean;
  handler: (ctx: Ctx, payload: unknown, user: AuthUser | null, token: string) => unknown;
}

export type ApiResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; fields?: Record<string, string> } };

const registry = new Map<string, ActionDef>();

export function registerActions(defs: Record<string, ActionDef>): void {
  for (const [name, def] of Object.entries(defs)) registry.set(name, def);
}

export function actionNames(): string[] {
  return [...registry.keys()];
}

const MAX_BODY = 9 * 1024 * 1024;

export function handleRequest(svc: Services, rawBody: string): ApiResponse {
  let locked = false;
  try {
    if (typeof rawBody !== 'string' || rawBody.length === 0) {
      throw new ApiError('bad_request', 'Empty request');
    }
    if (rawBody.length > MAX_BODY) throw new ApiError('bad_request', 'Request is too large');
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new ApiError('bad_request', 'Request body must be JSON');
    }
    if (!isObject(body) || typeof body.action !== 'string') {
      throw new ApiError('bad_request', 'Missing action');
    }
    const action = body.action;
    const def = registry.get(action);
    if (!def) throw new ApiError('bad_request', `Unknown action "${action.slice(0, 50)}"`);
    const token = typeof body.token === 'string' ? body.token : '';

    if (def.write) {
      try {
        svc.lock.waitLock(30000);
        locked = true;
      } catch {
        throw new ApiError('server_error', 'The server is busy. Please try again in a moment.');
      }
    }
    const ctx = createCtx(svc);
    const user = userFromSession(ctx, token);
    authorize(action, user, undefined);
    const data = def.handler(ctx, body.payload ?? {}, user, token);
    return { ok: true, data: data ?? null };
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.fields ? { fields: err.fields } : {}),
        },
      };
    }
    svc.log(`Unhandled error: ${(err as Error)?.stack ?? String(err)}`);
    return {
      ok: false,
      error: { code: 'server_error', message: 'Something went wrong. Please try again.' },
    };
  } finally {
    if (locked) svc.lock.releaseLock();
  }
}
