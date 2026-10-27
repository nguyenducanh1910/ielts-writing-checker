// "My essays" list.
import { api } from '../../api';
import { h } from '../../dom';
import type { EssaySummary } from '../../types';
import { async, badge, empty, link, page, table } from '../../ui/components';
import {
  formatBand,
  formatDateTime,
  modeLabel,
  STUDENT_STATUS_LABELS,
  taskLabel,
} from '../../ui/format';

export function statusBadge(status: string): HTMLElement {
  const kind =
    status === 'overdue'
      ? 'danger'
      : status === 'rewrite_due'
        ? 'warning'
        : status === 'scored'
          ? 'success'
          : '';
  return badge(STUDENT_STATUS_LABELS[status] ?? status, kind);
}

export function essaysPage(): Node {
  return page(
    'My essays',
    h('p', null, link('/new', 'Start a new essay', { class: 'btn btn-primary' })),
    async(
      () => api<EssaySummary[]>('essays.listMine'),
      (essays) => {
        if (essays.length === 0) {
          return empty(
            'You have not written any essays yet.',
            link('/new', 'Write your first essay', { class: 'btn' }),
          );
        }
        return table(
          ['Essay', 'Task', 'Mode', 'Status', 'Band', 'Date'],
          essays.map((e) => [
            link(e.status === 'draft' ? `/write/${e.id}` : `/essays/${e.id}`, [
              e.topic,
              e.parentEssayId ? ' (rewrite)' : '',
              e.assignmentTitle ? ` – ${e.assignmentTitle}` : '',
            ]),
            taskLabel(e.taskType),
            [modeLabel(e.mode), e.overTime ? [' ', badge('Over time', 'warning')] : null],
            statusBadge(e.studentStatus),
            formatBand(e.overall),
            formatDateTime(e.submittedAt ?? e.savedAt),
          ]),
          'Your essays, newest first',
        );
      },
      'Loading your essays…',
    ),
  );
}
