// Lớp học › Tổng quan: what needs the teacher today, assignments around now, classes, recent activity.
import { api } from '../../api';
import { classroom } from '../../classroomApi';
import { h, replace } from '../../dom';
import { async, busy, empty, errorBox, link } from '../../ui/components';
import type { QueueResponse } from '../admin/types';
import type { Health, Overview, OverviewAssignment } from './types';
import { dueText, externalLink, pageHeader, progress, statTile, viDateTime } from './ui';

async function load() {
  const [ov, queue] = await Promise.all([
    classroom<Overview>('overview'),
    api<QueueResponse>('admin.queue', {}).catch(() => null),
  ]);
  return { ov, writingQueue: queue ? queue.items.length : null };
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
export function healthCard(initial: Health | null | undefined): HTMLElement {
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
    btn,
  );
}

export function overviewPage(): Node {
  const today = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  return h(
    'section',
    { class: 'page cl-page' },
    async(
      load,
      ({ ov, writingQueue }) => {
        const t = ov.todo;
        const upcoming = ov.assignments.filter((a) => Date.parse(a.dueAt) >= Date.now());
        const recent = ov.assignments.filter((a) => Date.parse(a.dueAt) < Date.now()).reverse();
        return [
          pageHeader(
            ov.teacherName ? `Chào ${ov.teacherName}` : 'Tổng quan',
            today.charAt(0).toUpperCase() + today.slice(1),
            link('/lop/giao-bai', 'Giao bài mới', { class: 'btn btn-primary' }),
            externalLink(ov.sheetUrl, 'Mở Google Sheet ↗', 'btn'),
          ),
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
              healthCard(ov.health),
              h('h2', null, 'Lớp của bạn'),
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
                      link(
                        `/lop/ket-qua?tab=scores&courseId=${encodeURIComponent(c.id)}`,
                        'Bảng điểm',
                      ),
                      c.hasPenaltyFile
                        ? link(
                            `/lop/ket-qua?tab=penalty&courseId=${encodeURIComponent(c.id)}`,
                            'Phạt',
                          )
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
      },
      'Đang tải dữ liệu lớp học…',
    ),
  );
}
