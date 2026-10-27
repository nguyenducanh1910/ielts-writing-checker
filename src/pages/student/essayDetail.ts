// Essay page: final scores, feedback, tagged errors, highlighted text, rewrites.
import {
  CRITERIA,
  CRITERION_SHORT,
  criterionLabel,
  type TaskType,
} from '../../../shared/constants';
import { api } from '../../api';
import { type Child, h, replace } from '../../dom';
import type { RouteContext } from '../../router';
import type { EssayDetail, ErrorView, ScoreView } from '../../types';
import { async, badge, link, notice, page, table } from '../../ui/components';
import { essayText, highlightLegend } from '../../ui/essayText';
import {
  countdown,
  formatBand,
  formatDateTime,
  modeLabel,
  signed,
  taskLabel,
} from '../../ui/format';
import { remoteImage } from '../../ui/image';
import { markdown } from '../../ui/markdown';
import { statusBadge } from './essays';

export function scoreTable(score: ScoreView, taskType: TaskType): HTMLElement {
  return table(
    ['Criterion', 'Band'],
    [
      ...CRITERIA.map((c) => [criterionLabel(c, taskType), formatBand(score.criteria[c])]),
      [h('strong', null, 'Overall'), h('strong', null, formatBand(score.overall))],
    ],
  );
}

/** Original vs rewrite, per criterion and overall. */
export function comparisonTable(
  original: ScoreView,
  rewrite: ScoreView,
  taskType: TaskType,
): HTMLElement {
  const row = (label: string, a: number, b: number) => [
    label,
    formatBand(a),
    formatBand(b),
    h('span', { class: b > a ? 'up' : b < a ? 'down' : '' }, signed(b - a)),
  ];
  return table(
    ['Criterion', 'Original', 'Rewrite', 'Change'],
    [
      ...CRITERIA.map((c) =>
        row(criterionLabel(c, taskType), original.criteria[c], rewrite.criteria[c]),
      ),
      row('Overall', original.overall, rewrite.overall),
    ],
    'Improvement from original to rewrite',
  );
}

function errorList(errors: ErrorView[], onPick: (id: string) => void): HTMLElement {
  if (errors.length === 0) return h('p', null, 'No errors were tagged in this essay.');
  return h(
    'ol',
    { class: 'error-list' },
    ...errors.map((e) =>
      h(
        'li',
        { id: `err-${e.id}` },
        h(
          'button',
          { type: 'button', class: 'linklike', onclick: () => onPick(e.id) },
          h('strong', null, e.category),
        ),
        ' ',
        h('span', { class: `badge crit-badge crit-${e.criterion}` }, CRITERION_SHORT[e.criterion]),
        h(
          'div',
          null,
          h('span', { class: 'excerpt' }, `“${e.excerpt}”`),
          ' → ',
          h('span', { class: 'correction' }, e.correction),
        ),
        e.note ? h('div', { class: 'hint' }, e.note) : null,
      ),
    ),
  );
}

export function essayDetailPage(ctx: RouteContext): Node {
  return async(
    () => api<EssayDetail>('essays.get', { id: ctx.params.id }),
    (essay) => {
      const meta = h(
        'p',
        { class: 'meta' },
        `${taskLabel(essay.taskType)} · ${essay.topic} · ${modeLabel(essay.mode)}`,
        essay.assignmentTitle ? ` · ${essay.assignmentTitle}` : '',
        ' · ',
        statusBadge(essay.studentStatus),
        essay.overTime ? [' ', badge('Over time', 'warning')] : null,
        essay.autoSubmitted ? [' ', badge('Submitted automatically')] : null,
      );
      const facts = h(
        'p',
        { class: 'hint' },
        `Submitted ${formatDateTime(essay.submittedAt)} · ${essay.wordCount} words`,
        essay.timeUsedSeconds !== null
          ? ` · ${essay.mode === 'practice' ? 'Time spent' : 'Time used'} ${Math.round(essay.timeUsedSeconds / 60)} min`
          : '',
      );

      const textBox = h('div');
      let active = '';
      const renderText = () =>
        replace(
          textBox,
          essayText(
            essay.body,
            essay.errors.map((e) => ({
              id: e.id,
              start: e.start,
              end: e.end,
              label: e.category,
              correction: e.correction,
              active: e.id === active,
              criterion: e.criterion,
            })),
            (id) => {
              active = id;
              renderText();
              document
                .getElementById(`err-${id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            },
          ),
        );
      renderText();

      const sections: Child[] = [meta, facts];

      if (essay.status === 'draft') {
        sections.push(
          notice(
            'info',
            'This essay is still a draft. ',
            link(`/write/${essay.id}`, 'Continue writing'),
          ),
        );
      } else if (!essay.score) {
        sections.push(
          notice(
            'info',
            'Submitted. Your teacher will score it soon — you will get an email when it is ready.',
          ),
        );
      }

      if (essay.score) {
        sections.push(
          h(
            'div',
            { class: 'score-summary' },
            h(
              'div',
              { class: 'band-hero' },
              h('span', null, 'Overall band'),
              h('strong', null, formatBand(essay.score.overall)),
            ),
            scoreTable(essay.score, essay.taskType),
          ),
        );
      }

      // Rewrite request on this essay.
      if (essay.rewrite && essay.rewrite.status !== 'waived') {
        const rw = essay.rewrite;
        const open = rw.status === 'requested' || rw.status === 'overdue';
        sections.push(
          notice(
            rw.status === 'overdue' ? 'error' : 'warning',
            h('h2', null, 'Rewrite required'),
            rw.note ? h('p', null, rw.note) : null,
            h(
              'p',
              null,
              `Due ${formatDateTime(rw.dueAt)} — `,
              open
                ? countdown(rw.dueAt)
                : rw.status === 'submitted'
                  ? `submitted${rw.late ? ' (late)' : ''}`
                  : rw.status,
            ),
            open
              ? link(`/rewrite/${essay.id}`, 'Submit rewrite', { class: 'btn btn-primary' })
              : null,
            rw.rewriteEssayId
              ? h('p', null, link(`/essays/${rw.rewriteEssayId}`, 'View your rewrite'))
              : null,
          ),
        );
      }
      if (essay.score && essay.rewriteEssay?.score) {
        sections.push(
          h('h2', null, 'Original vs rewrite'),
          comparisonTable(essay.score, essay.rewriteEssay.score, essay.taskType),
        );
      }
      if (essay.parent) {
        sections.push(
          h(
            'p',
            null,
            'This is a rewrite of ',
            link(`/essays/${essay.parent.id}`, 'your original essay'),
            '.',
          ),
          essay.score && essay.parent.score
            ? comparisonTable(essay.parent.score, essay.score, essay.taskType)
            : null,
        );
      }

      if (essay.score) {
        sections.push(
          h('h2', null, 'Feedback'),
          essay.score.generalComment
            ? h('div', { class: 'card' }, markdown(essay.score.generalComment))
            : null,
          ...CRITERIA.filter((c) => essay.score!.feedback[c]).map((c) =>
            h(
              'div',
              { class: `card criterion-card crit-${c}` },
              h('h3', null, criterionLabel(c, essay.taskType)),
              markdown(essay.score!.feedback[c]),
            ),
          ),
        );
      }

      sections.push(
        h('h2', null, 'Task'),
        h('p', { class: 'prompt-text' }, essay.prompt),
        essay.hasImage
          ? remoteImage('essays.image', { essayId: essay.id }, 'Chart or diagram for this task')
          : null,
      );

      if (essay.score) {
        sections.push(
          h(
            'div',
            { class: 'grid-essay' },
            h(
              'div',
              null,
              h('h2', null, 'Your essay'),
              h(
                'p',
                { class: 'hint' },
                'Highlighted text has a tagged error. Select it to see the correction.',
              ),
              highlightLegend(),
              textBox,
            ),
            h(
              'div',
              null,
              h('h2', null, `Errors (${essay.errors.length})`),
              errorList(essay.errors, (id) => {
                active = id;
                renderText();
              }),
            ),
          ),
        );
      } else {
        sections.push(h('h2', null, 'Your essay'), textBox);
      }
      return page(essay.parentEssayId ? 'Rewrite' : 'Essay', ...sections);
    },
    'Loading essay…',
  );
}
