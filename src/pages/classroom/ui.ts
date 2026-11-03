// Small building blocks shared by the "Lớp học" pages (Vietnamese UI).
import { type Child, h } from '../../dom';
import { badge } from '../../ui/components';
import type { GradeKind } from './types';

const TZ = 'Asia/Ho_Chi_Minh';

export function viDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('vi-VN', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

export function viDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit' });
}

/** "còn 2 ngày", "còn 5 giờ", "hết hạn 3 giờ trước" */
export function dueText(iso: string, now = Date.now()): string {
  if (!iso) return 'không có hạn';
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const unit =
    abs < 3600e3
      ? `${Math.max(1, Math.round(abs / 60e3))} phút`
      : abs < 48 * 3600e3
        ? `${Math.round(abs / 3600e3)} giờ`
        : `${Math.round(abs / 86400e3)} ngày`;
  return diff >= 0 ? `còn ${unit}` : `hết hạn ${unit} trước`;
}

export function externalLink(href: string, text: Child, cls = ''): HTMLAnchorElement {
  return h(
    'a',
    { href, target: '_blank', rel: 'noopener noreferrer', class: cls || undefined },
    text,
  );
}

const GRADE: Record<GradeKind, [string, string]> = {
  review: ['Chờ duyệt', 'warning'],
  approved: ['Đã duyệt, chờ gửi', 'info'],
  sent: ['Đã gửi HS', 'success'],
  error: ['Cần kiểm tra tay', 'danger'],
  web: ['Chờ chấm trên web', 'info'],
  skipped: ['Bỏ qua', ''],
  graded: ['Đã chấm', 'success'],
  waiting: ['Chờ chấm', ''],
  other: ['Khác', ''],
};

export function gradeBadge(kind: GradeKind): HTMLElement {
  const [text, k] = GRADE[kind] ?? GRADE.other;
  return badge(text, k);
}

export function submitBadge(status: string): HTMLElement {
  if (/muộn/i.test(status)) return badge(status, 'warning');
  if (/^Đã/.test(status)) return badge(status, 'success');
  if (/Chưa|Thiếu|Missing/i.test(status)) return badge(status || 'Chưa nộp', 'danger');
  return badge(status || '–');
}

export function statTile(opts: {
  value: Child;
  label: string;
  href?: string;
  tone?: 'warn' | 'danger' | 'ok' | '';
  hint?: string;
}): HTMLElement {
  const inner = [
    h('strong', { class: 'cl-stat-value' }, opts.value),
    h('span', { class: 'cl-stat-label' }, opts.label),
    opts.hint ? h('span', { class: 'cl-stat-hint' }, opts.hint) : null,
  ];
  const cls = `cl-stat ${opts.tone ? `cl-stat-${opts.tone}` : ''}`;
  return opts.href
    ? h('a', { class: cls, href: `#${opts.href}` }, ...inner)
    : h('div', { class: cls }, ...inner);
}

export function progress(
  parts: Array<{ value: number; tone: 'ok' | 'warn' | 'danger' }>,
  total: number,
  label: string,
) {
  const bar = h('div', { class: 'cl-progress', role: 'img', 'aria-label': label });
  for (const p of parts) {
    if (!p.value || !total) continue;
    bar.append(
      h('span', { class: `cl-progress-${p.tone}`, style: `width:${(p.value / total) * 100}%` }),
    );
  }
  return bar;
}

/** "Reading (Academic)" -> "Reading" */
export function skillShort(skill: string): string {
  return skill.replace(/\s*\(.*\)$/, '').replace('Writing Task ', 'W Task ');
}

export function pageHeader(title: string, subtitle?: Child, ...actions: Child[]): HTMLElement {
  return h(
    'div',
    { class: 'cl-page-head' },
    h(
      'div',
      null,
      h('h1', { tabindex: '-1' }, title),
      subtitle ? h('p', { class: 'cl-subtitle' }, subtitle) : null,
    ),
    actions.length ? h('div', { class: 'cl-head-actions' }, ...actions) : null,
  );
}

export function penaltyCell(value: string): HTMLElement {
  const v = value.trim();
  if (!v) return h('span', { class: 'cl-pen cl-pen-empty', title: 'Chưa có' }, '·');
  if (/^done$/i.test(v)) return h('span', { class: 'cl-pen cl-pen-done', title: 'Done' }, '✓');
  if (/^late$/i.test(v))
    return h('span', { class: 'cl-pen cl-pen-late', title: 'Nộp muộn' }, 'Muộn');
  if (/missed/i.test(v)) return h('span', { class: 'cl-pen cl-pen-missed', title: v }, '10k');
  return h('span', { class: 'cl-pen', title: v }, v);
}

export function money(k: number): string {
  return `${k.toLocaleString('vi-VN')}k`;
}
