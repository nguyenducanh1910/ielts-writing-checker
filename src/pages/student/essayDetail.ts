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
import { practiceView } from './practice';

export function scoreTable(score: ScoreView, taskType: TaskType): HTMLElement {
  return table(
    ['Tiêu chí', 'Band'],
    [
      ...CRITERIA.map((c) => [
        criterionLabel(c, taskType),
        formatBand(score.criteria?.[c] ?? null),
      ]),
      [h('strong', null, 'Tổng'), h('strong', null, formatBand(score.overall))],
    ],
  );
}

/** Original vs rewrite, per criterion and overall. */
export function comparisonTable(
  original: ScoreView,
  rewrite: ScoreView,
  taskType: TaskType,
): HTMLElement {
  const row = (label: string, a: number | null | undefined, b: number | null | undefined) => {
    const valid = typeof a === 'number' && typeof b === 'number';
    return [
      label,
      formatBand(a ?? null),
      formatBand(b ?? null),
      valid
        ? h('span', { class: b > a ? 'up' : b < a ? 'down' : '' }, signed(b - a))
        : h('span', null, '–'),
    ];
  };
  return table(
    ['Tiêu chí', 'Bài gốc', 'Viết lại', 'Thay đổi'],
    [
      ...CRITERIA.map((c) =>
        row(criterionLabel(c, taskType), original.criteria?.[c], rewrite.criteria?.[c]),
      ),
      row('Tổng', original.overall, rewrite.overall),
    ],
    'Tiến bộ từ bài gốc đến bài viết lại',
  );
}

function errorList(errors: ErrorView[], onPick: (id: string) => void): HTMLElement {
  if (errors.length === 0) return h('p', null, 'Bài này không có lỗi nào được đánh dấu.');
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
    (essay, reload) => {
      // Older or partial server answers may leave the error list out: show the essay anyway.
      const errors: ErrorView[] = Array.isArray(essay.errors) ? essay.errors : [];
      // The teacher sees whether the student opened the result (the first visit is kept).
      if (essay.status === 'scored' && !essay.resultViewed) {
        void api('essays.markViewed', { id: essay.id }).catch(() => undefined);
      }
      const meta = h(
        'p',
        { class: 'meta' },
        `${taskLabel(essay.taskType)} · ${essay.topic} · ${modeLabel(essay.mode)}`,
        essay.assignmentTitle ? ` · ${essay.assignmentTitle}` : '',
        ' · ',
        statusBadge(essay.studentStatus),
        essay.overTime ? [' ', badge('Quá giờ', 'warning')] : null,
        essay.autoSubmitted ? [' ', badge('Tự nộp khi hết giờ')] : null,
      );
      const facts = h(
        'p',
        { class: 'hint' },
        `Nộp lúc ${formatDateTime(essay.submittedAt)} · ${essay.wordCount} từ`,
        essay.timeUsedSeconds !== null
          ? ` · ${essay.mode === 'practice' ? 'Thời gian viết' : 'Thời gian làm'} ${Math.round(essay.timeUsedSeconds / 60)} phút`
          : '',
      );

      const textBox = h('div');
      let active = '';
      const renderText = () =>
        replace(
          textBox,
          essayText(
            essay.body,
            errors.map((e) => ({
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

      // Result locked: the error practice first, then the page reloads with the full result.
      if (essay.practice && Array.isArray(essay.practice.tasks)) {
        sections.push(practiceView(essay.id, essay.practice.tasks, reload));
        if (essay.rewrite && essay.rewrite.status !== 'waived') {
          sections.push(
            notice(
              'warning',
              `Em cần viết lại trước ${formatDateTime(essay.rewrite.dueAt)}. Chi tiết hiện sau phần luyện lỗi.`,
            ),
          );
        }
        sections.push(
          h('h2', null, 'Đề bài'),
          h('p', { class: 'prompt-text' }, essay.prompt),
          h('h2', null, 'Bài viết của em'),
          textBox,
        );
        return page(essay.parentEssayId ? 'Viết lại' : 'Bài viết', ...sections);
      }

      if (essay.status === 'draft') {
        sections.push(
          notice('info', 'Bài này vẫn là nháp. ', link(`/write/${essay.id}`, 'Viết tiếp')),
        );
      } else if (!essay.score) {
        sections.push(
          notice('info', 'Đã nộp. Thầy/cô sẽ sớm chấm — em sẽ nhận email khi có kết quả.'),
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
              h('span', null, 'Band tổng'),
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
            h('h2', null, 'Cần viết lại'),
            rw.note ? h('p', null, rw.note) : null,
            h(
              'p',
              null,
              `Hạn ${formatDateTime(rw.dueAt)} — `,
              open
                ? countdown(rw.dueAt)
                : rw.status === 'submitted'
                  ? `đã nộp${rw.late ? ' (muộn)' : ''}`
                  : rw.status,
            ),
            open
              ? link(`/rewrite/${essay.id}`, 'Nộp bài viết lại', { class: 'btn btn-primary' })
              : null,
            rw.rewriteEssayId
              ? h('p', null, link(`/essays/${rw.rewriteEssayId}`, 'Xem bài viết lại'))
              : null,
          ),
        );
      }
      if (essay.score && essay.rewriteEssay?.score) {
        sections.push(
          h('h2', null, 'Bài gốc và bài viết lại'),
          comparisonTable(essay.score, essay.rewriteEssay.score, essay.taskType),
        );
      }
      if (essay.parent) {
        sections.push(
          h(
            'p',
            null,
            'Đây là bài viết lại của ',
            link(`/essays/${essay.parent.id}`, 'bài gốc'),
            '.',
          ),
          essay.score && essay.parent.score
            ? comparisonTable(essay.parent.score, essay.score, essay.taskType)
            : null,
        );
      }

      if (essay.score) {
        sections.push(
          h('h2', null, 'Nhận xét'),
          essay.score.generalComment
            ? h('div', { class: 'card' }, markdown(essay.score.generalComment))
            : null,
          ...CRITERIA.filter((c) => essay.score!.feedback?.[c]).map((c) =>
            h(
              'div',
              { class: `card criterion-card crit-${c}` },
              h('h3', null, criterionLabel(c, essay.taskType)),
              markdown(essay.score!.feedback![c]),
            ),
          ),
        );
      }

      sections.push(
        h('h2', null, 'Đề bài'),
        h('p', { class: 'prompt-text' }, essay.prompt),
        essay.hasImage
          ? remoteImage('essays.image', { essayId: essay.id }, 'Biểu đồ của đề này')
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
              h('h2', null, 'Bài viết của em'),
              h('p', { class: 'hint' }, 'Phần tô màu là lỗi đã đánh dấu. Bấm vào để xem cách sửa.'),
              highlightLegend(),
              textBox,
            ),
            h(
              'div',
              null,
              h('h2', null, `Lỗi (${errors.length})`),
              errorList(errors, (id) => {
                active = id;
                renderText();
              }),
            ),
          ),
        );
      } else {
        sections.push(h('h2', null, 'Bài viết của em'), textBox);
      }
      return page(essay.parentEssayId ? 'Viết lại' : 'Bài viết', ...sections);
    },
    'Đang tải bài…',
  );
}
