// Shared UI building blocks with loading, empty and error states.
import { ApiClientError } from '../api';
import { type Child, h, replace, uid } from '../dom';
import { formatDateTime } from './format';

export function page(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'page' }, h('h1', { tabindex: '-1' }, title), ...children);
}

export function loading(text = 'Loading…'): HTMLElement {
  return h(
    'div',
    { class: 'loading', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    text,
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'limit' && err.fields.nextAllowedAt) {
      return `${err.message} You can submit again after ${formatDateTime(err.fields.nextAllowedAt)}.`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export function errorBox(err: unknown, retry?: () => void): HTMLElement {
  return h(
    'div',
    { class: 'notice notice-error', role: 'alert' },
    h('p', null, errorMessage(err)),
    retry ? h('button', { type: 'button', class: 'btn', onclick: retry }, 'Try again') : null,
  );
}

export function notice(kind: 'info' | 'success' | 'warning' | 'error', ...children: Child[]) {
  return h(
    'div',
    { class: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    ...children,
  );
}

export function empty(text: string, ...actions: Child[]): HTMLElement {
  return h('div', { class: 'empty' }, h('p', null, text), ...actions);
}

/** Render loading → content or error (with retry) into a container. */
export function async<T>(
  load: () => Promise<T>,
  render: (data: T, reload: () => void) => Child,
  loadingText?: string,
): HTMLElement {
  const box = h('div', { class: 'async' });
  const run = () => {
    replace(box, loading(loadingText));
    load().then(
      (data) => replace(box, render(data, run)),
      (err) => replace(box, errorBox(err, run)),
    );
  };
  run();
  return box;
}

export interface FieldOptions {
  label: string;
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  hint?: string;
  name?: string;
}

/** Label + control + hint + error slot, wired with aria attributes. */
export function field(opts: FieldOptions): HTMLElement {
  const id = opts.control.id || uid('f');
  opts.control.id = id;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [opts.hint ? hintId : '', errorId].filter(Boolean).join(' ');
  opts.control.setAttribute('aria-describedby', described);
  const wrapper = h(
    'div',
    { class: 'field', dataset: { field: opts.name ?? opts.control.name ?? '' } },
    h('label', { for: id }, opts.label),
    opts.hint ? h('p', { class: 'hint', id: hintId }, opts.hint) : null,
    opts.control,
    h('p', { class: 'field-error', id: errorId, 'aria-live': 'polite' }),
  );
  return wrapper;
}

export function showFieldErrors(root: HTMLElement, fields: Record<string, string>) {
  root.querySelectorAll<HTMLElement>('.field').forEach((f) => {
    const name = f.dataset.field ?? '';
    const msg = fields[name] ?? '';
    const slot = f.querySelector('.field-error');
    if (slot) slot.textContent = msg;
    const control = f.querySelector('input,select,textarea');
    if (control) {
      if (msg) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  });
  const first = root.querySelector<HTMLElement>('[aria-invalid="true"]');
  first?.focus();
}

export function selectEl(
  name: string,
  options: Array<{ value: string; label: string }>,
  value = '',
  placeholder?: string,
): HTMLSelectElement {
  return h(
    'select',
    { name },
    placeholder ? h('option', { value: '' }, placeholder) : null,
    ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
  );
}

export function badge(text: string, kind = ''): HTMLElement {
  return h('span', { class: `badge ${kind ? `badge-${kind}` : ''}` }, text);
}

/** Accessible confirm dialog built on <dialog>. Resolves true when confirmed. */
export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const titleId = uid('dlg');
    const dialog = h(
      'dialog',
      { class: 'dialog', 'aria-labelledby': titleId },
      h('h2', { id: titleId }, opts.title),
      h('p', null, opts.message),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { type: 'button', class: 'btn', onclick: () => close(false) },
          opts.cancelLabel ?? 'Cancel',
        ),
        h(
          'button',
          {
            type: 'button',
            class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`,
            onclick: () => close(true),
            'data-confirm': '',
          },
          opts.confirmLabel,
        ),
      ),
    );
    const returnFocus = document.activeElement as HTMLElement | null;
    const close = (value: boolean) => {
      dialog.close();
      dialog.remove();
      // Give focus back to the control that opened the dialog.
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(value);
    };
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(false);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-confirm]')?.focus();
  });
}

let liveRegion: HTMLElement | null = null;
export function toast(message: string, kind: 'info' | 'error' = 'info') {
  if (!liveRegion) {
    liveRegion = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(liveRegion);
  }
  const item = h('div', { class: `toast toast-${kind}` }, message);
  liveRegion.appendChild(item);
  setTimeout(() => item.remove(), 5000);
}

/** Disable a button and show progress text while an action runs. */
export async function busy<T>(
  button: HTMLButtonElement,
  text: string,
  fn: () => Promise<T>,
): Promise<T> {
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = text;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = original;
  }
}

export function table(headers: string[], rows: Child[][], caption?: string): HTMLElement {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      null,
      caption ? h('caption', null, caption) : null,
      h('thead', null, h('tr', null, ...headers.map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, ...rows.map((r) => h('tr', null, ...r.map((c) => h('td', null, c))))),
    ),
  );
}

export function link(href: string, text: Child, attrs: Record<string, string> = {}) {
  return h('a', { href: `#${href}`, ...attrs }, text);
}
