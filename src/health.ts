// Keeps the teacher informed when something is broken, instead of an endless spinner:
// - browser errors are sent to the class system's log ("Nhật ký"), which the daily health
//   check counts and emails about;
// - admins see a red banner when a web app deployment runs older code than this site expects.
import { ApiClientError } from './api';
import { classroom, classroomEnabled } from './classroomApi';
import { type Child, h, replace } from './dom';
import { getConfig } from './state';
import { CLASSROOM_VERSION, EXPECTED_BACKEND_VERSION, versionMismatch } from './versions';

const MAX_REPORTS = 5;
let reported = 0;

/** Send one browser error to the class system's log (at most 5 per page load). */
export function reportClientError(err: unknown, where: string): void {
  if (!classroomEnabled() || reported >= MAX_REPORTS) return;
  // Server answers (wrong password, network down…) are already shown on the page.
  if (err instanceof ApiClientError) return;
  reported++;
  const e = err instanceof Error ? err : new Error(String(err));
  const detail = {
    message: e.message.slice(0, 300),
    stack: (e.stack ?? '').slice(0, 1500),
    where: where.slice(0, 60),
    path: location.hash.slice(0, 200),
    expected: EXPECTED_BACKEND_VERSION,
  };
  classroom('client.error', detail).catch(() => undefined);
}

export function installErrorReporting(): void {
  window.addEventListener('error', (e) => reportClientError(e.error ?? e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => reportClientError(e.reason, 'promise'));
}

export interface VersionState {
  writing: string | null;
  classroom: string | null;
}

let checked: Promise<VersionState> | null = null;

/** Versions the two web apps report (null: could not ask). Asked once per page load. */
export function serverVersions(): Promise<VersionState> {
  if (!checked) {
    checked = Promise.all([
      getConfig()
        .then((c) => c.serverVersion ?? 'unknown')
        .catch(() => null),
      classroomEnabled()
        ? classroom<{ version?: string }>('system.version')
            .then((d) => d.version ?? 'unknown')
            .catch(() => null)
        : Promise.resolve(null),
    ]).then(([writing, cls]) => ({ writing, classroom: cls }));
  }
  return checked;
}

const HOW_TO =
  'Mở dự án Apps Script > Triển khai > Quản lý tùy chọn triển khai > biểu tượng bút chì > Phiên bản: "Phiên bản mới" > Triển khai.';

/** Red banner for the teacher when a deployment is behind (empty when all is well). */
export function versionAlert(v: VersionState): Child {
  const problems: Child[] = [];
  if (v.writing && versionMismatch(EXPECTED_BACKEND_VERSION, v.writing)) {
    problems.push(
      h(
        'li',
        null,
        h('strong', null, 'Web app Writing (dự án "IELTS Writing Checker") đang chạy bản cũ'),
        ` (máy chủ: ${v.writing}, bản mới nhất: ${EXPECTED_BACKEND_VERSION}). Một số trang có thể không hiển thị được.`,
      ),
    );
  }
  if (v.classroom && versionMismatch(CLASSROOM_VERSION, v.classroom)) {
    problems.push(
      h(
        'li',
        null,
        h('strong', null, 'Web app Lớp học (dự án gắn với Google Sheet) đang chạy bản khác'),
        ` (máy chủ: ${v.classroom}, trang web cần: ${CLASSROOM_VERSION}).`,
      ),
    );
  }
  if (!problems.length) return null;
  return h(
    'div',
    { class: 'notice notice-error version-alert', role: 'alert' },
    h('p', null, h('strong', null, 'Cần triển khai lại máy chủ')),
    h('ul', null, ...problems),
    h('p', null, HOW_TO),
  );
}

/** "Web d77f2456f2 · Writing d77f2456f2 · Lớp học 2026-11-04.1" for the footer (admins). */
export function versionLine(v: VersionState): string {
  return [
    `Web ${EXPECTED_BACKEND_VERSION}`,
    `Writing ${v.writing ?? '?'}`,
    classroomEnabled() ? `Lớp học ${v.classroom ?? '?'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Fill the banner slot and footer line for an admin (no-op for students and guests). */
export function showVersionStatus(isAdmin: boolean, slot: HTMLElement, line: HTMLElement): void {
  if (!isAdmin) {
    replace(slot);
    replace(line);
    return;
  }
  serverVersions()
    .then((v) => {
      replace(slot, versionAlert(v));
      replace(line, versionLine(v));
    })
    .catch(() => undefined);
}
