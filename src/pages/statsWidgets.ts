// Dashboard widgets shared by the student dashboard and the admin student overview.
import {
  CRITERIA,
  CRITERION_SHORT,
  criterionLabel,
  type Criterion,
  MODES,
  TASK_TYPE_LABELS,
} from '../../shared/constants';
import type { Highlight, RewriteImprovement, TopError } from '../../shared/dashboard';
import { type Child, h } from '../dom';
import { chartBox, COLORS } from '../ui/charts';
import { empty, field, selectEl, table } from '../ui/components';
import { formatBand, formatDate, modeLabel, signed } from '../ui/format';

export interface DashboardStats {
  bandOverTime: Array<{
    essayId: string;
    date: string;
    overall: number;
    mode: string;
    taskType: string;
    topic: string;
  }>;
  criterionAverages: Record<Criterion, number | null>;
  topErrors: { last30: Record<Criterion, TopError[]>; last90: Record<Criterion, TopError[]> };
  highlights: Highlight[];
  perWeek: Array<{ week: string; count: number }>;
  counts: { submitted: number; scored: number };
  rewriteImprovements: RewriteImprovement[];
}

/** Original vs rewrite, per criterion and overall. */
export function rewriteImprovementsSection(
  list: RewriteImprovement[],
  href: (essayId: string) => string,
): Child {
  if (list.length === 0) return null;
  const keys = [...CRITERIA, 'overall'] as const;
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Improvement from original to rewrite'),
    table(
      ['Essay', ...keys.map((k) => (k === 'overall' ? 'Overall' : CRITERION_SHORT[k]))],
      list.map((x) => [
        h('a', { href: `#${href(x.rewriteId)}` }, x.topic),
        ...keys.map((k) =>
          h(
            'span',
            { class: x.change[k] > 0 ? 'up' : x.change[k] < 0 ? 'down' : '' },
            `${formatBand(x.original[k])} → ${formatBand(x.rewrite[k])} (${signed(x.change[k])})`,
          ),
        ),
      ]),
      'Band change per criterion (TA/TR, CC, LR, GRA) and overall',
    ),
  );
}

export function filterBar(
  current: { taskType?: string; mode?: string },
  onChange: (f: { taskType: string; mode: string }) => void,
): HTMLElement {
  const task = selectEl(
    'taskType',
    Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    current.taskType ?? '',
    'All task types',
  );
  const mode = selectEl(
    'mode',
    MODES.map((m) => ({ value: m, label: modeLabel(m) })),
    current.mode ?? '',
    'All modes',
  );
  const fire = () => onChange({ taskType: task.value, mode: mode.value });
  task.addEventListener('change', fire);
  mode.addEventListener('change', fire);
  return h(
    'div',
    { class: 'filters' },
    field({ label: 'Task type', control: task }),
    field({ label: 'Mode', control: mode }),
  );
}

export function highlightsSection(highlights: Highlight[]): Child {
  if (highlights.length === 0) {
    return h(
      'section',
      { class: 'card' },
      h('h2', null, 'Progress highlights'),
      h(
        'p',
        { class: 'hint' },
        'Highlights compare your last 3 scored essays with the 3 before. They appear once you have at least 4 scored essays.',
      ),
    );
  }
  const title: Record<string, string> = {
    avoided: 'Mistake avoided',
    improving: 'Improving',
    attention: 'Needs attention',
  };
  return h(
    'section',
    { 'aria-labelledby': 'hl-heading' },
    h('h2', { id: 'hl-heading' }, 'Progress highlights'),
    h(
      'p',
      { class: 'hint' },
      'Errors per 100 words in your last 3 scored essays compared with the 3 before, so longer essays are not penalised.',
    ),
    h(
      'div',
      { class: 'cards' },
      ...highlights.map((x) =>
        h(
          'div',
          { class: `card highlight-${x.kind}` },
          h('h3', null, `${title[x.kind]}: ${x.category}`),
          h('p', null, x.message),
          h(
            'p',
            { class: 'hint' },
            `${criterionLabel(x.criterion)} · before ${x.previousCount} (${x.previousRate}/100 words) · now ${x.recentCount} (${x.recentRate}/100 words)`,
          ),
        ),
      ),
    ),
  );
}

export function bandChart(
  points: DashboardStats['bandOverTime'],
  targetBand: number | null,
): Child {
  if (points.length === 0) return empty('No scored essays yet.');
  const labels = points.map((p) => formatDate(p.date));
  const timed = (m: string) => m === 'test' || m === 'assigned';
  return chartBox(
    {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Overall band (◆ = Test or Assigned test)',
            data: points.map((p) => p.overall),
            borderColor: COLORS.primary,
            backgroundColor: points.map((p) => (timed(p.mode) ? COLORS.test : COLORS.primary)),
            pointStyle: points.map((p) => (timed(p.mode) ? 'rectRot' : 'circle')),
            pointRadius: points.map((p) => (timed(p.mode) ? 7 : 4)),
            tension: 0.2,
          },
          ...(targetBand !== null
            ? [
                {
                  label: `Target band ${formatBand(targetBand)}`,
                  data: points.map(() => targetBand),
                  borderColor: COLORS.target,
                  borderDash: [6, 6],
                  pointRadius: 0,
                },
              ]
            : []),
        ],
      },
      options: { scales: { y: { min: 3, max: 9, ticks: { stepSize: 0.5 } } } },
    },
    `Overall band over time: ${points.length} scored essays, latest ${formatBand(points.at(-1)!.overall)}${targetBand !== null ? `, target ${formatBand(targetBand)}` : ''}.`,
    {
      headers: ['Date', 'Topic', 'Mode', 'Overall'],
      rows: points.map((p) => [
        formatDate(p.date),
        p.topic,
        modeLabel(p.mode),
        formatBand(p.overall),
      ]),
    },
  );
}

export function criteriaChart(avg: DashboardStats['criterionAverages']): Child {
  if (CRITERIA.every((c) => avg[c] === null)) return empty('No scores yet.');
  return chartBox(
    {
      type: 'bar',
      data: {
        labels: CRITERIA.map((c) => criterionLabel(c)),
        datasets: [
          {
            label: 'Average band',
            data: CRITERIA.map((c) => avg[c]),
            backgroundColor: COLORS.criteria,
          },
        ],
      },
      options: { scales: { y: { min: 0, max: 9 } }, plugins: { legend: { display: false } } },
    },
    `Average per criterion: ${CRITERIA.map((c) => `${criterionLabel(c)} ${avg[c] ?? 'n/a'}`).join(', ')}.`,
    {
      headers: ['Criterion', 'Average'],
      rows: CRITERIA.map((c) => [criterionLabel(c), avg[c] === null ? '–' : avg[c]!.toFixed(2)]),
    },
  );
}

export function perWeekChart(perWeek: DashboardStats['perWeek']): Child {
  return chartBox(
    {
      type: 'bar',
      data: {
        labels: perWeek.map((w) => formatDate(w.week)),
        datasets: [
          {
            label: 'Essays submitted',
            data: perWeek.map((w) => w.count),
            backgroundColor: COLORS.primary,
          },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        plugins: { legend: { display: false } },
      },
    },
    `Essays submitted per week for the last ${perWeek.length} weeks: ${perWeek.reduce((s, w) => s + w.count, 0)} in total.`,
    {
      headers: ['Week starting', 'Essays'],
      rows: perWeek.map((w) => [formatDate(w.week), String(w.count)]),
    },
  );
}

export function topErrorsSection(top: DashboardStats['topErrors']): Child {
  const block = (title: string, data: Record<Criterion, TopError[]>) =>
    h(
      'div',
      { class: 'card' },
      h('h3', null, title),
      ...CRITERIA.map((c) =>
        h(
          'div',
          null,
          h('h4', null, criterionLabel(c)),
          data[c].length
            ? h(
                'ul',
                null,
                ...data[c].map((e) =>
                  h(
                    'li',
                    null,
                    h('strong', null, e.category),
                    ` × ${e.count}`,
                    e.example
                      ? h(
                          'div',
                          { class: 'hint' },
                          `“${e.example.excerpt}” → `,
                          h('span', { class: 'correction' }, e.example.correction),
                        )
                      : null,
                  ),
                ),
              )
            : h('p', { class: 'hint' }, 'No errors recorded.'),
        ),
      ),
    );
  return h(
    'div',
    { class: 'grid-2' },
    block('Last 30 days', top.last30),
    block('Last 90 days', top.last90),
  );
}
