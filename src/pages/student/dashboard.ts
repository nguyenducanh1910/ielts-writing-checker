// Student progress dashboard.
import { api } from '../../api';
import { h } from '../../dom';
import { navigate, type RouteContext } from '../../router';
import type { RewriteView } from '../../types';
import { async, link, notice, page } from '../../ui/components';
import { countdown, formatBand, formatDate, formatDateTime, taskLabel } from '../../ui/format';
import {
  bandChart,
  criteriaChart,
  type DashboardStats,
  filterBar,
  highlightsSection,
  perWeekChart,
  rewriteImprovementsSection,
  topErrorsSection,
} from '../statsWidgets';
import type { MyAssignment } from './assigned';

interface DashboardData extends DashboardStats {
  targetBand: number | null;
  examDate: string;
  rewrites: Array<RewriteView & { topic: string }>;
}

export function dashboardPage(ctx: RouteContext): Node {
  const filters = {
    taskType: ctx.query.get('taskType') ?? undefined,
    mode: ctx.query.get('mode') ?? undefined,
  };
  return page(
    'Dashboard',
    async(
      () =>
        Promise.all([
          api<DashboardData>('dashboard.get', filters),
          api<MyAssignment[]>('assignments.mine').catch(() => [] as MyAssignment[]),
        ]),
      ([data, assignments]) => {
        const newAssignments = assignments.filter((a) => a.status === 'not_started' && a.isOpen);
        const inProgress = assignments.filter((a) => a.status === 'in_progress');
        return [
          h('p', null, link('/new', 'Start a new essay', { class: 'btn btn-primary' })),
          newAssignments.length || inProgress.length
            ? notice(
                'info',
                h('h2', null, 'New tests from your teacher'),
                h(
                  'ul',
                  null,
                  ...[...inProgress, ...newAssignments].map((a) =>
                    h(
                      'li',
                      null,
                      h('strong', null, a.title),
                      ` · ${taskLabel(a.taskType)} · ${a.timeLimitMinutes} min · closes ${formatDateTime(a.closesAt)}`,
                      a.status === 'in_progress' ? ' (in progress)' : '',
                    ),
                  ),
                ),
                link('/assigned', 'Go to Assigned to me'),
              )
            : null,
          data.rewrites.length
            ? h(
                'section',
                { class: 'card' },
                h('h2', null, 'Upcoming rewrite deadlines'),
                h(
                  'ul',
                  null,
                  ...data.rewrites.map((r) =>
                    h(
                      'li',
                      null,
                      link(`/essays/${r.essayId}`, r.topic),
                      ` — due ${formatDateTime(r.dueAt)} `,
                      h(
                        'strong',
                        { class: r.status === 'overdue' ? 'down' : '' },
                        `(${countdown(r.dueAt)})`,
                      ),
                      ' ',
                      link(`/rewrite/${r.essayId}`, 'Submit rewrite'),
                    ),
                  ),
                ),
              )
            : null,
          filterBar(filters, (f) => {
            const q = new URLSearchParams(
              Object.entries(f).filter(([, v]) => v) as [string, string][],
            );
            navigate(`/dashboard${q.toString() ? `?${q}` : ''}`);
          }),
          highlightsSection(data.highlights),
          rewriteImprovementsSection(data.rewriteImprovements, (id) => `/essays/${id}`),
          h(
            'div',
            { class: 'stat-grid' },
            h(
              'div',
              { class: 'stat' },
              'Essays submitted',
              h('strong', null, String(data.counts.submitted)),
            ),
            h('div', { class: 'stat' }, 'Scored', h('strong', null, String(data.counts.scored))),
            h(
              'div',
              { class: 'stat' },
              'Latest band',
              h('strong', null, formatBand(data.bandOverTime.at(-1)?.overall ?? null)),
            ),
            h(
              'div',
              { class: 'stat' },
              'Target band',
              h('strong', null, formatBand(data.targetBand)),
              data.targetBand === null ? link('/settings', 'Set target') : null,
            ),
            data.examDate
              ? h(
                  'div',
                  { class: 'stat' },
                  'Exam date',
                  h('strong', null, formatDate(data.examDate)),
                )
              : null,
          ),
          h(
            'section',
            { class: 'card' },
            h('h2', null, 'Overall band over time'),
            bandChart(data.bandOverTime, data.targetBand),
          ),
          h(
            'div',
            { class: 'grid-2' },
            h(
              'section',
              { class: 'card' },
              h('h2', null, 'Average by criterion'),
              criteriaChart(data.criterionAverages),
            ),
            h(
              'section',
              { class: 'card' },
              h('h2', null, 'Essays per week'),
              perWeekChart(data.perWeek),
            ),
          ),
          h('h2', null, 'Your most frequent errors'),
          topErrorsSection(data.topErrors),
        ];
      },
      'Loading your dashboard…',
    ),
  );
}
