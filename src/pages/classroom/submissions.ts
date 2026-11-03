// Lớp học › Bài nộp: review AI-graded Speaking, fix "cần kiểm tra tay" rows, see who has not submitted.
import { classroom } from '../../classroomApi';
import { h, replace } from '../../dom';
import { navigate, type RouteContext } from '../../router';
import {
  async,
  busy,
  confirmDialog,
  empty,
  errorBox,
  field,
  link,
  loading,
  notice,
  selectEl,
  toast,
} from '../../ui/components';
import type { Submission, SubmissionFile, SubmissionList, SubmissionView } from './types';
import { externalLink, gradeBadge, pageHeader, skillShort, submitBadge, viDateTime } from './ui';

const VIEWS: Array<[SubmissionView, string]> = [
  ['review', 'Chờ duyệt'],
  ['error', 'Cần kiểm tra tay'],
  ['approved', 'Đã duyệt'],
  ['web', 'Writing trên web'],
  ['missing', 'Chưa nộp'],
  ['all', 'Tất cả'],
];

const FILTER_KEYS = ['courseId', 'courseWorkId', 'q'] as const;

function withQuery(base: Record<string, string>, patch: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) q.set(k, v);
  const s = q.toString();
  return `/lop/bai-nop${s ? `?${s}` : ''}`;
}

/** A link stored as "<writing site>#/admin/score/<id>" opens inside this site. */
function writingScoreLink(url: string): HTMLElement | null {
  const m = /#(\/admin\/score\/[\w-]+)/.exec(url);
  if (m) return link(m[1], 'Chấm trên web Writing →', { class: 'btn btn-primary btn-small' });
  return url ? externalLink(url, 'Mở file nhận xét ↗', 'btn btn-small') : null;
}

function fileList(sub: Submission): HTMLElement {
  const box = h('div', { class: 'cl-files' }, loading('Đang đọc danh sách file…'));
  classroom<{ files: SubmissionFile[] }>('submissions.files', { id: sub.id }).then(
    ({ files }) =>
      replace(
        box,
        files.length
          ? h(
              'ul',
              { class: 'cl-file-list' },
              ...files.map((f) =>
                h(
                  'li',
                  { class: `cl-file cl-file-${f.kind}` },
                  h('span', { class: 'cl-file-icon', 'aria-hidden': 'true' }, ICON[f.kind] ?? '📄'),
                  externalLink(f.url, f.name),
                  f.size
                    ? h('span', { class: 'cl-muted' }, ` · ${(f.size / 1e6).toFixed(1)} MB`)
                    : null,
                  f.kind === 'audio' ? h('span', { class: 'badge badge-info' }, 'Ghi âm') : null,
                ),
              ),
            )
          : h('p', { class: 'cl-muted' }, 'Học sinh không đính kèm file nào.'),
      ),
    (err) => replace(box, errorBox(err)),
  );
  return box;
}

const ICON: Record<string, string> = {
  audio: '🎧',
  video: '🎬',
  image: '🖼️',
  doc: '📄',
  error: '⚠️',
};

function detail(sub: Submission, onChange: (s: Submission) => void): HTMLElement {
  const panel = h('div', { class: 'cl-detail' });
  const editable = !sub.sentAt && ['review', 'approved', 'graded'].includes(sub.gradeKind);
  const isAI = /^Speaking|^Writing/.test(sub.skill) && sub.gradeKind !== 'web';

  if (sub.gradeKind === 'error' || sub.gradeKind === 'skipped') {
    panel.append(notice(sub.gradeKind === 'error' ? 'error' : 'info', sub.gradeStatus));
  }
  if (sub.status && /Chưa/.test(sub.status)) {
    panel.append(h('p', { class: 'cl-muted' }, 'Học sinh chưa nộp bài này.'));
  }
  if (sub.turnedInAt) {
    panel.append(h('h4', null, 'File học sinh nộp'), fileList(sub));
  }
  if (sub.gradeKind === 'web') {
    panel.append(
      notice(
        'info',
        'Bài Writing này được chấm trên web Writing. Điểm sẽ tự về đây sau khi bạn gửi kết quả trên web.',
      ),
      h('p', null, writingScoreLink(sub.feedbackFile)),
    );
    return panel;
  }

  const band = h('input', {
    type: 'number',
    name: 'band',
    min: '0',
    max: '9',
    step: '0.5',
    value: sub.band,
    disabled: !editable || !isAI,
  });
  const summary = h('textarea', { name: 'summary', rows: '6', disabled: !editable }, sub.summary);
  const scoreBox = h(
    'div',
    { class: 'cl-score-row' },
    sub.score
      ? h('div', { class: 'cl-score' }, h('span', null, 'Điểm'), h('strong', null, sub.score))
      : null,
    isAI || sub.band
      ? field({
          label: 'Band',
          control: band,
          hint: editable && isAI ? 'Sửa nếu AI chấm lệch (bước 0.5)' : undefined,
        })
      : null,
  );
  panel.append(
    h('h4', null, 'Kết quả'),
    scoreBox,
    field({
      label: 'Nhận xét tóm tắt (gửi cho học sinh)',
      control: summary,
      hint: editable ? 'Dòng bắt đầu bằng "-" sẽ thành gạch đầu dòng trong email.' : undefined,
    }),
    sub.feedbackFile && !/#\/admin\/score/.test(sub.feedbackFile)
      ? h('p', null, externalLink(sub.feedbackFile, 'Mở file nhận xét chi tiết (AI) ↗'))
      : '',
  );

  const actions = h('div', { class: 'actions' });
  const save = async (extra: Record<string, unknown>, btn: HTMLButtonElement, text: string) => {
    await busy(btn, text, async () => {
      try {
        const payload: Record<string, unknown> = { id: sub.id, summary: summary.value, ...extra };
        if (isAI) payload.band = band.value;
        const res = await classroom<{ message: string; row: Submission }>(
          'submissions.update',
          payload,
        );
        toast(res.message);
        onChange(res.row);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Lỗi', 'error');
      }
    });
  };
  if (editable) {
    const bSave = h('button', { type: 'button', class: 'btn' }, 'Lưu');
    bSave.addEventListener('click', () => void save({}, bSave, 'Đang lưu…'));
    const bSend = h('button', { type: 'button', class: 'btn btn-primary' }, 'Duyệt & gửi ngay');
    bSend.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Gửi kết quả cho học sinh?',
        message: `${sub.student} sẽ nhận email kết quả ${sub.title} – ${sub.skill}. Sau khi gửi không sửa được nữa.`,
        confirmLabel: 'Gửi ngay',
        cancelLabel: 'Huỷ',
      });
      if (ok) void save({ approve: true, sendNow: true }, bSend, 'Đang gửi…');
    });
    actions.append(bSave);
    if (!sub.approved) {
      const bApprove = h('button', { type: 'button', class: 'btn' }, 'Duyệt (gửi ở lần chạy tới)');
      bApprove.addEventListener('click', () => void save({ approve: true }, bApprove, 'Đang lưu…'));
      actions.append(bApprove);
    } else {
      const bUn = h('button', { type: 'button', class: 'btn' }, 'Bỏ duyệt');
      bUn.addEventListener('click', () => void save({ approve: false }, bUn, 'Đang lưu…'));
      actions.append(bUn);
    }
    actions.append(bSend);
  }
  if (
    !sub.sentAt &&
    ['error', 'skipped', 'review', 'graded'].includes(sub.gradeKind) &&
    sub.turnedInAt
  ) {
    const bRe = h('button', { type: 'button', class: 'btn' }, 'Chấm lại');
    bRe.addEventListener(
      'click',
      () =>
        void busy(bRe, 'Đang xử lý…', async () => {
          try {
            const r = await classroom<{ message: string }>('submissions.regrade', { id: sub.id });
            toast(r.message);
            onChange({ ...sub, gradeKind: 'waiting', gradeStatus: 'Chờ chấm' });
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Lỗi', 'error');
          }
        }),
    );
    actions.append(bRe);
  }
  if (sub.sentAt)
    actions.append(
      h('p', { class: 'cl-muted' }, `Đã gửi cho học sinh lúc ${viDateTime(sub.sentAt)}.`),
    );
  panel.append(actions);
  return panel;
}

function card(sub: Submission): HTMLElement {
  const el = h('article', { class: 'cl-sub' });
  const render = (s: Submission, open: boolean) => {
    const panelId = `sub-${s.id.replace(/[^\w-]/g, '_')}`;
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'cl-sub-head',
        'aria-expanded': String(open),
        'aria-controls': panelId,
      },
      h(
        'span',
        { class: 'cl-sub-who' },
        h('b', null, s.student),
        h('span', { class: 'cl-muted' }, `${s.title} · ${skillShort(s.skill)} · ${s.className}`),
      ),
      h(
        'span',
        { class: 'cl-sub-meta' },
        s.band
          ? h('span', { class: 'cl-band' }, `Band ${s.band}`)
          : s.score
            ? h('span', { class: 'cl-band' }, s.score)
            : null,
        submitBadge(s.status),
        s.turnedInAt ? gradeBadge(s.gradeKind) : null,
        h(
          'span',
          { class: 'cl-muted cl-time' },
          s.turnedInAt ? viDateTime(s.turnedInAt) : `hạn ${viDateTime(s.dueAt)}`,
        ),
      ),
    );
    const body = h('div', { id: panelId, hidden: !open });
    if (open) body.append(detail(s, (next) => render(next, true)));
    toggle.addEventListener('click', () => render(s, !open));
    replace(el, toggle, body);
  };
  render(sub, false);
  return el;
}

export function submissionsPage(ctx: RouteContext): Node {
  const q = ctx.query;
  const view = (VIEWS.find(([v]) => v === q.get('view'))?.[0] ?? 'review') as SubmissionView;
  const filters: Record<string, string> = Object.fromEntries(
    FILTER_KEYS.map((k) => [k, q.get(k) ?? '']),
  );
  return h(
    'section',
    { class: 'page cl-page' },
    async(
      () => classroom<SubmissionList>('submissions.list', { view, ...filters }),
      (data, reload) => {
        const sendAll = h(
          'button',
          { type: 'button', class: 'btn btn-primary', hidden: !data.counts.approved },
          `Gửi ${data.counts.approved} bài đã duyệt`,
        );
        sendAll.addEventListener(
          'click',
          () =>
            void busy(sendAll, 'Đang gửi…', async () => {
              try {
                const r = await classroom<{ message: string }>('submissions.sendApproved');
                toast(r.message);
                reload();
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Lỗi', 'error');
              }
            }),
        );
        const classSel = selectEl(
          'courseId',
          data.classes.map((c) => ({ value: c.id, label: c.name })),
          filters.courseId,
          'Tất cả lớp',
        );
        const cwSel = selectEl(
          'courseWorkId',
          data.assignments.map((a) => ({ value: a.id, label: `${a.title} · ${a.className}` })),
          filters.courseWorkId,
          'Tất cả bài',
        );
        const search = h('input', {
          type: 'search',
          name: 'q',
          value: filters.q,
          placeholder: 'Tên hoặc email HS',
        });
        const apply = () =>
          navigate(
            withQuery(
              { view },
              { courseId: classSel.value, courseWorkId: cwSel.value, q: search.value.trim() },
            ),
          );
        classSel.addEventListener('change', apply);
        cwSel.addEventListener('change', apply);
        search.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') apply();
        });
        return [
          pageHeader(
            'Bài nộp',
            'Duyệt Speaking, xử lý bài cần kiểm tra tay, xem ai chưa nộp.',
            sendAll,
          ),
          h(
            'nav',
            { class: 'cl-views', 'aria-label': 'Lọc bài nộp' },
            ...VIEWS.map(([v, label]) =>
              h(
                'a',
                {
                  href: `#${withQuery({ ...filters, view: v }, {})}`,
                  'aria-current': v === view ? 'page' : null,
                },
                label,
                h('span', { class: 'cl-count' }, String(data.counts[v] ?? 0)),
              ),
            ),
          ),
          h(
            'div',
            { class: 'filters' },
            field({ label: 'Lớp', control: classSel }),
            field({ label: 'Bài tập', control: cwSel }),
            field({ label: 'Tìm học sinh', control: search }),
          ),
          data.rows.length
            ? h(
                'div',
                { class: 'cl-sub-list' },
                ...data.rows.map(card),
                data.total > data.rows.length
                  ? h(
                      'p',
                      { class: 'cl-muted' },
                      `Đang hiện ${data.rows.length}/${data.total} bài. Lọc theo lớp hoặc bài để xem thêm.`,
                    )
                  : null,
              )
            : empty(
                view === 'review'
                  ? 'Không có bài nào chờ duyệt.'
                  : 'Không có bài nào trong mục này.',
              ),
        ];
      },
      'Đang tải bài nộp…',
    ),
  );
}
