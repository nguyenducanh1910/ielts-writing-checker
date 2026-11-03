// Lớp học › Giao bài: the "Giao bài" sheet as a form. Check first, then create the Forms and post to Classroom.
import { classroom } from '../../classroomApi';
import { h, replace } from '../../dom';
import {
  async,
  badge,
  busy,
  confirmDialog,
  errorBox,
  field,
  notice,
  selectEl,
  toast,
} from '../../ui/components';
import { audioUpload, previewView } from './assignPreview';
import type { AssignCheck, AssignOptions, AssignRow } from './types';
import { externalLink, pageHeader, viDateTime } from './ui';

function statusBadge(status: string): HTMLElement {
  if (/^Đã giao \(bản nháp/.test(status)) return badge('Bản nháp trên Classroom', 'warning');
  if (/^Đã giao/.test(status)) return badge('Đã giao', 'success');
  if (/^Lỗi/.test(status)) return badge('Lỗi', 'danger');
  if (/^Kiểm tra OK/.test(status)) return badge('Đã kiểm tra, chưa giao', 'info');
  return badge(status || 'Chưa xử lý');
}

/** Next session label: "L24" -> "L25". */
function nextSession(rows: AssignRow[], className: string): string {
  const nums = rows
    .filter((r) => r.className === className)
    .map((r) => Number(/^L\s*(\d+)/i.exec(r.session)?.[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? `L${Math.max(...nums) + 1}` : '';
}

function defaultDue(): string {
  const d = new Date(Date.now() + 3 * 86400e3);
  d.setHours(18, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T18:00`;
}

function historyList(rows: AssignRow[]): HTMLElement {
  if (!rows.length) return h('p', { class: 'cl-muted' }, 'Chưa giao bài nào từ sheet "Giao bài".');
  return h(
    'ul',
    { class: 'cl-history' },
    ...rows.map((r) =>
      h(
        'li',
        null,
        h(
          'div',
          { class: 'cl-history-head' },
          h('b', null, `${r.session} · ${r.type}`),
          statusBadge(r.status),
        ),
        h('p', { class: 'cl-muted' }, `${r.className} · hạn ${viDateTime(r.dueAt)}`),
        /^Lỗi/.test(r.status)
          ? h('p', { class: 'cl-danger' }, r.status.replace(/^Lỗi:\s*/, ''))
          : null,
        h(
          'p',
          { class: 'cl-links' },
          r.link ? externalLink(r.link, 'Mở trên Classroom ↗') : null,
          r.folder ? externalLink(r.folder, 'Thư mục đề ↗') : null,
        ),
        r.detail
          ? h(
              'details',
              null,
              h('summary', null, 'Chi tiết'),
              h('pre', { class: 'cl-pre' }, r.detail),
            )
          : null,
      ),
    ),
  );
}

export function assignPage(): Node {
  return h(
    'section',
    { class: 'page cl-page' },
    async(
      () =>
        Promise.all([
          classroom<AssignOptions>('assign.options'),
          classroom<{ rows: AssignRow[] }>('assign.list'),
        ]),
      ([opt, list], reload) => {
        const cls = selectEl(
          'className',
          opt.classes.map((c) => ({ value: c.name, label: c.name })),
          opt.classes[0]?.name ?? '',
        );
        const session = h('input', {
          name: 'session',
          required: true,
          placeholder: 'VD: L25',
          value: nextSession(list.rows, cls.value),
        });
        cls.addEventListener('change', () => {
          session.value = nextSession(list.rows, cls.value);
        });
        const type = selectEl(
          'type',
          opt.types.map((t) => ({ value: t, label: t })),
          opt.types[0] ?? '',
        );
        const folder = h('input', {
          name: 'folder',
          type: 'url',
          required: true,
          placeholder: 'https://drive.google.com/drive/folders/…',
        });
        const due = h('input', {
          name: 'dueAt',
          type: 'datetime-local',
          required: true,
          value: defaultDue(),
        });
        const note = h('textarea', {
          name: 'note',
          rows: '3',
          placeholder: 'Không bắt buộc. Hiện ở cuối phần hướng dẫn trên Classroom.',
        });
        const publish = h('input', { type: 'checkbox', name: 'publish', checked: true });
        const result = h('div', { class: 'cl-assign-result', 'aria-live': 'polite' });
        const payload = () => ({
          className: cls.value,
          session: session.value.trim(),
          type: type.value,
          folder: folder.value.trim(),
          dueAt: due.value,
          note: note.value,
          publish: publish.checked,
        });
        const valid = () => {
          if (!session.value.trim()) return 'Nhập tên buổi (VD: L25).';
          if (!/drive\.google\.com/.test(folder.value))
            return 'Dán link thư mục Google Drive chứa đề.';
          if (!due.value) return 'Chọn hạn nộp.';
          return '';
        };
        const check = h('button', { type: 'button', class: 'btn' }, 'Kiểm tra trước');
        const create = h('button', { type: 'button', class: 'btn btn-primary' }, 'Giao bài');
        const runCheck = () => {
          const msg = valid();
          if (msg) return replace(result, notice('warning', msg));
          void busy(check, 'Đang đọc thư mục…', async () => {
            try {
              const r = await classroom<AssignCheck>('assign.check', payload());
              const warnings = r.warnings.filter(
                (w) => !(r.preview?.missingAudio && /chưa có file nghe/i.test(w)),
              );
              replace(
                result,
                notice(
                  warnings.length || r.preview?.missingAudio ? 'warning' : 'success',
                  h('b', null, 'Thư mục hợp lệ. '),
                  h('pre', { class: 'cl-pre' }, r.summary),
                  warnings.length ? h('ul', null, ...warnings.map((w) => h('li', null, w))) : null,
                  r.preview?.missingAudio ? audioUpload(folder.value.trim(), runCheck) : null,
                ),
                r.preview ? previewView(r.preview) : null,
              );
            } catch (err) {
              replace(result, errorBox(err));
            }
          });
        };
        check.addEventListener('click', runCheck);
        create.addEventListener('click', async () => {
          const msg = valid();
          if (msg) return replace(result, notice('warning', msg));
          const p = payload();
          const ok = await confirmDialog({
            title: `Giao ${p.session} ${p.type}?`,
            message: `Hệ thống sẽ tạo Google Form, lưu đáp án và ${p.publish ? 'đăng ngay cho học sinh' : 'tạo bản nháp trên Classroom'} lớp ${p.className}. Việc này mất khoảng 1–2 phút.`,
            confirmLabel: p.publish ? 'Giao ngay' : 'Tạo bản nháp',
            cancelLabel: 'Huỷ',
          });
          if (!ok) return;
          replace(
            result,
            notice('info', 'Đang tạo Form và đăng lên Classroom… Đừng đóng trang này.'),
          );
          await busy(create, 'Đang giao…', async () => {
            try {
              const r = await classroom<{ status: string; link: string; summary: string }>(
                'assign.create',
                p,
              );
              replace(
                result,
                notice(
                  'success',
                  h('b', null, r.status),
                  r.link ? h('p', null, externalLink(r.link, 'Mở bài trên Classroom ↗')) : null,
                  h('pre', { class: 'cl-pre' }, r.summary),
                ),
              );
              toast('Đã giao bài.');
              folder.value = '';
              setTimeout(reload, 1500);
            } catch (err) {
              replace(result, errorBox(err));
            }
          });
        });
        return [
          pageHeader(
            'Giao bài',
            'Thay cho sheet "Giao bài": chọn lớp, dán link thư mục đề, chọn hạn nộp.',
          ),
          h(
            'div',
            { class: 'cl-grid' },
            h(
              'form',
              { class: 'card cl-form', onsubmit: (e: Event) => e.preventDefault() },
              h(
                'div',
                { class: 'grid-2' },
                field({ label: 'Lớp', control: cls }),
                field({
                  label: 'Buổi',
                  control: session,
                  hint: 'Tiêu đề trên Classroom = Buổi + loại (VD "L25 RW").',
                }),
              ),
              h(
                'div',
                { class: 'grid-2' },
                field({ label: 'Loại bài', control: type }),
                field({ label: 'Hạn nộp', control: due, hint: `Giờ ${opt.timeZone}` }),
              ),
              field({
                label: 'Link thư mục Drive',
                control: folder,
                hint: "Thư mục chứa đề Word/PDF, file nghe, Teacher's Book. Tên file cần có chữ Reading / Listening / Writing / Speaking.",
              }),
              h(
                'p',
                { class: 'hint' },
                h(
                  'a',
                  { href: './templates/TeacherBook-mau.docx', download: 'TeacherBook-mau.docx' },
                  "Tải file mẫu Teacher's Book (Word)",
                ),
                ' — soạn theo mẫu này thì hệ thống đọc được đủ đáp án, giải thích, độ khó và thang đánh giá.',
              ),
              field({ label: 'Ghi chú thêm cho học sinh', control: note }),
              h(
                'label',
                { class: 'cl-check' },
                publish,
                ' Đăng ngay cho học sinh (bỏ chọn: tạo bản nháp để bạn xem lại trên Classroom)',
              ),
              h('div', { class: 'actions' }, check, create),
              result,
            ),
            h('aside', null, h('h2', null, 'Đã giao gần đây'), historyList(list.rows)),
          ),
        ];
      },
      'Đang tải…',
    ),
  );
}
