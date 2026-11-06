// "Bài thầy giao": tests set by the teacher. The prompt is hidden until Start test.
import { api } from '../../api';
import { h, replace } from '../../dom';
import { navigate } from '../../router';
import type { EssayDetail } from '../../types';
import {
  async,
  badge,
  busy,
  confirmDialog,
  empty,
  errorBox,
  link,
  page,
} from '../../ui/components';
import { ASSIGNMENT_STATUS_LABELS, countdown, formatDateTime, taskLabel } from '../../ui/format';

export interface MyAssignment {
  id: string;
  title: string;
  taskType: string;
  timeLimitMinutes: number;
  opensAt: string;
  closesAt: string;
  createdAt: string;
  status: string;
  essayId: string | null;
  isOpen: boolean;
}

export function assignedPage(): Node {
  return page(
    'Bài thầy giao',
    h(
      'p',
      null,
      'Bài kiểm tra thầy/cô giao. Đề hiện ra khi em bấm “Bắt đầu làm bài” và đồng hồ chạy ngay. Em chỉ được làm một lần.',
    ),
    async(
      () => api<MyAssignment[]>('assignments.mine'),
      (list) => {
        if (list.length === 0) return empty('Thầy/cô chưa giao bài kiểm tra nào.');
        return h('div', { class: 'cards' }, ...list.map(assignmentCard));
      },
      'Đang tải bài được giao…',
    ),
  );
}

function assignmentCard(a: MyAssignment): HTMLElement {
  const status = h('div', { 'aria-live': 'polite' });
  let action: HTMLElement | null = null;
  if (a.status === 'not_started' && a.isOpen) {
    const btn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Bắt đầu làm bài');
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Bắt đầu “${a.title}”?`,
        message: `Đề sẽ hiện ra ngay và em có ${a.timeLimitMinutes} phút. Đồng hồ vẫn chạy nếu em rời trang. Không dán được chữ.`,
        confirmLabel: 'Bắt đầu làm bài',
      });
      if (!ok) return;
      await busy(btn, 'Đang bắt đầu…', async () => {
        try {
          const essay = await api<EssayDetail>('assignments.start', { id: a.id });
          navigate(`/write/${essay.id}`);
        } catch (err) {
          replace(status, errorBox(err));
        }
      });
    });
    action = btn;
  } else if (a.status === 'in_progress' && a.essayId) {
    action = link(`/write/${a.essayId}`, 'Làm tiếp', { class: 'btn btn-primary' });
  } else if ((a.status === 'submitted' || a.status === 'over_time') && a.essayId) {
    action = link(`/essays/${a.essayId}`, 'Xem bài', { class: 'btn' });
  }
  const opensLater = Date.parse(a.opensAt) > Date.now();
  return h(
    'article',
    { class: 'card' },
    h('h2', null, a.title),
    h('p', null, `${taskLabel(a.taskType)} · ${a.timeLimitMinutes} phút`),
    h(
      'p',
      null,
      badge(
        ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status,
        a.status === 'missed' ? 'danger' : a.status === 'not_started' ? 'warning' : '',
      ),
      ' ',
      opensLater
        ? `Mở lúc ${formatDateTime(a.opensAt)}`
        : `Hạn ${formatDateTime(a.closesAt)}${a.isOpen ? ` (${countdown(a.closesAt)})` : ''}`,
    ),
    action,
    status,
  );
}
