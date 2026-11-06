// Client for the Apps Script JSON API. Requests are sent as text/plain so the
// browser does not send a CORS preflight.
import { API_URL } from './config';
import { clearSession, getToken } from './session';

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fields?: Record<string, string> } };

let onSessionExpired: () => void = () => undefined;

export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

/**
 * Actions that only read data. When the connection drops, these are sent again
 * automatically; actions that change data (submit, save…) are never repeated, so a
 * request that did reach the server is not applied twice. Must stay a subset of the
 * server's read-only actions (checked by tests/unit/apiRetry.test.ts).
 */
export const RETRYABLE_ACTIONS: ReadonlySet<string> = new Set([
  'admin.ai.settings',
  'admin.assignments.get',
  'admin.assignments.image',
  'admin.assignments.list',
  'admin.batchPrompt',
  'admin.calibration',
  'admin.claudeSetup',
  'admin.emails',
  'admin.essay',
  'admin.essayImage',
  'admin.lists',
  'admin.previewResult',
  'admin.queue',
  'admin.readEssays',
  'admin.studentOverview',
  'admin.students',
  'assignments.mine',
  'config.get',
  'dashboard.get',
  'essays.get',
  'essays.image',
  'essays.listMine',
  'me.get',
  'topics.history',
]);

/** Waits before each extra try of a read-only action (milliseconds). */
export const RETRY_DELAYS_MS = [1500, 4000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function api<T = unknown>(action: string, payload: unknown = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiClientError(
      'config',
      'The app is not connected to its server yet. Set VITE_API_URL in .env.production.',
    );
  }
  const token = getToken();
  const send = () =>
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, payload }),
      redirect: 'follow',
      credentials: 'omit',
    });
  const delays = RETRYABLE_ACTIONS.has(action) ? RETRY_DELAYS_MS : [];
  let res: Response | undefined;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await send();
    } catch {
      if (attempt >= delays.length) {
        throw new ApiClientError(
          'network',
          'Could not reach the server. Check your connection and try again.',
        );
      }
      await sleep(delays[attempt]);
    }
  }
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiClientError('network', `The server sent an unexpected response (${res.status}).`);
  }
  if (!body.ok) {
    if (body.error.code === 'unauthenticated' && token) {
      clearSession();
      onSessionExpired();
    }
    throw new ApiClientError(body.error.code, body.error.message, body.error.fields ?? {});
  }
  return body.data;
}
