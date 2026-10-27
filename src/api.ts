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

export async function api<T = unknown>(action: string, payload: unknown = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiClientError(
      'config',
      'The app is not connected to its server yet. Set VITE_API_URL in .env.production.',
    );
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, payload }),
      redirect: 'follow',
      credentials: 'omit',
    });
  } catch {
    throw new ApiClientError(
      'network',
      'Could not reach the server. Check your connection and try again.',
    );
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
