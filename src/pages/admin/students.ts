// Admin: student list and per-student overview.
import { api, ApiClientError } from '../../api';
import { h, replace } from '../../dom';
import { navigate, type RouteContext } from '../../router';
import type { EssaySummary, RewriteView } from '../../types';
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
  showFieldErrors,
  table,
} from '../../ui/components';
import {
  countdown,
  formatBand,
  formatDate,
  formatDateTime,
  modeLabel,
  taskLabel,
} from '../../ui/format';
import {
  bandChart,
  criteriaChart,
  type DashboardStats,
  filterBar,
  highlightsSection,
  rewriteImprovementsSection,
  topErrorsSection,
} from '../statsWidgets';
import { statusBadge } from '../student/essays';
import { type TopicHistory, topicHistoryView } from '../student/topics';

interface StudentRow {
  id: string;
  name: string;
  email: string;
  className: string;
  essays: number;
  scored: number;
  pending: number;
  averageBand: number | null;
  lastSubmittedAt: string | null;
  overdueRewrites: number;
  targetBand: number | null;
  hasPassword: boolean;
}

export function studentsPage(): Node {
  return page(
    'Students',
    async(
      () => api<StudentRow[]>('admin.students'),
      (rows) =>
        rows.length
          ? table(
              [
                'Student',
                'Class',
                'Essays',
                'Average band',
                'Target',
                'Last essay',
                'Overdue rewrites',
                'Password',
              ],
              rows.map((s) => [
                link(`/admin/students/${s.id}`, s.name),
                s.className || '–',
                `${s.scored} scored · ${s.pending} pending`,
                formatBand(s.averageBand),
                formatBand(s.targetBand),
                formatDateTime(s.lastSubmittedAt),
                s.overdueRewrites ? badge(String(s.overdueRewrites), 'danger') : '0',
                s.hasPassword ? 'Set' : badge('Not set', 'warning'),
              ]),
            )
          : empty('No students have signed up yet.'),
      'Loading students…',
    ),
  );
}

interface Overview {
  student: {
    id: string;
    name: string;
    email: string;
    className: string;
    targetBand: number | null;
    examDate: string;
    createdAt: string;
  };
  essays: EssaySummary[];
  stats: DashboardStats;
  recurringErrors: Array<{ category: string; count: number }>;
  topics: TopicHistory;
  rewriteHistory: Array<RewriteView & { topic: string }>;
  overdueRewrites: Array<RewriteView & { topic: string }>;
  assignments: Array<{
    assignmentId: string;
    title: string;
    essayId: string;
    overall: number | null;
    classAverage: number | null;
    scoredCount: number;
  }>;
}

export function studentOverviewPage(ctx: RouteContext): Node {
  const filters = {
    taskType: ctx.query.get('taskType') ?? undefined,
    mode: ctx.query.get('mode') ?? undefined,
  };
  return async(
    () => api<Overview>('admin.studentOverview', { studentId: ctx.params.id, ...filters }),
    (o) =>
      page(
        o.student.name,
        h('p', null, link('/admin/students', '← All students')),
        h(
          'p',
          { class: 'meta' },
          `${o.student.email} · ${o.student.className || 'no class'} · target ${formatBand(o.student.targetBand)}`,
          o.student.examDate ? ` · exam ${formatDate(o.student.examDate)}` : '',
          ` · joined ${formatDate(o.student.createdAt)}`,
        ),
        setPasswordForm(o.student.id),
        o.overdueRewrites.length
          ? notice(
              'error',
              h('strong', null, `${o.overdueRewrites.length} overdue rewrite(s): `),
              o.overdueRewrites.map((r) => r.topic).join(', '),
            )
          : null,
        filterBar(filters, (f) => {
          const q = new URLSearchParams(
            Object.entries(f).filter(([, v]) => v) as [string, string][],
          );
          navigate(`/admin/students/${o.student.id}${q.toString() ? `?${q}` : ''}`);
        }),
        highlightsSection(o.stats.highlights),
        rewriteImprovementsSection(o.stats.rewriteImprovements, (id) => `/admin/score/${id}`),
        h(
          'section',
          { class: 'card' },
          h('h2', null, 'Score trend'),
          bandChart(o.stats.bandOverTime, o.student.targetBand),
        ),
        h(
          'section',
          { class: 'card' },
          h('h2', null, 'Average by criterion'),
          criteriaChart(o.stats.criterionAverages),
        ),
        h('h2', null, 'Recurring errors (last 90 days)'),
        o.recurringErrors.length
          ? table(
              ['Category', 'Count'],
              o.recurringErrors.map((e) => [e.category, String(e.count)]),
            )
          : empty('No errors recorded.'),
        topErrorsSection(o.stats.topErrors),
        h('h2', null, 'Essays'),
        o.essays.length
          ? table(
              ['Essay', 'Task', 'Mode', 'Status', 'Band', 'Submitted'],
              o.essays.map((e) => [
                e.status === 'draft'
                  ? `${e.topic} (draft)`
                  : link(`/admin/score/${e.id}`, [e.topic, e.parentEssayId ? ' (rewrite)' : '']),
                taskLabel(e.taskType),
                modeLabel(e.mode),
                statusBadge(e.studentStatus),
                formatBand(e.overall),
                formatDateTime(e.submittedAt),
              ]),
            )
          : empty('No essays yet.'),
        h('h2', null, 'Assignments compared with the class'),
        o.assignments.length
          ? table(
              ['Assignment', 'Band', 'Class average', 'Scored'],
              o.assignments.map((a) => [
                link(`/admin/assignments/${a.assignmentId}`, a.title),
                formatBand(a.overall),
                formatBand(a.classAverage),
                String(a.scoredCount),
              ]),
            )
          : empty('No assigned tests taken.'),
        h('h2', null, 'Rewrite history'),
        o.rewriteHistory.length
          ? table(
              ['Essay', 'Due', 'Status'],
              o.rewriteHistory.map((r) => [
                link(`/admin/score/${r.essayId}`, r.topic),
                `${formatDateTime(r.dueAt)}${r.status === 'requested' ? ` (${countdown(r.dueAt)})` : ''}`,
                [
                  badge(
                    r.status,
                    r.status === 'overdue'
                      ? 'danger'
                      : r.status === 'submitted'
                        ? 'success'
                        : 'warning',
                  ),
                  r.late ? [' ', badge('late', 'warning')] : null,
                ],
              ]),
            )
          : empty('No rewrite requests.'),
        h('h2', null, 'Topics covered'),
        topicHistoryView(o.topics, (id) => `/admin/score/${id}`),
      ),
    'Loading student…',
  );
}

/** The teacher sets a password for a student (e.g. one who forgot it) and tells them in class. */
function setPasswordForm(studentId: string): HTMLElement {
  const password = h('input', {
    type: 'text',
    name: 'password',
    autocomplete: 'off',
    maxlength: '128',
  });
  const status = h('div', { 'aria-live': 'polite' });
  const save = h('button', { type: 'submit', class: 'btn btn-small' }, 'Set password');
  const form = h(
    'form',
    { class: 'card narrow', novalidate: true },
    h(
      'details',
      null,
      h('summary', null, 'Set a password for this student'),
      h(
        'p',
        { class: 'hint' },
        'Use this when a student forgot their password or never received the login email. Tell them the new password; they can change it in Settings.',
      ),
      field({
        label: 'New password',
        control: password,
        name: 'password',
        hint: 'At least 8 characters.',
      }),
      save,
      status,
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (password.value.length < 8) {
      return showFieldErrors(form, { password: 'Use at least 8 characters' });
    }
    void busy(save, 'Saving…', async () => {
      try {
        await api('admin.students.setPassword', { studentId, password: password.value });
        showFieldErrors(form, {});
        password.value = '';
        replace(status, notice('success', 'Password saved. Tell the student their new password.'));
      } catch (err) {
        if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    });
  });
  return form;
}
