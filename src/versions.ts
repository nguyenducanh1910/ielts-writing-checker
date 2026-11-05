// Versions the site expects its two Apps Script web apps to run.
// - Writing back end: a hash of apps-script/src + shared, computed at build time (vite.config.ts).
// - Class system (Google Classroom checker, Code.gs kept outside this repo): CLASSROOM_VERSION
//   below must equal CLASSROOM_VERSION at the top of Code.gs. Bump both together.
declare const __EXPECTED_BACKEND_VERSION__: string | undefined;

export const EXPECTED_BACKEND_VERSION: string =
  typeof __EXPECTED_BACKEND_VERSION__ === 'string' ? __EXPECTED_BACKEND_VERSION__ : 'dev';

export const CLASSROOM_VERSION = '2026-11-05.2';

/** True when both sides are known and differ ("dev" builds never warn). */
export function versionMismatch(expected: string, actual: string | undefined): boolean {
  if (!expected || expected === 'dev' || actual === 'dev') return false;
  return actual !== expected;
}
