// Client for the class management system (Google Classroom checker web app).
// It checks the same session token with the Writing back end, so the browser sends no role or email.
import { ApiClientError } from './api';
import { CLASSROOM_API_URL } from './config';
import { clearSession, getToken } from './session';

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

let onExpired: () => void = () => undefined;
export function setClassroomExpiredHandler(fn: () => void) {
  onExpired = fn;
}

export const classroomEnabled = () => !!CLASSROOM_API_URL;

export async function classroom<T = unknown>(action: string, payload: unknown = {}): Promise<T> {
  if (!CLASSROOM_API_URL) {
    throw new ApiClientError('config', 'Chưa kết nối hệ thống lớp học (VITE_CLASSROOM_API_URL).');
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(CLASSROOM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, payload }),
      redirect: 'follow',
      credentials: 'omit',
    });
  } catch {
    throw new ApiClientError(
      'network',
      'Không kết nối được hệ thống lớp học. Kiểm tra mạng rồi thử lại.',
    );
  }
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiClientError(
      'network',
      `Hệ thống lớp học trả lời bất thường (${res.status}). Kiểm tra bản triển khai Web app.`,
    );
  }
  if (!body.ok) {
    if (body.error.code === 'unauthenticated' && token) {
      clearSession();
      onExpired();
    }
    throw new ApiClientError(body.error.code, body.error.message);
  }
  return body.data;
}
