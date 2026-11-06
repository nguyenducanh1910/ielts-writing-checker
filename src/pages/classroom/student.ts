// Student › Lớp học của em: own Classroom homework, results already emailed, and this month's fines.
import { classroom } from '../../classroomApi';
import { h } from '../../dom';
import { async, empty, link, notice } from '../../ui/components';
import type { StudentAssignment, StudentClassroom } from './types';
import {
  dueText,
  externalLink,
  money,
  pageHeader,
  penaltyCell,
  skillShort,
  statTile,
  submitBadge,
  viDateTime,
} from './ui';

function todoCard(a: StudentAssignment): HTMLElement {
  return h(
    'li',
    { class: `cl-todo ${a.overdue ? 'cl-todo-late' : ''}` },
    h(
      'div',
      null,
      h('b', null, a.title),
      h('div', { class: 'cl-muted' }, `${a.className} · hạn ${viDateTime(a.dueAt)}`),
    ),
    h(
      'div',
      { class: 'cl-todo-side' },
      h(
        'span',
        { class: `cl-due ${a.overdue ? 'cl-due-past' : 'cl-due-open'}` },
        a.overdue ? 'Đã quá hạn' : dueText(a.dueAt),
      ),
      a.link ? externalLink(a.link, 'Làm bài ↗', 'btn btn-primary btn-small') : null,
    ),
  );
}

function resultCard(a: StudentAssignment): HTMLElement {
  return h(
    'article',
    { class: 'cl-result' },
    h(
      'div',
      { class: 'cl-assign-head' },
      h(
        'div',
        null,
        h('h3', null, a.title),
        h('p', { class: 'cl-muted' }, `${a.className} · hạn ${viDateTime(a.dueAt)}`),
      ),
      submitBadge(a.status),
    ),
    h(
      'ul',
      { class: 'cl-parts' },
      ...a.parts.map((p) =>
        h(
          'li',
          null,
          h('span', { class: 'cl-part-skill' }, skillShort(p.skill)),
          p.state === 'sent'
            ? h(
                'span',
                { class: 'cl-part-score' },
                p.band ? `Band ${p.band}` : p.score || 'Đã có kết quả',
              )
            : h(
                'span',
                { class: 'cl-muted' },
                p.state === 'grading'
                  ? 'Đang chấm'
                  : p.state === 'skipped'
                    ? 'Chưa làm phần này'
                    : 'Chưa nộp',
              ),
          p.summary
            ? h(
                'details',
                { class: 'cl-part-detail' },
                h('summary', null, 'Nhận xét'),
                h('p', { class: 'cl-pre' }, p.summary),
              )
            : null,
          p.feedbackFile ? externalLink(p.feedbackFile, 'Nhận xét chi tiết ↗') : null,
          p.essayId
            ? link(
                `/essays/${p.essayId}`,
                p.state === 'sent' ? 'Xem bài chữa →' : 'Xem bài em đã nộp →',
                { class: 'cl-part-link' },
              )
            : null,
        ),
      ),
    ),
  );
}

export function studentClassroomPage(): Node {
  return h(
    'section',
    { class: 'page cl-page' },
    async(
      () => classroom<StudentClassroom>('me.classroom'),
      (d) => {
        if (!d.matched || !d.stats || !d.assignments) {
          return [
            pageHeader('Lớp học của em'),
            notice(
              'info',
              h('p', null, `Chưa tìm thấy bài tập Google Classroom nào của email ${d.email}.`),
              h(
                'p',
                null,
                'Hãy đăng nhập web này bằng đúng email em dùng trên Google Classroom, hoặc báo thầy/cô để ghép tài khoản.',
              ),
              h('p', null, link('/essays', 'Xem các bài Writing của em →')),
            ),
          ];
        }
        const s = d.stats;
        const todo = d.assignments
          .filter((a) => !a.turnedInAt)
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
        const done = d.assignments.filter((a) => a.turnedInAt);
        const fine = (d.penalty ?? []).reduce((sum, p) => sum + p.fine, 0);
        const bandTiles = (Object.entries(s.bands) as Array<[string, number | null]>)
          .filter(([, v]) => v !== null)
          .map(([k, v]) => statTile({ value: v!.toFixed(1), label: `Band TB ${k}` }));
        return [
          pageHeader(
            `Lớp học của em`,
            `${d.name} · ${(d.classes ?? []).join(', ')}`,
            link('/lop-cua-em/tien-bo', 'Tiến bộ & ôn câu sai', { class: 'btn' }),
          ),
          h(
            'div',
            { class: 'cl-stats' },
            statTile({
              value: `${s.submitted}/${s.pastDue}`,
              label: 'Bài đã nộp (đã đến hạn)',
              tone: s.submitted === s.pastDue ? 'ok' : 'warn',
            }),
            statTile({ value: s.pending, label: 'Bài đang mở', tone: s.pending ? 'warn' : 'ok' }),
            statTile({
              value: s.overdue,
              label: 'Bài quá hạn chưa nộp',
              tone: s.overdue ? 'danger' : 'ok',
            }),
            statTile({ value: money(fine), label: 'Phạt tháng này', tone: fine ? 'danger' : 'ok' }),
            ...bandTiles,
          ),
          h('h2', null, 'Cần làm'),
          todo.length
            ? h('ul', { class: 'cl-todo-list' }, ...todo.map(todoCard))
            : empty('Em đã nộp hết bài. Tốt lắm!'),
          h('h2', null, 'Kết quả'),
          h(
            'p',
            { class: 'cl-muted cl-small' },
            'Điểm chỉ hiện sau khi thầy/cô đã gửi kết quả qua email.',
          ),
          done.length
            ? h('div', { class: 'cl-result-list' }, ...done.map(resultCard))
            : empty('Chưa có bài nào.'),
          ...(d.penalty ?? []).map((p) =>
            h(
              'div',
              { class: 'card' },
              h('h2', null, `Phạt ${p.tab} · ${p.className}`),
              h(
                'p',
                null,
                'Tổng: ',
                h('b', { class: p.fine ? 'cl-danger' : 'cl-ok' }, money(p.fine)),
              ),
              p.items.length
                ? h(
                    'ul',
                    { class: 'cl-pen-list' },
                    ...p.items.map((it) =>
                      h(
                        'li',
                        null,
                        penaltyCell(it.value),
                        h(
                          'span',
                          null,
                          ` ${it.session} ${it.skill.charAt(0).toUpperCase() + it.skill.slice(1)}`,
                        ),
                        h('span', { class: 'cl-muted' }, ` · ${it.week}`),
                      ),
                    ),
                  )
                : h('p', { class: 'cl-muted' }, 'Chưa có buổi nào được ghi.'),
            ),
          ),
        ];
      },
      'Đang tải…',
    ),
  );
}
