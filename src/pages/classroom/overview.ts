// Lớp học › Tổng quan: what needs the teacher today, assignments around now, classes, recent activity.
import { api } from '../../api';
import { classroom } from '../../classroomApi';
import { type Child, h, replace } from '../../dom';
import { async, busy, empty, errorBox, link, notice } from '../../ui/components';
import { newClassesSection, refreshClassesButton } from './newClasses';
import type { QueueItem, QueueResponse } from '../admin/types';
import type { Health, Overview, OverviewAssignment, TodoItem } from './types';
import { dueText, externalLink, pageHeader, progress, statTile, viDateTime } from './ui';

async function load() {
  const [ov, queue] = await Promise.all([
    classroom<Overview>('overview'),
    api<QueueResponse>('admin.queue', {}).catch(() => null),
  ]);
  const waiting = queue ? queue.items.filter((x) => !x.scoredAt) : null;
  return { ov, writing: waiting };
}

function assignmentCard(a: OverviewAssignment): HTMLElement {
  const submitted = a.onTime + a.late;
  const past = Date.parse(a.dueAt) < Date.now();
  const missingBox = a.missingNames.length
    ? h(
        'details',
        { class: 'cl-missing' },
        h('summary', null, `${a.missingNames.length} HS chưa nộp`),
        h('p', null, a.missingNames.join(', ')),
      )
    : h('p', { class: 'cl-muted' }, 'Tất cả đã nộp.');
  return h(
    'article',
    { class: 'cl-assign' },
    h(
      'div',
      { class: 'cl-assign-head' },
      h(
        'div',
        null,
        h('h3', null, a.title),
        h('p', { class: 'cl-muted' }, `${a.className} · hạn ${viDateTime(a.dueAt)}`),
      ),
      h('span', { class: `cl-due ${past ? 'cl-due-past' : 'cl-due-open'}` }, dueText(a.dueAt)),
    ),
    progress(
      [
        { value: a.onTime, tone: 'ok' },
        { value: a.late, tone: 'warn' },
      ],
      a.total,
      `${submitted}/${a.total} đã nộp`,
    ),
    h(
      'p',
      { class: 'cl-counts' },
      h('b', { class: 'cl-ok' }, String(a.onTime)),
      ' đúng hạn · ',
      h('b', { class: 'cl-warn' }, String(a.late)),
      ' muộn · ',
      h('b', { class: a.missing ? 'cl-danger' : 'cl-muted' }, String(a.missing)),
      ' chưa nộp',
    ),
    missingBox,
    h(
      'p',
      { class: 'cl-links' },
      link(`/lop/bai-nop?view=all&courseWorkId=${encodeURIComponent(a.id)}`, 'Xem bài nộp'),
      a.link ? externalLink(a.link, 'Mở trên Classroom ↗') : null,
    ),
  );
}

/** "Hệ thống": result of the daily health check, with a button to run it now. */
function runtimeLine(rt: Overview['runtime']): Child {
  if (!rt) return null;
  const high = rt.usedMin >= rt.warnMin;
  return h(
    'p',
    { class: high ? 'cl-danger' : 'cl-muted', 'data-testid': 'runtime' },
    `Chạy tự động hôm nay: khoảng ${rt.usedMin}/${rt.limitMin} phút`,
    high ? ' — đã tạm dừng lượt cập nhật nhanh tới hết ngày.' : '.',
    ' ',
    rt.lastBackup
      ? `Sao lưu gần nhất: ${viDateTime(rt.lastBackup)}.`
      : 'Chưa sao lưu lần nào (tự sao lưu đêm Chủ nhật).',
  );
}

export function healthCard(
  initial: Health | null | undefined,
  runtime?: Overview['runtime'],
): HTMLElement {
  const body = h('div');
  const show = (x: Health | null | undefined) =>
    replace(
      body,
      !x
        ? h('p', { class: 'cl-muted' }, 'Chưa kiểm tra lần nào (tự chạy cùng báo cáo ngày).')
        : x.ok
          ? h(
              'p',
              { class: 'cl-ok' },
              `✓ Mọi thứ bình thường · kiểm tra ${viDateTime(x.checkedAt)}`,
            )
          : [
              h(
                'p',
                { class: 'cl-danger' },
                h('b', null, `Cần xử lý · kiểm tra ${viDateTime(x.checkedAt)}`),
              ),
              h('ul', { class: 'cl-health-list' }, ...x.problems.map((p) => h('li', null, p))),
            ],
      x?.notes.length ? h('p', { class: 'cl-muted' }, x.notes.join(' ')) : null,
    );
  show(initial);
  const btn = h('button', { type: 'button', class: 'btn btn-small' }, 'Kiểm tra ngay');
  btn.addEventListener('click', () =>
    busy(btn, 'Đang kiểm tra…', async () => {
      try {
        show(await classroom<Health>('system.health'));
      } catch (err) {
        replace(body, errorBox(err));
      }
    }),
  );
  return h(
    'div',
    { class: 'cl-health', 'data-testid': 'health' },
    h('h2', null, 'Hệ thống'),
    body,
    runtimeLine(runtime),
    btn,
  );
}

export function overviewPage(): Node {
  return h(
    'section',
    { class: 'page cl-page' },
    async(
      load,
      ({ ov, writing }, reload) => overviewContent(ov, writing, reload),
      'Đang tải dữ liệu lớp học…',
    ),
  );
}

/** "Việc cần làm hôm nay": what the stat tiles cannot show by name. */
function todoSection(ov: Overview, writing: QueueItem[]): Child {
  const manual = ov.todoItems?.manual ?? [];
  const form = ov.todoItems?.formPending ?? [];
  if (!manual.length && !form.length && !writing.length) return null;
  const essayLine = (x: QueueItem) =>
    h(
      'li',
      null,
      link(`/admin/score/${x.id}`, x.studentName),
      ` — ${x.assignmentTitle ?? x.topic}`,
      h('span', { class: 'muted' }, ` · nộp ${viDateTime(x.submittedAt)}`),
    );
  const line = (x: TodoItem, detail: string, view: string) =>
    h(
      'li',
      null,
      link(`/lop/bai-nop?view=${view}&q=${encodeURIComponent(x.student)}`, x.student),
      ` — ${x.title} · ${x.className}`,
      detail ? h('span', { class: 'muted' }, ` · ${detail}`) : null,
    );
  const reason = (s: string) => s.replace(/^(Lỗi[^:]*:|Bỏ qua:)\s*/, '').slice(0, 120);
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'todo-heading' },
    h('h2', { id: 'todo-heading' }, 'Việc cần làm hôm nay'),
    writing.length
      ? [
          h('h3', null, `Writing chờ chấm (${writing.length})`),
          h('ul', null, ...writing.slice(0, 15).map(essayLine)),
          writing.length > 15 ? h('p', null, link('/admin', 'Xem cả hàng chờ →')) : null,
        ]
      : null,
    manual.length
      ? [
          h('h3', null, `Cần xem tay (${manual.length})`),
          h('ul', null, ...manual.map((x) => line(x, `${x.skill}: ${reason(x.status)}`, 'error'))),
        ]
      : null,
    form.length
      ? [
          h('h3', null, `Đã làm Form nhưng chưa bấm Nộp (${form.length})`),
          h('p', { class: 'muted' }, 'Hệ thống đã nhắc các em trong email nhắc nộp bài lúc 19h.'),
          h('ul', null, ...form.map((x) => line(x, x.skill, 'missing'))),
        ]
      : null,
  );
}

/** Fetch what students just turned in on Classroom (the system also does it every 10 minutes). */
function syncNowButton(reload: () => void): HTMLElement {
  const status = h('span', { class: 'cl-muted', 'aria-live': 'polite' });
  const btn = h('button', { type: 'button', class: 'btn' }, 'Cập nhật bài nộp ngay');
  btn.addEventListener('click', () =>
    busy(btn, 'Đang cập nhật…', async () => {
      try {
        const r = await classroom<{ message: string; busy?: boolean }>('sync.now');
        if (r.busy) replace(status, ` ${r.message}`);
        else reload();
      } catch (err) {
        replace(status, errorBox(err));
      }
    }),
  );
  return h('span', null, btn, status);
}

function overviewContent(ov: Overview, writing: QueueItem[] | null, reload: () => void): Child[] {
  const writingQueue = writing ? writing.length : null;
  const today = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const t = ov.todo;
  const upcoming = ov.assignments.filter((a) => Date.parse(a.dueAt) >= Date.now());
  const recent = ov.assignments.filter((a) => Date.parse(a.dueAt) < Date.now()).reverse();
  return [
    pageHeader(
      ov.teacherName ? `Chào ${ov.teacherName}` : 'Tổng quan',
      today.charAt(0).toUpperCase() + today.slice(1),
      link('/lop/giao-bai', 'Giao bài mới', { class: 'btn btn-primary' }),
      syncNowButton(reload),
      externalLink(ov.sheetUrl, 'Mở Google Sheet ↗', 'btn'),
    ),
    ov.aiDownSince && Date.now() - Date.parse(ov.aiDownSince) > 3 * 3600e3
      ? notice(
          'warning',
          `Gemini quá tải từ ${viDateTime(ov.aiDownSince)}: bài Speaking và bài viết tay đang chờ chấm (các bài khác vẫn chấm bình thường). Hệ thống tự thử lại mỗi giờ; có thể đổi "Model Gemini" trong sheet Cấu hình sang gemini-flash-lite-latest.`,
        )
      : null,
    newClassesSection(ov.newClasses, ov.templates),
    todoSection(ov, writing ?? []),
    h(
      'div',
      { class: 'cl-stats' },
      statTile({
        value: t.review,
        label: 'Speaking chờ duyệt',
        href: '/lop/bai-nop?view=review',
        tone: t.review ? 'warn' : 'ok',
      }),
      statTile({
        value: writingQueue ?? '–',
        label: 'Writing chờ chấm',
        href: '/admin',
        tone: writingQueue ? 'warn' : 'ok',
      }),
      statTile({
        value: t.error,
        label: 'Cần kiểm tra tay',
        href: '/lop/bai-nop?view=error',
        tone: t.error ? 'danger' : 'ok',
      }),
      statTile({
        value: t.approved,
        label: 'Đã duyệt, chờ gửi',
        href: '/lop/bai-nop?view=approved',
        hint: t.approved ? 'Tự gửi trong vòng 1 giờ' : undefined,
      }),
    ),
    h(
      'div',
      { class: 'cl-grid' },
      h(
        'div',
        null,
        h('h2', null, 'Sắp đến hạn'),
        upcoming.length
          ? h('div', { class: 'cl-assign-list' }, ...upcoming.map(assignmentCard))
          : empty(
              'Không có bài nào đến hạn trong 14 ngày tới.',
              link('/lop/giao-bai', 'Giao bài mới'),
            ),
        h('h2', null, 'Vừa hết hạn (7 ngày)'),
        recent.length
          ? h('div', { class: 'cl-assign-list' }, ...recent.map(assignmentCard))
          : empty('Không có bài nào hết hạn trong 7 ngày qua.'),
      ),
      h(
        'aside',
        null,
        healthCard(ov.health, ov.runtime),
        h('h2', null, 'Lớp của bạn'),
        refreshClassesButton(reload),
        h(
          'ul',
          { class: 'cl-class-list' },
          ...ov.classes.map((c) =>
            h(
              'li',
              null,
              h(
                'div',
                null,
                h('b', null, c.name),
                h('span', { class: 'cl-muted' }, ` · ${c.students ?? 0} HS`),
              ),
              h(
                'div',
                { class: 'cl-links' },
                link(`/lop/ket-qua?tab=scores&courseId=${encodeURIComponent(c.id)}`, 'Bảng điểm'),
                c.hasPenaltyFile
                  ? link(`/lop/ket-qua?tab=penalty&courseId=${encodeURIComponent(c.id)}`, 'Phạt')
                  : null,
                c.link ? externalLink(c.link, 'Classroom ↗') : null,
              ),
            ),
          ),
        ),
        h('h2', null, 'Hoạt động gần đây'),
        ov.log.length
          ? h(
              'ol',
              { class: 'cl-log' },
              ...ov.log.map((l) =>
                h(
                  'li',
                  null,
                  h('span', { class: 'cl-muted' }, viDateTime(l.at)),
                  h('b', null, l.event),
                  l.detail ? h('span', { class: 'cl-log-detail' }, l.detail) : null,
                ),
              ),
            )
          : h('p', { class: 'cl-muted' }, 'Chưa có hoạt động.'),
      ),
    ),
  ];
}
