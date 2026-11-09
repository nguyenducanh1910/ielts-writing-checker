// Progress: band over time per skill, recurring mistakes (from the Teacher's Book "expected
// error" of each wrong question) and recent wrong Reading/Listening answers to review.
// Students see their own (results already emailed); the teacher picks any student.
import { classroom } from '../../classroomApi';
import { h, replace } from '../../dom';
import { navigate } from '../../router';
import type { RouteContext } from '../../router';
import { COLORS, chartBox } from '../../ui/charts';
import { async, empty, field, notice, selectEl } from '../../ui/components';
import type { Progress, ProgressPoint, StudentListItem } from './types';
import { pageHeader, statTile, viDate } from './ui';

const SKILLS: ProgressPoint['skill'][] = ['Reading', 'Listening', 'Writing', 'Speaking'];
const SKILL_COLOR: Record<string, string> = {
  Reading: COLORS.palette[0],
  Listening: COLORS.palette[1],
  Writing: COLORS.palette[2],
  Speaking: COLORS.palette[3],
};

function signed(x: number): string {
  if (!x) return '±0';
  return `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
}

/** One line per skill; x axis = assignments in date order. */
export function progressChart(points: ProgressPoint[]): HTMLElement {
  const labels: string[] = [];
  points.forEach((p) => {
    if (!labels.includes(p.title)) labels.push(p.title);
  });
  const present = SKILLS.filter((s) => points.some((p) => p.skill === s));
  return chartBox(
    {
      type: 'line',
      data: {
        labels,
        datasets: present.map((skill) => ({
          label: skill,
          data: labels.map(
            (t) => points.find((p) => p.title === t && p.skill === skill)?.band ?? null,
          ),
          borderColor: SKILL_COLOR[skill],
          backgroundColor: SKILL_COLOR[skill],
          spanGaps: true,
          tension: 0.2,
          pointRadius: 4,
        })),
      },
      options: { scales: { y: { min: 2, max: 9, ticks: { stepSize: 0.5 } } } },
    },
    `Band theo thời gian: ${present
      .map((s) => {
        const xs = points.filter((p) => p.skill === s);
        return `${s} ${xs.length} bài, gần nhất ${xs[xs.length - 1].band}`;
      })
      .join('; ')}.`,
    {
      headers: ['Ngày', 'Bài', 'Kỹ năng', 'Band', 'Điểm'],
      rows: points.map((p) => [viDate(p.at), p.title, p.skill, String(p.band), p.score || '–']),
    },
  );
}

function reviewList(d: Progress): HTMLElement {
  const items = d.review ?? [];
  if (!items.length) return empty('Không có câu sai nào trong 3 tuần gần đây. Tốt lắm!');
  const groups = new Map<string, typeof items>();
  items.forEach((x) => {
    const k = `${x.title} – ${x.skill}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  });
  return h(
    'div',
    { class: 'cl-review', 'data-testid': 'review' },
    ...[...groups.entries()].map(([title, xs]) =>
      h(
        'div',
        { class: 'cl-review-group' },
        h('h3', null, title, h('span', { class: 'cl-muted' }, ` · ${viDate(xs[0].at)}`)),
        h(
          'ul',
          null,
          ...xs.map((x) => {
            const answer = h(
              'div',
              { class: 'cl-review-answer', hidden: true },
              h('p', null, 'Đáp án: ', h('b', { class: 'cl-ok' }, x.key)),
              x.err ? h('p', { class: 'cl-muted' }, `Lỗi hay gặp: ${x.err}`) : null,
              x.explanation ? h('p', { class: 'cl-pre' }, x.explanation) : null,
            );
            const show = h('button', { type: 'button', class: 'btn btn-small' }, 'Xem đáp án');
            show.addEventListener('click', () => {
              answer.hidden = !answer.hidden;
              show.textContent = answer.hidden ? 'Xem đáp án' : 'Ẩn đáp án';
            });
            return h(
              'li',
              { class: 'cl-review-item' },
              h(
                'div',
                { class: 'cl-review-head' },
                h('b', null, `Câu ${x.q}`),
                h('span', null, ' · em đã trả lời: '),
                h('span', { class: 'cl-danger' }, x.given || '(bỏ trống)'),
                show,
              ),
              answer,
            );
          }),
        ),
      ),
    ),
  );
}

export function progressView(d: Progress, teacher = false): HTMLElement {
  if (!d.matched || !d.points) {
    return notice(
      'info',
      teacher
        ? `Chưa có kết quả nào của ${d.email}.`
        : 'Chưa có kết quả nào. Điểm sẽ hiện sau khi thầy/cô gửi kết quả qua email.',
    );
  }
  const by = d.bySkill ?? {};
  const tiles = SKILLS.filter((s) => by[s]).map((s) =>
    statTile({
      value: by[s].latest.toFixed(1),
      label: `${s} gần nhất`,
      hint: `TB ${by[s].average.toFixed(1)} · ${by[s].count} bài · ${signed(by[s].change)} so với bài đầu`,
      tone: by[s].change > 0 ? 'ok' : by[s].change < 0 ? 'warn' : '',
    }),
  );
  const acc =
    d.answered && d.answered > 0
      ? Math.round(((d.answered - (d.wrongTotal ?? 0)) / d.answered) * 100)
      : null;
  return h(
    'div',
    { class: 'cl-progress-view' },
    h(
      'div',
      { class: 'cl-stats' },
      ...tiles,
      acc !== null ? statTile({ value: `${acc}%`, label: 'Đúng (Reading + Listening)' }) : null,
    ),
    h('h2', null, 'Band theo thời gian'),
    Array.isArray(d.points) && d.points.length ? progressChart(d.points) : empty('Chưa có band nào.'),
    h('h2', null, 'Lỗi hay lặp lại'),
    Array.isArray(d.errors) && d.errors.length
      ? h(
          'ul',
          { class: 'cl-err-bars' },
          ...d.errors.map((e) =>
            h(
              'li',
              null,
              h('span', { class: 'cl-err-label' }, e.label),
              h(
                'span',
                { class: 'cl-err-bar' },
                h('span', {
                  style: `width:${Math.round((e.count / Math.max(1, d.errors![0].count)) * 100)}%`,
                }),
              ),
              h('b', null, `${e.count} câu`),
            ),
          ),
        )
      : h(
          'p',
          { class: 'cl-muted' },
          'Chưa đủ dữ liệu (cần Teacher\'s Book có cột "Lỗi dự kiến" cho các câu).',
        ),
    h('h2', null, teacher ? 'Câu sai gần đây (3 tuần)' : 'Ôn lại câu sai (3 tuần gần đây)'),
    teacher
      ? null
      : h(
          'p',
          { class: 'cl-muted cl-small' },
          'Thử tự trả lời lại trước, rồi bấm "Xem đáp án" để kiểm tra.',
        ),
    reviewList(d),
  );
}

export function studentProgressPage(): Node {
  return h(
    'section',
    { class: 'page cl-page' },
    async(
      () => classroom<Progress>('me.progress'),
      (d) => [
        pageHeader('Tiến bộ & ôn tập', d.name ? `${d.name} · ${d.className ?? ''}` : undefined),
        progressView(d),
      ],
      'Đang tải…',
    ),
  );
}

export function teacherProgressPage(ctx: RouteContext): Node {
  const email = ctx.query.get('email') ?? '';
  const detail = h('div', { 'aria-live': 'polite' });
  return h(
    'section',
    { class: 'page cl-page' },
    async(
      () => classroom<{ students: StudentListItem[] }>('student.list'),
      (list) => {
        const sel = selectEl(
          'email',
          list.students.map((s) => ({ value: s.email, label: `${s.name} · ${s.className}` })),
          email,
          'Chọn học sinh…',
        );
        sel.addEventListener('change', () =>
          navigate(
            sel.value ? `/lop/hoc-sinh?email=${encodeURIComponent(sel.value)}` : '/lop/hoc-sinh',
          ),
        );
        if (email) {
          replace(
            detail,
            async(
              () => classroom<Progress>('student.progress', { email }),
              (d) => progressView(d, true),
              'Đang tải…',
            ),
          );
        } else {
          replace(
            detail,
            empty('Chọn một học sinh để xem band theo thời gian, lỗi hay gặp và câu sai gần đây.'),
          );
        }
        return [
          pageHeader('Học sinh', 'Tiến bộ của từng học sinh (kể cả kết quả chưa gửi).'),
          h('div', { class: 'card cl-form' }, field({ label: 'Học sinh', control: sel })),
          detail,
        ];
      },
      'Đang tải danh sách học sinh…',
    ),
  );
}
