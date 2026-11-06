// Settings: name, target band, exam date, time zone, password, and account deletion.
import { api, ApiClientError } from '../../api';
import { h, replace } from '../../dom';
import { navigate } from '../../router';
import { clearSession, getUser, type SessionUser, setUser } from '../../session';
import {
  busy,
  confirmDialog,
  errorBox,
  field,
  notice,
  page,
  selectEl,
  showFieldErrors,
} from '../../ui/components';
import { localTimeZone } from '../../ui/format';

const BANDS = Array.from({ length: 19 }, (_, i) => (i / 2).toFixed(1)).filter(
  (b) => Number(b) >= 4,
);

export function settingsPage(): Node {
  const user = getUser()!;
  const name = h('input', {
    name: 'name',
    value: user.name,
    autocomplete: 'name',
    maxlength: '80',
  });
  const target = selectEl(
    'targetBand',
    BANDS.map((b) => ({ value: b, label: b })),
    user.targetBand !== null ? user.targetBand.toFixed(1) : '',
    'Chưa đặt',
  );
  const exam = h('input', { type: 'date', name: 'examDate', value: user.examDate });
  const tz = h('input', {
    name: 'timezone',
    value: user.timezone || localTimeZone(),
    maxlength: '64',
  });
  const status = h('div', { 'aria-live': 'polite' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Lưu cài đặt');
  const form = h(
    'form',
    { class: 'card narrow', novalidate: true },
    field({ label: 'Họ tên', control: name, name: 'name' }),
    field({ label: 'Band mục tiêu', control: target, name: 'targetBand' }),
    field({ label: 'Ngày thi', control: exam, name: 'examDate' }),
    field({
      label: 'Múi giờ',
      control: tz,
      name: 'timezone',
      hint: `Dùng cho hạn viết lại. Trình duyệt này đang dùng ${localTimeZone()}.`,
    }),
    save,
    status,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void busy(save, 'Đang lưu…', async () => {
      try {
        const updated = await api<SessionUser>('me.update', {
          name: name.value,
          targetBand: target.value ? Number(target.value) : null,
          examDate: exam.value || null,
          timezone: tz.value,
        });
        setUser(updated);
        showFieldErrors(form, {});
        replace(status, notice('success', 'Đã lưu cài đặt.'));
      } catch (err) {
        if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    });
  });

  const pwForm = passwordForm();

  const confirmInput = h('input', { name: 'confirm', autocomplete: 'off' });
  const delStatus = h('div', { 'aria-live': 'polite' });
  const delBtn = h(
    'button',
    { type: 'submit', class: 'btn btn-danger' },
    'Xoá tài khoản và toàn bộ dữ liệu của em',
  );
  const delForm = h(
    'form',
    { class: 'card narrow danger-zone', novalidate: true },
    h('h2', null, 'Xoá tài khoản và toàn bộ dữ liệu của em'),
    h(
      'p',
      null,
      'Thao tác này xoá bài viết, điểm, nhận xét và lịch sử lỗi của em, chuyển thư mục bài vào thùng rác và đăng xuất em khỏi mọi thiết bị. Không khôi phục được.',
    ),
    field({ label: 'Gõ DELETE để xác nhận', control: confirmInput, name: 'confirm' }),
    delBtn,
    delStatus,
  );
  delForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (confirmInput.value !== 'DELETE')
      return showFieldErrors(delForm, { confirm: 'Gõ DELETE để xác nhận' });
    const ok = await confirmDialog({
      title: 'Xoá tài khoản?',
      message: 'Toàn bộ dữ liệu của em sẽ bị xoá, không khôi phục được.',
      confirmLabel: 'Xoá tất cả',
      danger: true,
    });
    if (!ok) return;
    await busy(delBtn, 'Đang xoá…', async () => {
      try {
        await api('me.delete', { confirm: 'DELETE' });
        clearSession();
        navigate('/login');
      } catch (err) {
        replace(delStatus, errorBox(err));
      }
    });
  });

  return page('Cài đặt', form, pwForm, user.role === 'student' ? delForm : null);
}

/** Set a first password (after a login link) or change the current one. */
function passwordForm(message?: Node): HTMLElement {
  const hasPassword = getUser()?.hasPassword ?? false;
  const current = h('input', {
    type: 'password',
    name: 'currentPassword',
    autocomplete: 'current-password',
    maxlength: '128',
  });
  const next = h('input', {
    type: 'password',
    name: 'newPassword',
    autocomplete: 'new-password',
    maxlength: '128',
  });
  const status = h('div', { 'aria-live': 'polite' }, message ?? null);
  const save = h(
    'button',
    { type: 'submit', class: 'btn btn-primary' },
    hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu',
  );
  const form = h(
    'form',
    { class: 'card narrow', novalidate: true },
    h('h2', null, 'Mật khẩu'),
    hasPassword
      ? null
      : h('p', null, 'Đặt mật khẩu để lần sau em đăng nhập bằng email và mật khẩu.'),
    hasPassword
      ? field({ label: 'Mật khẩu hiện tại', control: current, name: 'currentPassword' })
      : null,
    field({
      label: 'Mật khẩu mới',
      control: next,
      name: 'newPassword',
      hint: 'Ít nhất 8 ký tự.',
    }),
    save,
    status,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (next.value.length < 8) {
      return showFieldErrors(form, { newPassword: 'Dùng ít nhất 8 ký tự' });
    }
    void busy(save, 'Đang lưu…', async () => {
      try {
        const updated = await api<SessionUser>('me.setPassword', {
          currentPassword: hasPassword ? current.value : undefined,
          newPassword: next.value,
        });
        setUser(updated);
        form.replaceWith(passwordForm(notice('success', 'Đã lưu mật khẩu.')));
      } catch (err) {
        if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    });
  });
  return form;
}
