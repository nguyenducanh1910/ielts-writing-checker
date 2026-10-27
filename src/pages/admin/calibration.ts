// Source calibration: how far each source's scores are from the final scores.
import { CRITERIA, criterionLabel, TASK_TYPE_LABELS } from '../../../shared/constants';
import type { SourceCalibration } from '../../../shared/stats';
import { api } from '../../api';
import { h } from '../../dom';
import { navigate, type RouteContext } from '../../router';
import { chartBox, COLORS } from '../../ui/charts';
import { async, empty, field, page, selectEl, table } from '../../ui/components';
import { signed } from '../../ui/format';

const KEYS = [...CRITERIA, 'overall'] as const;
const keyLabel = (k: (typeof KEYS)[number]) => (k === 'overall' ? 'Overall' : criterionLabel(k));

function pct(x: number | null) {
  return x === null ? '–' : `${Math.round(x * 100)}%`;
}

function bias(x: number | null) {
  return x === null ? '–' : signed(x, 2);
}

/** For each criterion, the source with the smallest average bias (min 3 essays). */
function recommendations(sources: SourceCalibration[]) {
  return KEYS.map((k) => {
    const candidates = sources.filter((s) => s.bias[k] !== null && s.counts[k] >= 3);
    if (!candidates.length)
      return [keyLabel(k), 'Not enough data yet (needs 3 essays per source).'];
    const best = [...candidates].sort(
      (a, b) =>
        Math.abs(a.bias[k]!) - Math.abs(b.bias[k]!) || (b.within[k] ?? 0) - (a.within[k] ?? 0),
    )[0];
    return [
      keyLabel(k),
      `${best.name} (${bias(best.bias[k])}, within 0.5 band ${pct(best.within[k])})`,
    ];
  });
}

export function calibrationPage(ctx: RouteContext): Node {
  const taskType = ctx.query.get('taskType') ?? '';
  return page(
    'Source calibration',
    h(
      'p',
      null,
      'Average difference between each source and your final score (positive = the source scores higher than you), and how often it lands within 0.5 band.',
    ),
    async(
      () =>
        api<{ sources: SourceCalibration[] }>('admin.calibration', taskType ? { taskType } : {}),
      ({ sources }) => {
        const sel = selectEl(
          'taskType',
          Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          taskType,
          'All task types',
        );
        sel.addEventListener('change', () =>
          navigate(`/admin/calibration${sel.value ? `?taskType=${sel.value}` : ''}`),
        );
        const withData = sources.filter((s) => s.samples > 0);
        const periods = [...new Set(withData.flatMap((s) => s.trend.map((t) => t.period)))].sort();
        return [
          h('div', { class: 'filters' }, field({ label: 'Task type', control: sel })),
          withData.length === 0
            ? empty(
                'No scored essays with source results yet. Paste tool results on the scoring page, then submit the score.',
              )
            : [
                h(
                  'div',
                  { class: 'stat-grid' },
                  ...withData.map((s) =>
                    h(
                      'div',
                      { class: 'stat' },
                      `${s.name} (${s.samples} essays)`,
                      h('strong', null, `${bias(s.bias.overall)} overall`),
                      `within 0.5: ${pct(s.within.overall)}`,
                    ),
                  ),
                ),
                h('h2', null, 'Average difference from the final score'),
                table(
                  ['Source', 'Essays', ...KEYS.map(keyLabel)],
                  sources.map((s) => [
                    s.name,
                    String(s.samples),
                    ...KEYS.map((k) => bias(s.bias[k])),
                  ]),
                ),
                h('h2', null, 'Within 0.5 band of the final score'),
                table(
                  ['Source', ...KEYS.map(keyLabel)],
                  sources.map((s) => [s.name, ...KEYS.map((k) => pct(s.within[k]))]),
                ),
                h('h2', null, 'Which source to trust for which criterion'),
                table(['Criterion', 'Closest to your scores'], recommendations(sources)),
                h('h2', null, 'Overall bias trend by month'),
                h(
                  'section',
                  { class: 'card' },
                  chartBox(
                    {
                      type: 'line',
                      data: {
                        labels: periods,
                        datasets: withData.map((s, i) => ({
                          label: s.name,
                          data: periods.map(
                            (p) => s.trend.find((t) => t.period === p)?.bias ?? null,
                          ),
                          borderColor: COLORS.palette[i % COLORS.palette.length],
                          backgroundColor: COLORS.palette[i % COLORS.palette.length],
                          spanGaps: true,
                        })),
                      },
                      options: { scales: { y: { suggestedMin: -1.5, suggestedMax: 1.5 } } },
                    },
                    `Overall bias by month for ${withData.map((s) => s.name).join(', ')}.`,
                    {
                      headers: ['Month', ...withData.map((s) => s.name)],
                      rows: periods.map((p) => [
                        p,
                        ...withData.map((s) =>
                          bias(s.trend.find((t) => t.period === p)?.bias ?? null),
                        ),
                      ]),
                    },
                  ),
                ),
              ],
        ];
      },
      'Loading calibration…',
    ),
  );
}
