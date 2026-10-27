// "Assigned to me": tests set by the teacher. The prompt is hidden until Start test.
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
    'Assigned to me',
    h(
      'p',
      null,
      'Tests your teacher has set. The question appears when you press “Start test”, and the timer starts straight away. You get one attempt.',
    ),
    async(
      () => api<MyAssignment[]>('assignments.mine'),
      (list) => {
        if (list.length === 0) return empty('No tests have been assigned to you yet.');
        return h('div', { class: 'cards' }, ...list.map(assignmentCard));
      },
      'Loading assigned tests…',
    ),
  );
}

function assignmentCard(a: MyAssignment): HTMLElement {
  const status = h('div', { 'aria-live': 'polite' });
  let action: HTMLElement | null = null;
  if (a.status === 'not_started' && a.isOpen) {
    const btn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Start test');
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Start “${a.title}”?`,
        message: `The question appears now and you will have ${a.timeLimitMinutes} minutes. The timer keeps running if you leave. Pasting is blocked.`,
        confirmLabel: 'Start test',
      });
      if (!ok) return;
      await busy(btn, 'Starting…', async () => {
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
    action = link(`/write/${a.essayId}`, 'Continue test', { class: 'btn btn-primary' });
  } else if ((a.status === 'submitted' || a.status === 'over_time') && a.essayId) {
    action = link(`/essays/${a.essayId}`, 'View essay', { class: 'btn' });
  }
  const opensLater = Date.parse(a.opensAt) > Date.now();
  return h(
    'article',
    { class: 'card' },
    h('h2', null, a.title),
    h('p', null, `${taskLabel(a.taskType)} · ${a.timeLimitMinutes} minutes`),
    h(
      'p',
      null,
      badge(
        ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status,
        a.status === 'missed' ? 'danger' : a.status === 'not_started' ? 'warning' : '',
      ),
      ' ',
      opensLater
        ? `Opens ${formatDateTime(a.opensAt)}`
        : `Closes ${formatDateTime(a.closesAt)}${a.isOpen ? ` (${countdown(a.closesAt)})` : ''}`,
    ),
    action,
    status,
  );
}
