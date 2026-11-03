// Lớp học › Giao bài: what "Kiểm tra trước" found, shown before anything is created
// (every question of the Google Form with its answer, attachments) and the audio upload.
import { classroom } from '../../classroomApi';
import { h, replace } from '../../dom';
import { busy, errorBox, notice, table, toast } from '../../ui/components';
import type { AssignPreview } from './types';

const MAX_AUDIO = 25 * 1024 * 1024;

function groupOf(p: AssignPreview['parts'][number], n: number) {
  return p.groups.find((g) => n >= g.a && n <= g.b);
}

export function previewView(pv: AssignPreview): HTMLElement {
  const parts = pv.parts.map((p) => {
    const explained = p.questions.filter((q) => q.explained).length;
    const rows = p.questions.map((q) => {
      const g = groupOf(p, q.n);
      return [
        String(q.n),
        g ? `${g.label}${g.pair ? ' · cặp ' + g.a + '–' + g.b : ''}` : 'Điền đáp án',
        q.type === 'choice' ? q.options.join(' / ') : 'Ô trả lời',
        h('b', null, q.key || '—'),
        q.explained ? '✓' : '—',
        [q.level, q.err].filter(Boolean).join(' · ') || '—',
      ];
    });
    return h(
      'details',
      { class: 'cl-preview-part', open: true },
      h(
        'summary',
        null,
        h('b', null, `${p.name}: ${p.total} câu`),
        ` · giải thích ${explained}/${p.total}`,
        p.scale.length ? ` · thang: ${p.scale.join('; ')}` : '',
      ),
      table(
        ['Câu', 'Nhóm', 'Trên Google Form', 'Đáp án', 'Giải thích', 'Mức độ · lỗi dự kiến'],
        rows,
      ),
    );
  });
  return h(
    'div',
    { class: 'cl-preview', 'data-testid': 'assign-preview' },
    h('h3', null, 'Xem trước'),
    ...parts,
    pv.writing ? h('p', null, h('b', null, 'Writing: '), pv.writing) : null,
    pv.speaking ? h('p', null, h('b', null, 'Speaking: '), pv.speaking) : null,
    pv.attachments.length
      ? h(
          'div',
          null,
          h('b', null, 'File đính kèm cho học sinh'),
          h('ul', null, ...pv.attachments.map((a) => h('li', null, `${a.name} (${a.mode})`))),
        )
      : null,
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Không đọc được file.'));
    r.readAsDataURL(file);
  });
}

/** "Thư mục chưa có file nghe": pick an mp3 and upload it to the exam folder, then re-check. */
export function audioUpload(folder: string, onDone: () => void): HTMLElement {
  const input = h('input', {
    type: 'file',
    accept: 'audio/*,.mp3,.m4a,.wav',
    'aria-label': 'Chọn file nghe',
  });
  const btn = h('button', { type: 'button', class: 'btn btn-small' }, 'Tải lên thư mục');
  const status = h('div', { 'aria-live': 'polite' });
  btn.addEventListener('click', () => {
    const file = input.files?.[0];
    if (!file) return replace(status, notice('warning', 'Chọn file mp3/m4a trước.'));
    if (file.size > MAX_AUDIO)
      return replace(
        status,
        notice(
          'warning',
          'File lớn hơn 25 MB: hãy kéo thả trực tiếp vào thư mục trên Google Drive.',
        ),
      );
    void busy(btn, 'Đang tải lên…', async () => {
      try {
        const r = await classroom<{ name: string }>('assign.upload', {
          folder,
          name: file.name,
          mime: file.type || 'audio/mpeg',
          data: await toBase64(file),
        });
        toast(`Đã tải "${r.name}" lên thư mục.`);
        onDone();
      } catch (err) {
        replace(status, errorBox(err));
      }
    });
  });
  return h(
    'div',
    { class: 'cl-upload', 'data-testid': 'audio-upload' },
    h(
      'p',
      null,
      h('b', null, 'Thư mục chưa có file nghe. '),
      'Tải file mp3 lên ngay (tối đa 25 MB):',
    ),
    h('div', { class: 'actions' }, input, btn),
    status,
  );
}
