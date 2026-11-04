// Lớp học › Tổng quan: classes newly created on Google Classroom. The teacher confirms each one
// before the system tracks it like the other classes (sync, grading, penalty file, Writing class).
import { classroom } from '../../classroomApi';
import { h, replace } from '../../dom';
import { busy, errorBox, field, notice, selectEl } from '../../ui/components';
import type { NewClass, TrackResult } from './types';
import { externalLink } from './ui';

function trackForm(c: NewClass, templates: Array<{ id: string; name: string }>): HTMLElement {
  const result = h('div', { 'aria-live': 'polite' });
  const penalty = h('input', {
    type: 'checkbox',
    name: 'createPenalty',
    checked: templates.length > 0,
    disabled: templates.length === 0,
  });
  const template = selectEl(
    'templateCourseId',
    templates.map((t) => ({ value: t.id, label: t.name })),
    templates.length ? templates[templates.length - 1].id : '',
  );
  const startLesson = h('input', {
    type: 'number',
    name: 'startLesson',
    min: '1',
    max: '300',
    value: '1',
    inputmode: 'numeric',
  });
  const startType = selectEl(
    'startType',
    [
      { value: 'RW', label: 'Reading + Writing' },
      { value: 'LS', label: 'Listening + Speaking' },
    ],
    'RW',
  );
  const writing = h('input', { type: 'checkbox', name: 'addToWriting', checked: true });
  const fromToday = h('input', { type: 'checkbox', name: 'fromToday', checked: true });
  const penaltyFields = h(
    'div',
    { class: 'cl-newclass-fields' },
    field({
      label: 'Lớp mẫu',
      control: template,
      hint: 'Nhân bản file phạt của lớp này (giữ định dạng, công thức, danh sách chọn Done/Late/Missed).',
    }),
    field({ label: 'Buổi đầu tiên (số buổi Lxx)', control: startLesson }),
    field({ label: 'Buổi đầu là', control: startType }),
  );
  const syncFields = () => {
    penaltyFields.hidden = !penalty.checked;
  };
  penalty.addEventListener('change', syncFields);
  syncFields();

  const track = h('button', { type: 'button', class: 'btn btn-primary' }, 'Bắt đầu theo dõi');
  const ignore = h('button', { type: 'button', class: 'btn' }, 'Bỏ qua');
  const card = h(
    'article',
    { class: 'cl-newclass', 'data-testid': 'new-class' },
    h(
      'div',
      { class: 'cl-assign-head' },
      h(
        'div',
        null,
        h('h3', null, c.name),
        h(
          'p',
          { class: 'cl-muted' },
          [c.section, `${c.students} HS trên Classroom`].filter(Boolean).join(' · '),
        ),
      ),
      c.link ? externalLink(c.link, 'Classroom ↗') : null,
    ),
    h(
      'label',
      { class: 'cl-check' },
      penalty,
      templates.length
        ? ' Tạo file phạt cho lớp (HS lấy từ Classroom)'
        : ' Tạo file phạt (cần ít nhất 1 lớp đã có file phạt làm mẫu)',
    ),
    penaltyFields,
    h('label', { class: 'cl-check' }, writing, ' Thêm lớp vào web Writing (xếp HS vào lớp)'),
    h(
      'label',
      { class: 'cl-check' },
      fromToday,
      ' Chỉ tự chấm bài giao từ hôm nay (bài cũ đã hết hạn chỉ theo dõi nộp bài, không gửi lên web Writing)',
    ),
    h(
      'p',
      { class: 'cl-muted' },
      'Sau đó hệ thống tự đồng bộ bài tập, chấm bài, nhắc hạn, điền file phạt và thêm HS mới vào lớp như các lớp khác.',
    ),
    h('div', { class: 'cl-links' }, track, ignore),
    result,
  );
  const buttons = [track, ignore];
  const done = (...children: Parameters<typeof notice>[1][]) => {
    buttons.forEach((b) => b.remove());
    card
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
      .forEach((el) => (el.disabled = true));
    replace(result, notice('success', ...children));
  };
  track.addEventListener('click', () => {
    const n = Number(startLesson.value);
    if (penalty.checked && !(Number.isInteger(n) && n >= 1 && n <= 300)) {
      replace(result, notice('error', 'Buổi đầu tiên phải là số từ 1 đến 300.'));
      startLesson.focus();
      return;
    }
    void busy(track, 'Đang thiết lập… (~30 giây)', async () => {
      ignore.disabled = true;
      try {
        const r = await classroom<TrackResult>('class.track', {
          courseId: c.id,
          createPenalty: penalty.checked,
          templateCourseId: template.value,
          startLesson: n,
          startType: startType.value,
          addToWriting: writing.checked,
          fromToday: fromToday.checked,
        });
        done(
          h('p', { class: 'cl-pre' }, r.message),
          r.penaltyLink ? externalLink(r.penaltyLink, 'Mở file phạt ↗', 'btn btn-small') : null,
        );
      } catch (err) {
        replace(result, errorBox(err));
      } finally {
        ignore.disabled = false;
      }
    });
  });
  ignore.addEventListener('click', () =>
    busy(ignore, 'Đang lưu…', async () => {
      try {
        await classroom('class.ignore', { courseId: c.id });
        done('Đã bỏ qua lớp này. Muốn theo dõi lại: tick cột "Theo dõi" trong sheet Lớp học.');
      } catch (err) {
        replace(result, errorBox(err));
      }
    }),
  );
  return card;
}

/** Cards for new classes (nothing when there are none). */
export function newClassesSection(
  classes: NewClass[] | undefined,
  templates: Array<{ id: string; name: string }> | undefined,
): HTMLElement | null {
  if (!classes?.length) return null;
  return h(
    'section',
    { class: 'cl-newclasses', 'aria-labelledby': 'cl-newclasses-h' },
    h('h2', { id: 'cl-newclasses-h' }, `Lớp mới trên Google Classroom (${classes.length})`),
    ...classes.map((c) => trackForm(c, templates ?? [])),
  );
}

/** "Kiểm tra lớp mới": look for new Classroom classes now instead of waiting for the hourly run. */
export function refreshClassesButton(onFound: () => void): HTMLElement {
  const status = h('span', { class: 'cl-muted', 'aria-live': 'polite' });
  const btn = h('button', { type: 'button', class: 'btn btn-small' }, 'Kiểm tra lớp mới');
  btn.addEventListener('click', () =>
    busy(btn, 'Đang kiểm tra…', async () => {
      try {
        const r = await classroom<{ added: string[]; newClasses: NewClass[] }>('class.refresh');
        if (r.newClasses.length) onFound();
        else replace(status, ' Không có lớp mới.');
      } catch (err) {
        replace(status, errorBox(err));
      }
    }),
  );
  return h('div', { class: 'cl-links' }, btn, status);
}
