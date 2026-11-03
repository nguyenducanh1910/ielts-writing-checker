// Lớp học › Kết quả: item analysis (p, D), class score table, penalty file of the month.
import { classroom } from '../../classroomApi';
import { h } from '../../dom';
import { navigate, type RouteContext } from '../../router';
import { async, badge, empty, field, notice, selectEl } from '../../ui/components';
import type { ItemRow, ItemsResponse, PenaltyResponse, ScoreCell, ScoresResponse } from './types';
import { externalLink, money, pageHeader, penaltyCell, skillShort, viDate, viDateTime } from './ui';

type Tab = 'items' | 'scores' | 'penalty';
const TABS: Array<[Tab, string]> = [
  ['items', 'Phân tích câu hỏi'],
  ['scores', 'Bảng điểm'],
  ['penalty', 'Phạt'],
];

const go = (tab: Tab, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams({ tab, ...extra });
  navigate(`/lop/ket-qua?${q.toString()}`);
};

function tone(v: number | null, low: number, mid: number): string {
  if (v === null) return 'cl-muted';
  return v < low ? 'cl-danger' : v < mid ? 'cl-warn' : 'cl-ok';
}

function itemTable(items: ItemRow[]): HTMLElement {
  const f2 = (x: number | null) => (x === null ? '—' : x.toFixed(2));
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'cl-table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          ...[
            'Câu',
            'Đáp án',
            'Đúng / Sai',
            'p (độ khó)',
            'D (phân hoá)',
            'Dự kiến',
            'Sai hay gặp',
            'Chú ý',
          ].map((t) => h('th', { scope: 'col' }, t)),
        ),
      ),
      h(
        'tbody',
        null,
        ...items.map((x) =>
          h(
            'tr',
            { class: x.flags ? 'cl-row-flag' : undefined },
            h('td', null, h('b', null, x.q)),
            h('td', null, x.key),
            h(
              'td',
              null,
              h('span', { class: 'cl-ok' }, String(x.right)),
              ' / ',
              h('span', { class: x.wrong ? 'cl-danger' : 'cl-muted' }, String(x.wrong)),
            ),
            h(
              'td',
              null,
              h('b', { class: tone(x.p, 0.45, 0.65) }, f2(x.p)),
              h('div', { class: 'cl-small' }, x.pLabel),
            ),
            h(
              'td',
              null,
              h('b', { class: tone(x.d, 0.2, 0.3) }, f2(x.d)),
              h('div', { class: 'cl-small' }, x.dLabel),
            ),
            h('td', { class: 'cl-muted' }, x.expected),
            h('td', null, x.common),
            h('td', null, x.flags ? h('b', { class: 'cl-warn' }, x.flags) : null),
          ),
        ),
      ),
    ),
  );
}

function itemsPanel(q: URLSearchParams): HTMLElement {
  return async(
    () => classroom<ItemsResponse>('results.items', { key: q.get('key') ?? '' }),
    (data) => {
      if (!data.selected)
        return empty(
          'Chưa có bài Reading/Listening nào được phân tích. Hệ thống tự phân tích sau hạn nộp.',
        );
      const s = data.selected;
      const sel = selectEl(
        'key',
        data.list.map((g) => ({ value: g.key, label: `${g.title} – ${g.part} · ${g.className}` })),
        s.key,
      );
      sel.addEventListener('change', () => go('items', { key: sel.value }));
      const review = s.items.filter((x) => x.p !== null && x.p < 0.3);
      const check = s.items.filter((x) => /Xem lại/.test(x.flags));
      const worst = s.items
        .filter((x) => x.wrong > 0)
        .sort((a, b) => b.wrong - a.wrong)
        .slice(0, 5);
      const chips = (list: ItemRow[], extra: (x: ItemRow) => string) =>
        list.length
          ? list.map((x) => h('span', { class: 'cl-chip' }, `Câu ${x.q}${extra(x)}`))
          : [h('span', { class: 'cl-muted' }, 'không có')];
      return [
        h('div', { class: 'filters' }, field({ label: 'Bài', control: sel })),
        h(
          'div',
          { class: 'cl-stats' },
          h(
            'div',
            { class: 'cl-stat' },
            h('strong', { class: 'cl-stat-value' }, String(s.summary?.students ?? '–')),
            h('span', { class: 'cl-stat-label' }, 'HS đã làm'),
            s.summary?.notDone ? h('span', { class: 'cl-stat-hint' }, s.summary.notDone) : null,
          ),
          h(
            'div',
            { class: 'cl-stat' },
            h('strong', { class: 'cl-stat-value' }, s.summary?.average ?? '–'),
            h('span', { class: 'cl-stat-label' }, 'Điểm trung bình'),
          ),
          h(
            'div',
            { class: 'cl-stat cl-stat-wide' },
            h('span', { class: 'cl-stat-label' }, 'Phân bố'),
            h('span', null, s.summary?.distribution ?? '–'),
            h('span', { class: 'cl-stat-hint' }, s.summary?.groups ?? ''),
          ),
        ),
        h(
          'div',
          { class: 'cl-flags' },
          h(
            'div',
            { class: 'cl-flag cl-flag-danger' },
            h('b', null, 'Cần chữa kỹ trên lớp (p < 0.30)'),
            h('div', null, ...chips(review, () => '')),
          ),
          h(
            'div',
            { class: 'cl-flag cl-flag-warn' },
            h('b', null, 'Nên xem lại câu hỏi / đáp án (D thấp)'),
            h('div', null, ...chips(check, (x) => (x.d === null ? '' : ` · D ${x.d.toFixed(2)}`))),
          ),
          h(
            'div',
            { class: 'cl-flag' },
            h('b', null, 'Nhiều HS sai nhất'),
            h('div', null, ...chips(worst, (x) => ` · ${x.wrong} sai`)),
          ),
        ),
        itemTable(s.items),
        h(
          'p',
          { class: 'cl-small cl-muted' },
          'p = số HS đúng ÷ số HS làm (≥ 0.65 Dễ · 0.45–0.64 Trung bình · < 0.45 Khó). D = (đúng nhóm G − đúng nhóm Y) ÷ số HS mỗi nhóm (≥ 0.40 Rất tốt · 0.30–0.39 Tốt · 0.20–0.29 Chấp nhận · < 0.20 Kém). ',
          s.updatedAt ? `Cập nhật ${viDateTime(s.updatedAt)}.` : '',
        ),
      ];
    },
    'Đang tải phân tích…',
  );
}

function cellView(cells: ScoreCell[] | undefined): HTMLElement {
  if (!cells?.length) return h('span', { class: 'cl-muted' }, '–');
  const first = cells[0];
  if (/Chưa/.test(first.status)) return badge('Chưa nộp', 'danger');
  return h(
    'div',
    { class: 'cl-cell' },
    ...cells.map((c) => {
      const val = c.band
        ? `${c.band}`
        : c.score || (c.gradeKind === 'web' ? 'web' : c.gradeKind === 'review' ? 'chờ duyệt' : '·');
      return h(
        'span',
        {
          class: `cl-cell-part ${c.gradeKind === 'error' ? 'cl-danger' : ''}`,
          title: `${c.skill}: ${c.score || c.band || c.gradeKind}`,
        },
        h('span', { class: 'cl-small cl-muted' }, skillShort(c.skill).replace(/^(\w)\w+/, '$1')),
        ' ',
        val,
      );
    }),
    /muộn/i.test(first.status) ? h('span', { class: 'cl-small cl-warn' }, 'muộn') : null,
  );
}

function scoresPanel(q: URLSearchParams): HTMLElement {
  return async(
    () => classroom<ScoresResponse>('results.scores', { courseId: q.get('courseId') ?? '' }),
    (data) => {
      const sel = selectEl(
        'courseId',
        data.classes.map((c) => ({ value: c.id, label: c.name })),
        data.courseId,
      );
      sel.addEventListener('change', () => go('scores', { courseId: sel.value }));
      if (!data.students.length)
        return [
          h('div', { class: 'filters' }, field({ label: 'Lớp', control: sel })),
          empty('Lớp này chưa có bài nộp.'),
        ];
      return [
        h('div', { class: 'filters' }, field({ label: 'Lớp', control: sel })),
        h(
          'div',
          { class: 'table-wrap cl-sticky-first' },
          h(
            'table',
            { class: 'cl-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', { scope: 'col' }, 'Học sinh'),
                ...data.assignments.map((a) =>
                  h(
                    'th',
                    { scope: 'col' },
                    a.title,
                    h('div', { class: 'cl-small cl-muted' }, viDate(a.dueAt)),
                  ),
                ),
              ),
            ),
            h(
              'tbody',
              null,
              ...data.students.map((s) =>
                h(
                  'tr',
                  null,
                  h('th', { scope: 'row' }, s.name),
                  ...data.assignments.map((a) => h('td', null, cellView(s.cells[a.id]))),
                ),
              ),
            ),
          ),
        ),
        h(
          'p',
          { class: 'cl-small cl-muted' },
          'R/L: số câu đúng · W/S: band. "chờ duyệt": Speaking AI đã chấm, bạn chưa duyệt.',
        ),
      ];
    },
    'Đang tải bảng điểm…',
  );
}

function penaltyPanel(q: URLSearchParams): HTMLElement {
  return async(
    () =>
      classroom<PenaltyResponse>('penalty.class', {
        courseId: q.get('courseId') ?? '',
        month: q.get('month') ?? '',
      }),
    (data) => {
      if (!data.columns || !data.rows)
        return notice('info', data.message ?? 'Chưa có dữ liệu phạt.');
      const sel = selectEl(
        'courseId',
        data.classes.map((c) => ({ value: c.id, label: c.name })),
        data.courseId ?? '',
      );
      sel.addEventListener('change', () => go('penalty', { courseId: sel.value }));
      const tabSel = selectEl(
        'month',
        (data.tabs ?? []).map((t) => ({ value: /T0?(\d+)/i.exec(t)?.[1] ?? '', label: t })),
        /T0?(\d+)/i.exec(data.tab ?? '')?.[1] ?? '',
      );
      tabSel.addEventListener('change', () =>
        go('penalty', { courseId: sel.value, month: tabSel.value }),
      );
      const cols = data.columns;
      const weeks = [...new Set(cols.map((c) => c.week))];
      const fined = data.rows.filter((r) => r.fine > 0);
      return [
        h(
          'div',
          { class: 'filters' },
          field({ label: 'Lớp', control: sel }),
          field({ label: 'Tháng', control: tabSel }),
          data.url ? h('p', null, externalLink(data.url, 'Mở file phạt ↗', 'btn')) : null,
        ),
        h(
          'div',
          { class: 'cl-stats' },
          h(
            'div',
            { class: 'cl-stat cl-stat-warn' },
            h('strong', { class: 'cl-stat-value' }, money(data.total ?? 0)),
            h('span', { class: 'cl-stat-label' }, `Tổng phạt ${data.tab}`),
          ),
          h(
            'div',
            { class: 'cl-stat' },
            h('strong', { class: 'cl-stat-value' }, `${fined.length}/${data.rows.length}`),
            h('span', { class: 'cl-stat-label' }, 'HS bị phạt'),
          ),
          ...weeks.filter(Boolean).map((w) => {
            const sum = data.rows!.reduce((s, r) => s + (r.weeks[w] ?? 0), 0);
            return h(
              'div',
              { class: 'cl-stat' },
              h('strong', { class: 'cl-stat-value' }, money(sum)),
              h('span', { class: 'cl-stat-label' }, w),
            );
          }),
        ),
        h(
          'div',
          { class: 'table-wrap cl-sticky-first' },
          h(
            'table',
            { class: 'cl-table cl-pen-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', { scope: 'col' }, 'Học sinh'),
                h('th', { scope: 'col' }, 'Phạt'),
                ...cols.map((c) =>
                  h(
                    'th',
                    { scope: 'col', title: `${c.week} · ${c.session} ${c.skill}` },
                    c.session,
                    h('div', { class: 'cl-small cl-muted' }, c.skill.charAt(0).toUpperCase()),
                  ),
                ),
              ),
            ),
            h(
              'tbody',
              null,
              ...data.rows.map((r) =>
                h(
                  'tr',
                  null,
                  h('th', { scope: 'row' }, r.name),
                  h(
                    'td',
                    null,
                    r.fine
                      ? h('b', { class: 'cl-danger' }, money(r.fine))
                      : h('span', { class: 'cl-muted' }, '0'),
                  ),
                  ...r.values.map((v) => h('td', { class: 'cl-pen-td' }, penaltyCell(v))),
                ),
              ),
            ),
          ),
        ),
        h(
          'p',
          { class: 'cl-small cl-muted' },
          '✓ Done · Muộn: nộp muộn (không phạt) · 10k: Missed. Dữ liệu đọc thẳng từ file phạt (gồm cả ô bạn tự sửa), làm mới mỗi 5 phút.',
        ),
      ];
    },
    'Đang đọc file phạt…',
  );
}

export function resultsPage(ctx: RouteContext): Node {
  const tab = (TABS.find(([t]) => t === ctx.query.get('tab'))?.[0] ?? 'items') as Tab;
  return h(
    'section',
    { class: 'page cl-page' },
    pageHeader(
      'Kết quả & phạt',
      'Phân tích câu hỏi Reading/Listening, điểm từng học sinh, tổng hợp phạt.',
    ),
    h(
      'nav',
      { class: 'cl-views', 'aria-label': 'Chọn mục' },
      ...TABS.map(([t, label]) => {
        const q = new URLSearchParams({ tab: t });
        const cid = ctx.query.get('courseId');
        if (cid && t !== 'items') q.set('courseId', cid);
        return h(
          'a',
          { href: `#/lop/ket-qua?${q.toString()}`, 'aria-current': t === tab ? 'page' : null },
          label,
        );
      }),
    ),
    tab === 'items'
      ? itemsPanel(ctx.query)
      : tab === 'scores'
        ? scoresPanel(ctx.query)
        : penaltyPanel(ctx.query),
  );
}
