// Admin queue: pending essays and submitted rewrites, oldest first.
import { TASK_TYPE_LABELS } from '../../../shared/constants';
import { api } from '../../api';
import { type Child, h, replace } from '../../dom';
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
import { ACTIVITY_HEADERS, activityCells } from './activity';
import { batchScoring, canBatch } from './batch';
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
    promptKey: q.get('promptKey') ?? '',
  };
  const payload = queueFilters(q);
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
            { value: 'all', label: 'All essays (waiting and scored)' },
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
        const promptSel = selectEl(
          'promptKey',
          data.prompts.map((p) => ({ value: p.key, label: `${p.label} (${p.count} essays)` })),
          filters.promptKey,
          'All prompts',
        );
        taskSel.addEventListener('change', () => apply('taskType', taskSel.value));
        promptSel.addEventListener('change', () => apply('promptKey', promptSel.value));
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
        const batch = batchScoring(data.items, reload);
        const batchable = data.items.some((item) => canBatch(item));
        const scoredView = filters.status === 'scored';
        const rows = data.items.map((item) => {
          const cells = queueRow(item, reload, filterQuery(q, NEXT_KEYS));
          // Scored essays: did the student get, open and act on the result?
          if (scoredView) cells.splice(5, 0, ...activityCells(item.activity));
          return batchable ? [batch.checkbox(item), ...cells] : cells;
        });
        return [
          ...banners,
          h(
            'div',
            { class: 'filters' },
            field({ label: 'Task type', control: taskSel }),
            field({ label: 'Student', control: studentSel }),
            field({ label: 'Status', control: statusSel }),
            field({ label: 'Assignment', control: assignmentSel }),
            h('div', { class: 'filter-wide' }, field({ label: 'Prompt', control: promptSel })),
          ),
          rows.length
            ? h(
                'p',
                null,
                link(
                  `/admin/read${filterQuery(q)}`,
                  `Read all ${rows.length} essay${rows.length === 1 ? '' : 's'}`,
                  { class: 'btn' },
                ),
                ' ',
                h('span', { class: 'hint' }, 'One after another on one page, in this order.'),
              )
            : null,
          batchable ? batch.panel : null,
          aiQueueButton(data.items, reload),
          rows.length
            ? table(
                [
                  ...(batchable ? ['Batch'] : []),
                  'Student',
                  'Essay',
                  'Mode',
                  'Submitted',
                  'Status',
                  ...(scoredView ? ACTIVITY_HEADERS : []),
                  '',
                ],
                rows,
                `${rows.length} essay(s)${filters.status === 'scored' ? ', newest first' : ', oldest first'}`,
              )
            : empty(
                filters.status === 'scored'
                  ? 'No scored essays match these filters.'
                  : filters.status === 'all'
                    ? 'No essays match these filters.'
                    : 'Nothing is waiting to be scored. 🎉',
              ),
        ];
      },
      'Loading the queue…',
    ),
  );
}

const AI_LABELS: Record<string, [string, string]> = {
  queued: ['Gemini: chờ chấm', 'info'],
  running: ['Gemini: đang chấm', 'info'],
  done: ['Gemini: đã đối chiếu', 'success'],
  failed: ['Gemini: lỗi', 'danger'],
};

function aiBadge(item: QueueItem): Child {
  if (!item.ai || item.queueStatus === 'scored') return null;
  const [label, kind] = AI_LABELS[item.ai.status] ?? [item.ai.status, ''];
  const b = badge(label, kind);
  if (item.ai.error) b.title = item.ai.error;
  return [' ', b];
}

/** "Gemini chấm & đối chiếu": every waiting essay with a pasted Claude draft and no AI result yet. */
function aiQueueButton(items: QueueItem[], reload: () => void): HTMLElement | null {
  const ready = items.filter(
    (i) => i.queueStatus === 'claude_pasted' && (!i.ai || i.ai.status === 'failed'),
  );
  const busyNow = items.filter(
    (i) => i.ai && (i.ai.status === 'queued' || i.ai.status === 'running'),
  );
  if (!ready.length && !busyNow.length) return null;
  const status = h('span', { class: 'hint', 'aria-live': 'polite' });
  const btn = h(
    'button',
    { type: 'button', class: 'btn btn-primary', disabled: !ready.length },
    `Gemini chấm & đối chiếu ${ready.length} bài đã dán Claude`,
  );
  btn.addEventListener('click', () =>
    busy(btn, 'Đang xếp hàng…', async () => {
      try {
        const r = await api<{ queued: number }>('admin.ai.queue', {
          essayIds: ready.slice(0, 50).map((i) => i.id),
        });
        toast(`Đã xếp ${r.queued} bài. Hệ thống chấm nền, khoảng 1–2 phút mỗi bài.`);
        reload();
      } catch (err) {
        replace(status, errorBox(err));
      }
    }),
  );
  const refresh = h('button', { type: 'button', class: 'btn' }, 'Làm mới');
  refresh.addEventListener('click', reload);
  return h(
    'p',
    { class: 'actions' },
    btn,
    busyNow.length ? [' ', refresh, ` ${busyNow.length} bài đang chờ/đang chấm.`] : null,
    ' ',
    link('/admin/ai', 'Cài đặt'),
    status,
  );
}

const FILTER_KEYS = ['taskType', 'studentId', 'status', 'assignmentId', 'promptKey'];

/** The queue filters in a URL query, as an admin.queue payload (empty values left out). */
export function queueFilters(q: URLSearchParams, keys = FILTER_KEYS): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, q.get(k) ?? '']).filter(([, v]) => v));
}

/** "?taskType=…&…" for the given filters, or '' when there are none. */
export function filterQuery(q: URLSearchParams, keys = FILTER_KEYS): string {
  const next = new URLSearchParams(queueFilters(q, keys));
  return next.toString() ? `?${next}` : '';
}

/** Filters that pick which essays come next after scoring (the status is always "waiting"). */
export const NEXT_KEYS = ['taskType', 'studentId', 'assignmentId', 'promptKey'];

function queueRow(item: QueueItem, reload: () => void, next: string): Child[] {
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
    [
      badge(
        QUEUE_STATUS_LABELS[item.queueStatus] ??
          (item.queueStatus === 'scored'
            ? `Scored ${formatDateTime(item.scoredAt)}`
            : item.queueStatus),
        STATUS_KIND[item.queueStatus],
      ),
      aiBadge(item),
    ],
    [
      link(
        `/admin/score/${item.id}${next}`,
        item.queueStatus === 'scored' ? 'Edit score' : 'Score',
        {
          class: 'btn btn-small btn-primary',
        },
      ),
      ' ',
      retry,
      status,
    ],
  ];
}
