// Chấm tự động (miễn phí): khoá Gemini API, model, số bài mẫu mỗi lần chấm, band descriptors.
// Claude vẫn chấm bản đầu qua Claude.ai Project (chép–dán); Gemini chấm độc lập và đối chiếu.
import { api, ApiClientError } from '../../api';
import { h, replace } from '../../dom';
import { async, busy, errorBox, field, link, notice, page } from '../../ui/components';
import type { AiSettings } from './types';

export function aiSetupPage(): Node {
  return page(
    'Chấm tự động (Gemini)',
    async(
      () => api<AiSettings>('admin.ai.settings'),
      (data, reload) => {
        const key = h('input', {
          type: 'password',
          name: 'geminiKey',
          autocomplete: 'off',
          placeholder: data.hasGeminiKey ? 'Đã lưu — để trống nếu không đổi' : 'AIza…',
        });
        const model = h('input', { type: 'text', name: 'geminiModel', value: data.geminiModel });
        const samples = h('input', {
          type: 'number',
          name: 'samplesPerPrompt',
          min: '0',
          max: '8',
          value: String(data.samplesPerPrompt),
        });
        const rubric = h('textarea', { name: 'rubric', rows: '10', maxlength: '45000' });
        rubric.value = data.rubric;
        const status = h('div', { 'aria-live': 'polite' });
        const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Lưu cài đặt');
        save.addEventListener('click', () =>
          busy(save, 'Đang lưu…', async () => {
            try {
              const keyText = key.value.replace(/\s+/g, '');
              await api('admin.ai.saveSettings', {
                ...(keyText ? { geminiKey: keyText } : {}),
                geminiModel: model.value.trim(),
                samplesPerPrompt: Number(samples.value),
                rubric: rubric.value,
              });
              key.value = '';
              reload();
            } catch (err) {
              replace(status, saveError(err));
            }
          }),
        );
        const test = h('button', { type: 'button', class: 'btn' }, 'Kiểm tra kết nối');
        test.addEventListener('click', () =>
          busy(test, 'Đang kiểm tra…', async () => {
            try {
              const r = await api<{ gemini: { ok: boolean; message: string } }>('admin.ai.test');
              replace(
                status,
                notice(r.gemini.ok ? 'success' : 'error', `Gemini: ${r.gemini.message}`),
              );
            } catch (err) {
              replace(status, errorBox(err));
            }
          }),
        );
        const j = data.jobs;
        return [
          h(
            'ol',
            { class: 'card prose' },
            h(
              'li',
              null,
              'Chép bài sang Claude Project như cũ: “Copy for Claude” (từng bài) hoặc “Copy batch” (tối đa 5 bài Task 2), rồi dán câu trả lời của Claude về web.',
            ),
            h(
              'li',
              null,
              'Bấm “Bắt đầu chấm (Gemini)” trên trang chấm, hoặc “Gemini chấm & đối chiếu” trên hàng chờ cho nhiều bài: Gemini chấm độc lập rồi đối chiếu với bản của Claude, có tính độ lệch điểm của từng công cụ so với thầy.',
            ),
            h(
              'li',
              null,
              'Kết quả đối chiếu được điền sẵn vào form. Thầy duyệt, sửa rồi bấm gửi như bình thường — hệ thống không tự gửi cho học viên.',
            ),
            h(
              'li',
              null,
              `Bài đã gửi điểm tự thành bài mẫu chuẩn (đang có ${data.sampleCount} bài). Mỗi lần chấm, Gemini dùng ${data.samplesPerPrompt} bài mẫu gần nhất cùng dạng. Bỏ tick “Use as calibration sample” để loại một bài.`,
            ),
          ),
          data.jobsReady
            ? null
            : notice(
                'warning',
                'Cần chạy hàm setup() một lần trong dự án Apps Script của web Writing (thêm bảng AiJobs và cột mới) rồi tải lại trang.',
              ),
          j.queued || j.running || j.failed
            ? notice(
                j.failed ? 'warning' : 'info',
                `Hàng chờ AI: ${j.queued} chờ, ${j.running} đang chấm, ${j.failed} lỗi.`,
              )
            : null,
          h(
            'div',
            { class: 'card' },
            field({
              label: data.hasGeminiKey ? 'Khoá Gemini API — đã lưu ✓' : 'Khoá Gemini API — chưa có',
              control: key,
              hint: 'Tạo miễn phí tại aistudio.google.com → Get API key. Khoá chỉ lưu trong Apps Script, không hiện lại trên web. Lưu ý: với khoá miễn phí, Google có thể dùng nội dung gửi lên để cải thiện sản phẩm.',
            }),
            field({
              label: 'Model Gemini',
              control: model,
              hint: 'Mặc định gemini-flash-latest (miễn phí, giống hệ thống Lớp học). Có thể thử gemini-pro-latest nếu khoá còn lượt miễn phí cho Pro. Khi model quá tải hoặc hết lượt, hệ thống tự thử gemini-flash-lite-latest.',
            }),
            field({ label: 'Số bài mẫu mỗi lần chấm (0–8)', control: samples }),
            field({
              label: 'Band descriptors / tài liệu chấm (không bắt buộc)',
              control: rubric,
              hint: 'Dán nội dung band descriptors bạn đang để trong Claude Project. Để trống: Gemini dùng band descriptors IELTS công khai.',
            }),
            h('div', { class: 'actions' }, save, test),
            status,
          ),
          h(
            'p',
            null,
            link('/admin/claude', 'Claude setup (Project instructions, bài mẫu để tải lên)'),
          ),
        ];
      },
      'Đang tải…',
    ),
  );
}

const FIELD_LABELS: Record<string, string> = {
  geminiKey: 'Khoá Gemini API',
  geminiModel: 'Model Gemini',
  samplesPerPrompt: 'Số bài mẫu',
  rubric: 'Band descriptors',
};

/** Save failed: name the fields the server rejected instead of a generic message. */
function saveError(err: unknown): HTMLElement {
  if (err instanceof ApiClientError && Object.keys(err.fields).length > 0) {
    return notice(
      'error',
      h(
        'ul',
        null,
        ...Object.entries(err.fields).map(([k, msg]) =>
          h('li', null, `${FIELD_LABELS[k] ?? k}: ${msg}`),
        ),
      ),
    );
  }
  return errorBox(err);
}
