// Admin queue: pending essays and submitted rewrites, oldest first.
import { TASK_TYPE_LABELS } from '../../../shared/constants';
import { api } from '../../api';
import { h, replace } from '../../dom';
import type { RouteContext } from '../../router';
import { navigate } from '../../router';
import {
  async,
  badge,
  busy,
  empty,
  errorBox,
  field,
  link,
  notice,
  page,
  selectEl,
  table,
  toast,
} from '../../ui/components';
import { formatDateTime, modeLabel, QUEUE_STATUS_LABELS, taskLabel } from '../../ui/format';
import type { QueueItem, QueueResponse } from './types';

const STATUS_KIND: Record<string, string> = {
  new: 'info',
  claude_pasted: 'warning',
  in_review: 'warning',
  drive_failed: 'danger',
  scored: 'success',
};

export function queuePage(ctx: RouteContext): Node {
  const q = ctx.query;
  const filters = {
    taskType: q.get('taskType') ?? '',
    studentId: q.get('studentId') ?? '',
    status: q.get('status') ?? '',
    assignmentId: q.get('assignmentId') ?? '',
  };
  const payload = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  return page(
    'Scoring queue',
    h('p', null, link('/admin/essays/new', 'Add an essay', { class: 'btn btn-primary' })),
    async(
      () => api<QueueResponse>('admin.queue', payload),
      (data, reload) => {
        const apply = (key: string, value: string) => {
          const next = new URLSearchParams({ ...filters, [key]: value });
          for (const [k, v] of [...next.entries()]) if (!v) next.delete(k);
          navigate(`/admin${next.toString() ? `?${next}` : ''}`);
        };
        const taskSel = selectEl(
          'taskType',
          Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          filters.taskType,
          'All task types',
        );
        const studentSel = selectEl(
          'studentId',
          data.students.map((s) => ({ value: s.id, label: s.name })),
          filters.studentId,
          'All students',
        );
        const statusSel = selectEl(
          'status',
          [
            ...Object.entries(QUEUE_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            { value: 'scored', label: 'Scored (edit a score)' },
          ],
          filters.status,
          'All waiting',
        );
        const assignmentSel = selectEl(
          'assignmentId',
          data.assignments.map((a) => ({ value: a.id, label: a.title })),
          filters.assignmentId,
          'All essays',
        );
        taskSel.addEventListener('change', () => apply('taskType', taskSel.value));
        studentSel.addEventListener('change', () => apply('studentId', studentSel.value));
        statusSel.addEventListener('change', () => apply('status', statusSel.value));
        assignmentSel.addEventListener('change', () => apply('assignmentId', assignmentSel.value));

        const banners = [
          data.emailQueued
            ? notice(
                'warning',
                `${data.emailQueued} email(s) queued until the Gmail quota resets. `,
                link('/admin/emails', 'View email status'),
              )
            : null,
          data.emailFailed
            ? notice(
                'error',
                `${data.emailFailed} email(s) failed to send. `,
                link('/admin/emails', 'Resend'),
              )
            : null,
        ];
        const rows = data.items.map((item) => queueRow(item, reload));
        return [
          ...banners,
          h(
            'div',
            { class: 'filters' },
            field({ label: 'Task type', control: taskSel }),
            field({ label: 'Student', control: studentSel }),
            field({ label: 'Status', control: statusSel }),
            field({ label: 'Assignment', control: assignmentSel }),
          ),
          rows.length
            ? table(
                ['Student', 'Essay', 'Mode', 'Submitted', 'Status', ''],
                rows,
                `${rows.length} essay(s)${filters.status === 'scored' ? ', newest first' : ', oldest first'}`,
              )
            : empty(
                filters.status === 'scored'
                  ? 'No scored essays match these filters.'
                  : 'Nothing is waiting to be scored. 🎉',
              ),
        ];
      },
      'Loading the queue…',
    ),
  );
}

function queueRow(item: QueueItem, reload: () => void) {
  const retry =
    item.queueStatus === 'drive_failed'
      ? h('button', { type: 'button', class: 'btn btn-small' }, 'Retry Drive copy')
      : null;
  const status = h('span', { 'aria-live': 'polite' });
  retry?.addEventListener('click', () =>
    busy(retry, 'Saving to Drive…', async () => {
      try {
        const res = await api<{ driveStatus: string }>('admin.retryDrive', { essayId: item.id });
        toast(
          res.driveStatus === 'ok' ? 'Copied to Drive.' : 'Drive copy failed again.',
          res.driveStatus === 'ok' ? 'info' : 'error',
        );
        reload();
      } catch (err) {
        replace(status, errorBox(err));
      }
    }),
  );
  return [
    item.studentName,
    [
      h('strong', null, item.topic),
      h('br'),
      `${taskLabel(item.taskType)} · ${item.wordCount} words`,
      item.isRewrite ? [' ', badge('Rewrite', 'info')] : null,
      item.uploadedByAdmin ? [' ', badge('Uploaded by teacher')] : null,
      item.assignmentTitle ? [' ', badge(item.assignmentTitle)] : null,
    ],
    [
      modeLabel(item.mode),
      item.overTime ? [' ', badge('Over time', 'warning')] : null,
      item.pasteAttempts ? [' ', badge(`${item.pasteAttempts} paste attempt(s)`, 'warning')] : null,
    ],
    formatDateTime(item.submittedAt),
    badge(
      QUEUE_STATUS_LABELS[item.queueStatus] ??
        (item.queueStatus === 'scored'
          ? `Scored ${formatDateTime(item.scoredAt)}`
          : item.queueStatus),
      STATUS_KIND[item.queueStatus],
    ),
    [
      link(`/admin/score/${item.id}`, item.queueStatus === 'scored' ? 'Edit score' : 'Score', {
        class: 'btn btn-small btn-primary',
      }),
      ' ',
      retry,
      status,
    ],
  ];
}
