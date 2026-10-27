// Admin lists: error categories (grouped by criterion), topics, classes,
// feedback sources and settings.
import { CRITERIA, criterionLabel, type Criterion } from '../../../shared/constants';
import { api, ApiClientError } from '../../api';
import { type Child, h, replace } from '../../dom';
import { invalidateConfig } from '../../state';
import {
  async,
  busy,
  errorBox,
  field,
  notice,
  page,
  selectEl,
  showFieldErrors,
  toast,
} from '../../ui/components';

interface Item {
  id: string;
  label?: string;
  name?: string;
  criterion?: Criterion;
  active: boolean;
}

interface Lists {
  categories: Item[];
  topics: Item[];
  classes: Item[];
  sources: Item[];
  settings: Record<string, string>;
}

function itemRow(
  item: Item,
  key: 'label' | 'name',
  action: string,
  extra: Record<string, unknown>,
  reload: () => void,
): HTMLElement {
  const input = h('input', {
    value: item[key] ?? '',
    'aria-label': `Rename ${item[key]}`,
    maxlength: '80',
  });
  const active = h('input', {
    type: 'checkbox',
    checked: item.active,
    'aria-label': `${item[key]} active`,
  });
  const save = h('button', { type: 'button', class: 'btn btn-small' }, 'Save');
  const save1 = async () => {
    try {
      await api(action, { id: item.id, [key]: input.value, active: active.checked, ...extra });
      invalidateConfig();
      toast('Saved.');
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'error');
    }
  };
  save.addEventListener('click', () => busy(save, 'Saving…', save1));
  active.addEventListener('change', () => void save1());
  return h(
    'li',
    { class: `list-row${item.active ? '' : ' inactive'}` },
    input,
    h('label', { class: 'inline' }, active, ' Active'),
    save,
  );
}

function addForm(
  label: string,
  key: 'label' | 'name',
  action: string,
  reload: () => void,
  extraControl?: { control: HTMLSelectElement; name: string },
): HTMLElement {
  const input = h('input', { name: key, maxlength: '80' });
  const btn = h('button', { type: 'submit', class: 'btn btn-small btn-primary' }, 'Add');
  const form = h(
    'form',
    { class: 'add-row', novalidate: true },
    field({ label, control: input, name: key }),
    extraControl
      ? field({ label: 'Criterion', control: extraControl.control, name: extraControl.name })
      : null,
    btn,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void busy(btn, 'Adding…', async () => {
      try {
        await api(action, {
          [key]: input.value,
          active: true,
          ...(extraControl ? { [extraControl.name]: extraControl.control.value } : {}),
        });
        invalidateConfig();
        toast('Added.');
        reload();
      } catch (err) {
        if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
        toast(err instanceof Error ? err.message : 'Could not add', 'error');
      }
    });
  });
  return form;
}

function simpleSection(
  title: string,
  items: Item[],
  key: 'label' | 'name',
  action: string,
  reload: () => void,
  intro: string,
): Child {
  return h(
    'section',
    { class: 'card' },
    h('h2', null, title),
    h('p', { class: 'hint' }, intro),
    h('ul', { class: 'plain-list' }, ...items.map((i) => itemRow(i, key, action, {}, reload))),
    addForm(`New ${title.toLowerCase().replace(/s$/, '')}`, key, action, reload),
  );
}

function settingsSection(settings: Record<string, string>): Child {
  const cap = h('input', {
    type: 'number',
    min: '1',
    max: '50',
    name: 'daily_submission_cap',
    value: settings.daily_submission_cap,
  });
  const tz = h('input', { name: 'admin_timezone', value: settings.admin_timezone });
  const reserve = h('input', {
    type: 'number',
    min: '0',
    max: '90',
    name: 'email_quota_reserve',
    value: settings.email_quota_reserve,
  });
  const status = h('div', { 'aria-live': 'polite' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save settings');
  const form = h(
    'form',
    { class: 'card', novalidate: true },
    h('h2', null, 'Settings'),
    field({
      label: 'Daily submission cap (essays per student per 24 hours)',
      control: cap,
      name: 'daily_submission_cap',
    }),
    field({
      label: 'Admin time zone (Drive folder dates)',
      control: tz,
      name: 'admin_timezone',
      hint: 'For example Asia/Ho_Chi_Minh',
    }),
    field({
      label: 'Email quota reserve for login links',
      control: reserve,
      name: 'email_quota_reserve',
      hint: 'Result and reminder emails wait in the queue when fewer than this many sends are left today.',
    }),
    btn,
    status,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void busy(btn, 'Saving…', async () => {
      try {
        await api('admin.settings.save', {
          daily_submission_cap: Number(cap.value),
          admin_timezone: tz.value,
          email_quota_reserve: Number(reserve.value),
        });
        showFieldErrors(form, {});
        replace(status, notice('success', 'Settings saved.'));
      } catch (err) {
        if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    });
  });
  return form;
}

export function listsPage(): Node {
  return page(
    'Lists and settings',
    async(
      () => api<Lists>('admin.lists'),
      (data, reload) => [
        h(
          'section',
          { class: 'card' },
          h('h2', null, 'Error categories'),
          h(
            'p',
            { class: 'hint' },
            'Grouped by criterion. Deactivated categories stay on old essays but cannot be chosen for new errors, and are left out of the Claude export.',
          ),
          ...CRITERIA.map((c) =>
            h(
              'div',
              null,
              h('h3', null, criterionLabel(c)),
              h(
                'ul',
                { class: 'plain-list' },
                ...data.categories
                  .filter((x) => x.criterion === c)
                  .map((i) =>
                    itemRow(i, 'label', 'admin.categories.save', { criterion: c }, reload),
                  ),
              ),
            ),
          ),
          addForm('New category', 'label', 'admin.categories.save', reload, {
            control: selectEl(
              'criterion',
              CRITERIA.map((c) => ({ value: c, label: criterionLabel(c) })),
              'grammar',
            ),
            name: 'criterion',
          }),
        ),
        simpleSection(
          'Topics',
          data.topics,
          'label',
          'admin.topics.save',
          reload,
          'Students choose from active topics. Inactive topics are hidden from new essays.',
        ),
        simpleSection(
          'Classes',
          data.classes,
          'label',
          'admin.classes.save',
          reload,
          'Shown in the sign-up form.',
        ),
        simpleSection(
          'Feedback sources',
          data.sources,
          'name',
          'admin.sources.save',
          reload,
          'External tools whose results you paste on the scoring page. Keep “Claude” for the Claude draft.',
        ),
        settingsSection(data.settings),
      ],
    ),
  );
}
