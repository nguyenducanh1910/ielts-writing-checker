// "Bài Writing của em" list.
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
      : status === 'rewrite_due' || status === 'practice'
        ? 'warning'
        : status === 'scored'
          ? 'success'
          : '';
  return badge(STUDENT_STATUS_LABELS[status] ?? status, kind);
}

export function essaysPage(): Node {
  return page(
    'Bài Writing của em',
    h('p', null, link('/new', 'Viết bài mới', { class: 'btn btn-primary' })),
    async(
      () => api<EssaySummary[]>('essays.listMine'),
      (essays) => {
        if (essays.length === 0) {
          return empty(
            'Em chưa viết bài nào.',
            link('/new', 'Viết bài đầu tiên', { class: 'btn' }),
          );
        }
        return table(
          ['Bài viết', 'Đề bài', 'Hình thức', 'Trạng thái', 'Band', 'Ngày'],
          essays.map((e) => [
            link(e.status === 'draft' ? `/write/${e.id}` : `/essays/${e.id}`, [
              e.topic,
              e.parentEssayId ? ' (viết lại)' : '',
              e.assignmentTitle ? ` – ${e.assignmentTitle}` : '',
            ]),
            taskLabel(e.taskType),
            [modeLabel(e.mode), e.overTime ? [' ', badge('Quá giờ', 'warning')] : null],
            statusBadge(e.studentStatus),
            formatBand(e.overall),
            formatDateTime(e.submittedAt ?? e.savedAt),
          ]),
          'Các bài của em, mới nhất trước',
        );
      },
      'Đang tải bài…',
    ),
  );
}
