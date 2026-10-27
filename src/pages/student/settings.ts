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
    'Not set',
  );
  const exam = h('input', { type: 'date', name: 'examDate', value: user.examDate });
  const tz = h('input', {
    name: 'timezone',
    value: user.timezone || localTimeZone(),
    maxlength: '64',
  });
  const status = h('div', { 'aria-live': 'polite' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save settings');
  const form = h(
    'form',
    { class: 'card narrow', novalidate: true },
    field({ label: 'Name', control: name, name: 'name' }),
    field({ label: 'Target band', control: target, name: 'targetBand' }),
    field({ label: 'Exam date', control: exam, name: 'examDate' }),
    field({
      label: 'Time zone',
      control: tz,
      name: 'timezone',
      hint: `Used for rewrite due dates. This browser uses ${localTimeZone()}.`,
    }),
    save,
    status,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void busy(save, 'Saving…', async () => {
      try {
        const updated = await api<SessionUser>('me.update', {
          name: name.value,
          targetBand: target.value ? Number(target.value) : null,
          examDate: exam.value || null,
          timezone: tz.value,
        });
        setUser(updated);
        showFieldErrors(form, {});
        replace(status, notice('success', 'Settings saved.'));
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
    'Delete my account and all my data',
  );
  const delForm = h(
    'form',
    { class: 'card narrow danger-zone', novalidate: true },
    h('h2', null, 'Delete my account and all my data'),
    h(
      'p',
      null,
      'This removes your essays, scores, feedback and error log, moves your essay folders to the trash and logs you out everywhere. It cannot be undone.',
    ),
    field({ label: 'Type DELETE to confirm', control: confirmInput, name: 'confirm' }),
    delBtn,
    delStatus,
  );
  delForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (confirmInput.value !== 'DELETE')
      return showFieldErrors(delForm, { confirm: 'Type DELETE to confirm' });
    const ok = await confirmDialog({
      title: 'Delete your account?',
      message: 'All your data will be removed. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true,
    });
    if (!ok) return;
    await busy(delBtn, 'Deleting…', async () => {
      try {
        await api('me.delete', { confirm: 'DELETE' });
        clearSession();
        navigate('/login');
      } catch (err) {
        replace(delStatus, errorBox(err));
      }
    });
  });

  return page('Settings', form, pwForm, user.role === 'student' ? delForm : null);
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
    hasPassword ? 'Change password' : 'Set password',
  );
  const form = h(
    'form',
    { class: 'card narrow', novalidate: true },
    h('h2', null, 'Password'),
    hasPassword
      ? null
      : h('p', null, 'Choose a password so you can log in with your email and password next time.'),
    hasPassword
      ? field({ label: 'Current password', control: current, name: 'currentPassword' })
      : null,
    field({
      label: 'New password',
      control: next,
      name: 'newPassword',
      hint: 'At least 8 characters.',
    }),
    save,
    status,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (next.value.length < 8) {
      return showFieldErrors(form, { newPassword: 'Use at least 8 characters' });
    }
    void busy(save, 'Saving…', async () => {
      try {
        const updated = await api<SessionUser>('me.setPassword', {
          currentPassword: hasPassword ? current.value : undefined,
          newPassword: next.value,
        });
        setUser(updated);
        form.replaceWith(passwordForm(notice('success', 'Password saved.')));
      } catch (err) {
        if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    });
  });
  return form;
}
