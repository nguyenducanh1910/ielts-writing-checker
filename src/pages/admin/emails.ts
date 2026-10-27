// Email status: daily quota, queued emails and failures with retry.
import { api } from '../../api';
import { h, replace } from '../../dom';
import {
  async,
  badge,
  busy,
  empty,
  errorBox,
  link,
  notice,
  page,
  table,
  toast,
} from '../../ui/components';
import { formatDateTime } from '../../ui/format';

interface EmailRow {
  id: string;
  type: string;
  status: string;
  error: string;
  createdAt: string;
  essayId: string | null;
  studentName: string;
}

interface EmailStatus {
  remainingQuota: number;
  queued: EmailRow[];
  failed: EmailRow[];
  recent: EmailRow[];
}

const TYPE_LABELS: Record<string, string> = {
  login: 'Login link',
  result: 'Result',
  result_resent: 'Re-sent result',
  rewrite_reminder: 'Rewrite reminder',
  rewrite_overdue: 'Rewrite overdue',
  assignment_notice: 'New assignment',
};

export function emailsPage(): Node {
  return page(
    'Email',
    async(
      () => api<EmailStatus>('admin.emails'),
      (data, reload) => {
        const sendQueued = h(
          'button',
          { type: 'button', class: 'btn btn-primary' },
          'Send queued emails now',
        );
        const out = h('div', { 'aria-live': 'polite' });
        sendQueued.addEventListener('click', () =>
          busy(sendQueued, 'Sending…', async () => {
            try {
              const res = await api<{ sent: number; failed: number; remaining: number }>(
                'admin.emails.sendQueued',
              );
              toast(`${res.sent} sent, ${res.failed} failed, ${res.remaining} still queued.`);
              reload();
            } catch (err) {
              replace(out, errorBox(err));
            }
          }),
        );
        const row = (e: EmailRow, retry: boolean) => {
          const btn = retry
            ? h('button', { type: 'button', class: 'btn btn-small' }, 'Resend email')
            : null;
          btn?.addEventListener('click', () =>
            busy(btn, 'Sending…', async () => {
              try {
                const res = await api<{ outcomes: Record<string, number> }>('admin.resendEmail', {
                  eventId: e.id,
                });
                toast(
                  `Result: ${
                    Object.entries(res.outcomes)
                      .map(([k, v]) => `${v} ${k}`)
                      .join(', ') || 'nothing to send'
                  }.`,
                );
                reload();
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Failed', 'error');
              }
            }),
          );
          return [
            TYPE_LABELS[e.type] ?? e.type,
            e.studentName,
            e.essayId ? link(`/admin/score/${e.essayId}`, 'Essay') : '–',
            [
              badge(
                e.status,
                e.status === 'sent' ? 'success' : e.status === 'failed' ? 'danger' : 'warning',
              ),
              e.error ? h('div', { class: 'hint' }, e.error) : null,
            ],
            formatDateTime(e.createdAt),
            btn,
          ];
        };
        return [
          h(
            'div',
            { class: 'stat-grid' },
            h(
              'div',
              { class: 'stat' },
              'Sends left today',
              h('strong', null, String(data.remainingQuota)),
            ),
            h('div', { class: 'stat' }, 'Queued', h('strong', null, String(data.queued.length))),
            h('div', { class: 'stat' }, 'Failed', h('strong', null, String(data.failed.length))),
          ),
          data.queued.length
            ? notice(
                'warning',
                `${data.queued.length} email(s) queued until tomorrow. They are sent automatically every hour when Gmail quota returns (login links first).`,
              )
            : null,
          h('h2', null, 'Queued'),
          data.queued.length
            ? [
                table(
                  ['Type', 'Student', 'Essay', 'Status', 'Queued at', ''],
                  data.queued.map((e) => row(e, false)),
                ),
                sendQueued,
                out,
              ]
            : empty('Nothing is queued.'),
          h('h2', null, 'Failed'),
          data.failed.length
            ? table(
                ['Type', 'Student', 'Essay', 'Status', 'When', ''],
                data.failed.map((e) => row(e, true)),
              )
            : empty('No failed emails.'),
          h('h2', null, 'Recent'),
          data.recent.length
            ? table(
                ['Type', 'Student', 'Essay', 'Status', 'When', ''],
                data.recent.map((e) => row(e, false)),
              )
            : empty('No emails yet.'),
        ];
      },
      'Loading email status…',
    ),
  );
}
