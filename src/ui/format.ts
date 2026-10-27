// Display helpers. Times are stored in UTC and shown in the browser's time zone.
import { formatBand } from '../../shared/band';
import { MODE_LABELS, type Mode, TASK_TYPE_LABELS, type TaskType } from '../../shared/constants';

export { formatBand };

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "2 days 4 hours left" / "3 hours overdue". */
export function countdown(targetIso: string, now = Date.now()): string {
  const diff = Date.parse(targetIso) - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  let text: string;
  if (days > 0) text = `${days} day${days === 1 ? '' : 's'} ${hours} h`;
  else if (hours > 0) text = `${hours} h ${minutes} min`;
  else text = `${minutes} min`;
  return diff >= 0 ? `${text} left` : `${text} overdue`;
}

/** mm:ss for the test timer. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function taskLabel(t: string): string {
  return TASK_TYPE_LABELS[t as TaskType] ?? t;
}

export function modeLabel(m: string): string {
  return MODE_LABELS[m as Mode] ?? m;
}

export const STUDENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending: 'Pending',
  scored: 'Scored',
  rewrite_due: 'Rewrite due',
  rewrite_submitted: 'Rewrite submitted',
  overdue: 'Overdue',
};

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  over_time: 'Over time',
  missed: 'Missed',
};

export const QUEUE_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  claude_pasted: 'Claude draft pasted',
  in_review: 'In review',
  drive_failed: 'Drive copy failed',
};

export function signed(n: number, digits = 1): string {
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : v;
}
