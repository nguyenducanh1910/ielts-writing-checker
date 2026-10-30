// What a student did with a result: email sent / opened, seen on the website, practice done.
import { badge } from '../../ui/components';
import { formatDateTime } from '../../ui/format';

export interface ResultActivity {
  email: 'opened' | 'sent' | 'queued' | 'failed' | 'no_email' | 'none';
  emailSentAt: string | null;
  emailOpenedAt: string | null;
  viewedAt: string | null;
  practice: 'not_required' | 'waiting' | 'done';
  practiceDoneAt: string | null;
}

export const ACTIVITY_HEADERS = ['Email', 'Seen on site', 'Practice'];

const EMAIL: Record<ResultActivity['email'], [string, string]> = {
  opened: ['Opened', 'success'],
  sent: ['Sent', 'info'],
  queued: ['Queued', 'warning'],
  failed: ['Failed', 'danger'],
  no_email: ['No email', ''],
  none: ['–', ''],
};

/** Three table cells for a scored essay; dashes when there is nothing to show. */
export function activityCells(a: ResultActivity | null | undefined): Array<string | HTMLElement> {
  if (!a) return ['–', '–', '–'];
  let email: string | HTMLElement = '–';
  if (a.email !== 'none') {
    const [label, kind] = EMAIL[a.email];
    email = badge(label, kind);
    const when = a.emailOpenedAt
      ? `Opened ${formatDateTime(a.emailOpenedAt)}`
      : a.emailSentAt
        ? `Sent ${formatDateTime(a.emailSentAt)}`
        : '';
    if (when) email.title = when;
  }
  return [
    email,
    // Results sent before tracking existed have no email record: nothing is known about them.
    a.viewedAt ? formatDateTime(a.viewedAt) : a.email === 'none' ? '–' : 'Not yet',
    a.practice === 'done'
      ? badge('Done', 'success')
      : a.practice === 'waiting'
        ? badge('Waiting', 'warning')
        : 'Not needed',
  ];
}
