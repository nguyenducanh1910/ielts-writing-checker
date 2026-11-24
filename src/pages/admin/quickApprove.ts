// "Duyệt nhanh": tick waiting essays in the queue and send their results in one go. Each essay
// sends the form the teacher saved (all four scores) or else its AI result (Gemini / Claude).
import { formatBand } from '../../../shared/band';
import { api } from '../../api';
import { type Child, h, replace } from '../../dom';
import { badge, busy, confirmDialog, errorBox, toast } from '../../ui/components';
import type { QueueItem } from './types';

/** At most this many per click (one request, Gmail and the 6-minute limit). */
export const QUICK_MAX = 50;

export function canQuickApprove(item: QueueItem): boolean {
  return item.queueStatus !== 'scored' && Boolean(item.score) && item.score?.source !== 'final';
}

/** The overall band cell: sent score, or the score that would be sent (with where it comes from). */
export function overallCell(item: QueueItem): Child {
  const s = item.score;
  if (!s) return h('span', { class: 'hint' }, '—');
  const label =
    s.source === 'final' ? 'Đã gửi' : s.source === 'teacher' ? 'Form thầy đã lưu' : 'Bản AI chấm';
  return [
    h('strong', { title: label }, formatBand(s.overall)),
    s.source === 'final' ? null : [' ', badge(s.source === 'teacher' ? 'thầy' : 'AI', 'info')],
  ];
}

export function quickApprove(items: QueueItem[], reload: () => void) {
  const selected = new Set<string>();
  const boxes = new Map<string, HTMLInputElement>();
  const ready = items.filter(canQuickApprove);
  const count = h('span', { class: 'hint', 'aria-live': 'polite' });
  const status = h('div', { 'aria-live': 'polite' });
  const send = h('button', { type: 'button', class: 'btn btn-primary' }, 'Duyệt & gửi bài đã chọn');
  const all = h('input', { type: 'checkbox', 'aria-label': 'Chọn tất cả bài có điểm' });

  const refresh = () => {
    send.disabled = selected.size === 0;
    send.textContent = selected.size
      ? `Duyệt & gửi ${selected.size} bài đã chọn`
      : 'Duyệt & gửi bài đã chọn';
    count.textContent = `${selected.size}/${ready.length} bài có điểm đã chọn`;
    all.checked = ready.length > 0 && selected.size === Math.min(ready.length, QUICK_MAX);
    for (const box of boxes.values()) box.disabled = !box.checked && selected.size >= QUICK_MAX;
  };

  all.addEventListener('change', () => {
    selected.clear();
    if (all.checked) ready.slice(0, QUICK_MAX).forEach((i) => selected.add(i.id));
    for (const [id, box] of boxes) box.checked = selected.has(id);
    refresh();
  });

  const checkbox = (item: QueueItem): Child => {
    if (!canQuickApprove(item)) return null;
    const box = h('input', {
      type: 'checkbox',
      'aria-label': `Chọn ${item.studentName}, ${item.topic} để duyệt nhanh`,
    });
    box.addEventListener('change', () => {
      if (box.checked) selected.add(item.id);
      else selected.delete(item.id);
      refresh();
    });
    boxes.set(item.id, box);
    return box;
  };

  send.addEventListener('click', async () => {
    const chosen = items.filter((i) => selected.has(i.id));
    const ai = chosen.filter((i) => i.score?.source === 'ai').length;
    const ok = await confirmDialog({
      title: `Gửi kết quả ${chosen.length} bài cho học viên?`,
      message:
        (ai ? `${ai} bài gửi bản AI chấm (thầy chưa sửa); ` : '') +
        `${chosen.length - ai} bài gửi form thầy đã lưu. Học viên nhận email ngay. ` +
        'Bài gửi bản AI không dùng làm bài mẫu; thầy vẫn mở ra sửa và gửi lại được.',
      confirmLabel: `Gửi ${chosen.length} bài`,
    });
    if (!ok) return;
    await busy(send, 'Đang gửi…', async () => {
      replace(status);
      try {
        const r = await api<{
          sent: number;
          noResult: number;
          skipped: number;
          failed: number;
          errors: string[];
        }>('admin.approveMany', { essayIds: chosen.map((i) => i.id) });
        const extra = [
          r.noResult ? `${r.noResult} bài chưa có điểm` : '',
          r.skipped ? `${r.skipped} bài đã gửi trước đó` : '',
          r.failed ? `${r.failed} bài lỗi: ${r.errors.join('; ')}` : '',
        ].filter(Boolean);
        toast(
          `Đã gửi ${r.sent} bài.${extra.length ? ` ${extra.join(' · ')}` : ''}`,
          r.failed ? 'error' : 'info',
        );
        reload();
      } catch (err) {
        replace(status, errorBox(err));
      }
    });
  });

  refresh();
  const panel = ready.length
    ? h(
        'div',
        { class: 'card' },
        h('h2', null, 'Duyệt nhanh'),
        h(
          'p',
          { class: 'hint' },
          'Tick các bài muốn gửi ở cột “Gửi” (cột Overall là điểm sẽ gửi: “thầy” = form thầy đã lưu, “AI” = bản AI chấm), rồi bấm gửi.',
        ),
        h(
          'p',
          { class: 'actions' },
          h('label', { class: 'checkbox' }, all, ' Chọn tất cả'),
          ' ',
          send,
          ' ',
          count,
        ),
        status,
      )
    : null;
  return { panel, checkbox, any: ready.length > 0 };
}
