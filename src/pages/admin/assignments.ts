// Admin: create assignments and follow each student's status.
import { TASK_TYPE_LABELS, TIME_LIMITS, type TaskType } from '../../../shared/constants';
import { api, ApiClientError } from '../../api';
import { h, replace } from '../../dom';
import { navigate, type RouteContext } from '../../router';
import { getConfig } from '../../state';
import {
  async,
  badge,
  busy,
  empty,
  errorBox,
  errorMessage,
  field,
  link,
  page,
  selectEl,
  showFieldErrors,
  table,
  toast,
} from '../../ui/components';
import { ASSIGNMENT_STATUS_LABELS, formatBand, formatDateTime, taskLabel } from '../../ui/format';
import { categoryFields } from '../../ui/categoryFields';
import { type PickedImage, readImageFile, remoteImage } from '../../ui/image';
import type { ScoreView } from '../../types';

interface AssignmentListItem {
  id: string;
  title: string;
  taskType: string;
  opensAt: string;
  closesAt: string;
  timeLimitMinutes: number | null;
  students: number;
  counts: Record<string, number>;
}

export function assignmentsPage(): Node {
  return page(
    'Assignments',
    h(
      'p',
      null,
      link('/admin/assignments/new', 'Create an assignment', { class: 'btn btn-primary' }),
    ),
    async(
      () => api<AssignmentListItem[]>('admin.assignments.list'),
      (list) =>
        list.length
          ? table(
              ['Title', 'Task', 'Open', 'Close', 'Students', 'Status'],
              list.map((a) => [
                link(`/admin/assignments/${a.id}`, a.title),
                `${taskLabel(a.taskType)} · ${a.timeLimitMinutes} min`,
                formatDateTime(a.opensAt),
                formatDateTime(a.closesAt),
                String(a.students),
                Object.entries(a.counts)
                  .filter(([, n]) => n)
                  .map(([k, n]) => `${n} ${ASSIGNMENT_STATUS_LABELS[k].toLowerCase()}`)
                  .join(', ') || '–',
              ]),
            )
          : empty('No assignments yet.'),
      'Loading assignments…',
    ),
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function newAssignmentPage(): Node {
  return page(
    'Create an assignment',
    async(
      async () => {
        const [config, students] = await Promise.all([
          getConfig(),
          api<Array<{ id: string; name: string; className: string }>>('admin.students'),
        ]);
        return { config, students };
      },
      ({ config, students }) => {
        let image: PickedImage | null = null;
        const title = h('input', { name: 'title', maxlength: '200' });
        const taskSel = selectEl(
          'taskType',
          Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          'task2',
        );
        const category = categoryFields(config.topics);
        const prompt = h('textarea', { name: 'prompt', rows: '5', maxlength: '4000' });
        const file = h('input', { type: 'file', name: 'image', accept: 'image/png,image/jpeg' });
        const imageField = field({
          label: 'Chart image (PNG or JPG, max 5 MB)',
          control: file,
          name: 'image',
        });
        const now = new Date();
        const opens = h('input', {
          type: 'datetime-local',
          name: 'opensAt',
          value: toLocalInput(now),
        });
        const closes = h('input', {
          type: 'datetime-local',
          name: 'closesAt',
          value: toLocalInput(new Date(now.getTime() + 7 * 86400000)),
        });
        const minutes = h('input', {
          type: 'number',
          name: 'timeLimitMinutes',
          min: '5',
          max: '180',
          value: String(TIME_LIMITS.task2),
        });
        const email = h('input', { type: 'checkbox', id: 'email-students' });
        const classBoxes = config.classes.map((c) => {
          const box = h('input', { type: 'checkbox', value: c.id, id: `cls-${c.id}` });
          return {
            box,
            el: h('label', { class: 'inline', for: `cls-${c.id}` }, box, ` ${c.label}`),
          };
        });
        const studentSel = h(
          'select',
          {
            name: 'studentIds',
            multiple: true,
            size: String(Math.min(8, Math.max(3, students.length))),
          },
          ...students.map((s) =>
            h('option', { value: s.id }, `${s.name}${s.className ? ` (${s.className})` : ''}`),
          ),
        );
        const status = h('div', { 'aria-live': 'polite' });
        const submit = h(
          'button',
          { type: 'submit', class: 'btn btn-primary' },
          'Create assignment',
        );
        const sync = () => {
          imageField.hidden = taskSel.value !== 'task1_academic';
          category.setTaskType(taskSel.value);
          minutes.value = String(TIME_LIMITS[taskSel.value as TaskType]);
        };
        taskSel.addEventListener('change', sync);
        file.addEventListener('change', async () => {
          const f = file.files?.[0];
          if (!f) return;
          try {
            image = await readImageFile(f);
          } catch (err) {
            image = null;
            file.value = '';
            showFieldErrors(form, { image: errorMessage(err) });
          }
        });
        const form = h(
          'form',
          { class: 'card', novalidate: true },
          field({ label: 'Title', control: title, name: 'title' }),
          h(
            'div',
            { class: 'grid-3' },
            field({ label: 'Task type', control: taskSel, name: 'taskType' }),
            ...category.fields,
          ),
          field({
            label: 'Prompt (hidden from students until they press Start test)',
            control: prompt,
            name: 'prompt',
          }),
          imageField,
          h(
            'fieldset',
            { class: 'field', dataset: { field: 'classIds' } },
            h('legend', null, 'Classes'),
            ...classBoxes.map((c) => c.el),
            h('p', { class: 'field-error', 'aria-live': 'polite' }),
          ),
          field({
            label: 'Or chosen students (Ctrl/Cmd-click to select several)',
            control: studentSel,
            name: 'studentIds',
          }),
          h(
            'div',
            { class: 'grid-3' },
            field({ label: 'Opens', control: opens, name: 'opensAt' }),
            field({ label: 'Closes', control: closes, name: 'closesAt' }),
            field({ label: 'Time limit (minutes)', control: minutes, name: 'timeLimitMinutes' }),
          ),
          h(
            'div',
            { class: 'field checkbox' },
            email,
            h(
              'label',
              { for: 'email-students' },
              'Email the students now (each email counts toward the daily Gmail quota)',
            ),
          ),
          submit,
          status,
        );
        sync();
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          void busy(submit, 'Creating…', async () => {
            try {
              const res = await api<{ id: string; emails: Record<string, number> }>(
                'admin.assignments.create',
                {
                  title: title.value,
                  taskType: taskSel.value,
                  ...category.values(),
                  prompt: prompt.value,
                  image: taskSel.value === 'task1_academic' ? (image ?? undefined) : undefined,
                  classIds: classBoxes.filter((c) => c.box.checked).map((c) => c.box.value),
                  studentIds: [...studentSel.selectedOptions].map((o) => o.value),
                  opensAt: opens.value ? new Date(opens.value).toISOString() : '',
                  closesAt: closes.value ? new Date(closes.value).toISOString() : '',
                  timeLimitMinutes: Number(minutes.value),
                  emailStudents: email.checked,
                },
              );
              const sent = Object.entries(res.emails)
                .map(([k, n]) => `${n} ${k}`)
                .join(', ');
              toast(`Assignment created.${sent ? ` Emails: ${sent}.` : ''}`);
              navigate(`/admin/assignments/${res.id}`);
            } catch (err) {
              if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
              replace(status, errorBox(err));
            }
          });
        });
        return form;
      },
    ),
  );
}

interface AssignmentDetail {
  id: string;
  title: string;
  taskType: string;
  prompt: string;
  hasImage: boolean;
  classLabels: string[];
  opensAt: string;
  closesAt: string;
  timeLimitMinutes: number;
  students: Array<{
    studentId: string;
    name: string;
    className: string;
    status: string;
    essayId: string | null;
    essayStatus: string | null;
    submittedAt: string | null;
    score: ScoreView | null;
  }>;
}

const STATUS_KIND: Record<string, string> = {
  not_started: '',
  in_progress: 'info',
  submitted: 'success',
  over_time: 'warning',
  missed: 'danger',
};

export function assignmentDetailPage(ctx: RouteContext): Node {
  return async(
    () => api<AssignmentDetail>('admin.assignments.get', { id: ctx.params.id }),
    (a) =>
      page(
        a.title,
        h(
          'p',
          null,
          link('/admin/assignments', '← All assignments'),
          ' · ',
          link(`/admin?assignmentId=${a.id}`, 'Scoring queue for this assignment'),
        ),
        h(
          'p',
          { class: 'meta' },
          `${taskLabel(a.taskType)} · ${a.timeLimitMinutes} minutes · opens ${formatDateTime(a.opensAt)} · closes ${formatDateTime(a.closesAt)}`,
          a.classLabels.length ? ` · ${a.classLabels.join(', ')}` : '',
        ),
        h('p', { class: 'prompt-text' }, a.prompt),
        a.hasImage
          ? remoteImage('admin.assignments.image', { id: a.id }, 'Assignment chart')
          : null,
        h('h2', null, 'Students'),
        a.students.length
          ? table(
              ['Student', 'Class', 'Status', 'Submitted', 'Band', ''],
              a.students.map((s) => [
                s.name,
                s.className,
                badge(ASSIGNMENT_STATUS_LABELS[s.status] ?? s.status, STATUS_KIND[s.status]),
                formatDateTime(s.submittedAt),
                formatBand(s.score?.overall ?? null),
                s.essayId && s.essayStatus !== 'draft'
                  ? link(`/admin/score/${s.essayId}`, s.score ? 'View score' : 'Score')
                  : '',
              ]),
            )
          : empty('No students match this assignment.'),
      ),
    'Loading assignment…',
  );
}
