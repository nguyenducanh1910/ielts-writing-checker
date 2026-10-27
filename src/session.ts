// Session token and the signed-in user, kept in localStorage.
// The token travels in the request body (no cookies), so CSRF does not apply.

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'admin';
  classId: string;
  targetBand: number | null;
  examDate: string;
  timezone: string;
  hasPassword?: boolean;
}

const TOKEN_KEY = 'ielts.session';
const USER_KEY = 'ielts.user';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode); the session lasts for this page only.
  }
}

let memoryToken: string | null = null;
let memoryUser: SessionUser | null = null;

export function getToken(): string | null {
  return memoryToken ?? read(TOKEN_KEY);
}

export function getUser(): SessionUser | null {
  if (memoryUser) return memoryUser;
  const raw = read(USER_KEY);
  if (!raw) return null;
  try {
    memoryUser = JSON.parse(raw) as SessionUser;
    return memoryUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: SessionUser) {
  memoryToken = token;
  memoryUser = user;
  write(TOKEN_KEY, token);
  write(USER_KEY, JSON.stringify(user));
}

export function setUser(user: SessionUser) {
  memoryUser = user;
  write(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  memoryToken = null;
  memoryUser = null;
  write(TOKEN_KEY, null);
  write(USER_KEY, null);
}
