// Writing an essay: mode picker, practice editor (drafts) and the timed editor
// used by Test mode and Assigned test mode.
import { MIN_WORDS, TASK_TYPE_LABELS, TIME_LIMITS, type TaskType } from '../../../shared/constants';
import { countWords } from '../../../shared/wordCount';
import { api, ApiClientError } from '../../api';
import { h, replace } from '../../dom';
import { navigate, onLeave, type RouteContext, setUnsavedCheck } from '../../router';
import { getConfig } from '../../state';
import type { AppConfig, EssayDetail, EssaySummary } from '../../types';
import {
  async,
  busy,
  confirmDialog,
  errorBox,
  errorMessage,
  field,
  link,
  notice,
  page,
  selectEl,
  showFieldErrors,
  toast,
} from '../../ui/components';
import { clock, formatDateTime, modeLabel, taskLabel } from '../../ui/format';
import { ESSAY_TYPE_FOR, harperTopicFor } from '../../../shared/promptMatch';
import type { BankPrompt } from '../../data/promptBank';
import { categoryFields } from '../../ui/categoryFields';
import { promptBankPicker } from '../../ui/promptBank';
import { type PickedImage, readImageFile, remoteImage } from '../../ui/image';

const LOCAL_SAVE_MS = 15_000;
const SERVER_SAVE_MS = 120_000;

export function newEssayPage(ctx: RouteContext): Node {
  const mode = ctx.query.get('mode');
  if (mode === 'practice') {
    return page(
      'Bài luyện tập',
      async(getConfig, (config) => practiceEditor(config, null, null)),
    );
  }
  if (mode === 'test') {
    return page(
      'Làm bài có giờ',
      async(getConfig, (config) => testSetup(config)),
    );
  }
  return page(
    'Viết bài mới',
    h('p', null, 'Chọn cách em muốn viết. Hai cách được chấm như nhau.'),
    h(
      'div',
      { class: 'grid-2' },
      h(
        'div',
        { class: 'card' },
        h('h2', null, 'Luyện tập'),
        h(
          'ul',
          null,
          h('li', null, 'Không giới hạn thời gian'),
          h('li', null, 'Gõ tại đây hoặc dán bài đã viết ở nơi khác'),
          h('li', null, 'Lưu nháp và viết tiếp sau'),
        ),
        link('/new?mode=practice', 'Bắt đầu luyện tập', { class: 'btn btn-primary' }),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', null, 'Làm bài kiểm tra'),
        h(
          'ul',
          null,
          h('li', null, '20 phút cho Task 1, 40 phút cho Task 2'),
          h('li', null, 'Chỉ gõ tại đây — không dán được chữ'),
          h('li', null, 'Làm một lần; hết giờ bài tự nộp'),
        ),
        link('/new?mode=test', 'Chuẩn bị bài kiểm tra', { class: 'btn btn-primary' }),
      ),
    ),
    h(
      'p',
      null,
      'Thầy/cô cũng có thể giao bài kiểm tra cho em: xem ',
      link('/assigned', 'Bài thầy giao'),
      '.',
    ),
  );
}

export function writePage(ctx: RouteContext): Node {
  return async(
    async () => {
      const [config, essay] = await Promise.all([
        getConfig(),
        api<EssayDetail>('essays.get', { id: ctx.params.id }),
      ]);
      const parent =
        essay.parentEssayId && essay.status === 'draft'
          ? await api<EssayDetail>('essays.get', { id: essay.parentEssayId })
          : null;
      return { config, essay, parent };
    },
    ({ config, essay, parent }) => {
      if (essay.status !== 'draft') {
        navigate(`/essays/${essay.id}`, { replace: true });
        return null;
      }
      if (essay.mode === 'practice') {
        return page(parent ? 'Viết lại' : 'Bài luyện tập', practiceEditor(config, essay, parent));
      }
      return timedEditor(essay);
    },
    'Đang tải bài…',
  );
}

export function rewritePage(ctx: RouteContext): Node {
  return page(
    'Nộp bài viết lại',
    async(
      async () => {
        const [config, parent, mine] = await Promise.all([
          getConfig(),
          api<EssayDetail>('essays.get', { id: ctx.params.parentId }),
          api<EssaySummary[]>('essays.listMine'),
        ]);
        return { config, parent, mine };
      },
      ({ config, parent, mine }) => {
        const existing = mine.find((e) => e.parentEssayId === parent.id && e.status === 'draft');
        if (existing) {
          navigate(`/write/${existing.id}`, { replace: true });
          return null;
        }
        if (!parent.rewrite || !['requested', 'overdue'].includes(parent.rewrite.status)) {
          return notice('info', 'Bài này không có yêu cầu viết lại nào đang mở.');
        }
        return practiceEditor(config, null, parent);
      },
    ),
  );
}

function wordCountBox(taskType: () => TaskType, body: HTMLTextAreaElement): HTMLElement {
  const out = h('p', { class: 'word-count', 'aria-live': 'polite' });
  const update = () => {
    const n = countWords(body.value);
    const min = MIN_WORDS[taskType()];
    out.textContent = `${n} từ`;
    if (n > 0 && n < min) {
      out.append(
        ' · ',
        h(
          'span',
          { class: 'warn' },
          `Bài ${TASK_TYPE_LABELS[taskType()]} nên có ít nhất ${min} từ. Em vẫn nộp được.`,
        ),
      );
    }
  };
  body.addEventListener('input', update);
  update();
  return out;
}

/** Practice: no typing for this long pauses the clock (walking away does not count). */
const PRACTICE_IDLE_MS = 3 * 60_000;
const PRACTICE_MAX_SECONDS = 6 * 3600;

/**
 * Practice mode's clock: how long the student has spent writing. Starts at the first keystroke
 * in the essay and counts while the page is open, not paused and typed in within 3 minutes.
 */
function practiceClock(
  taskType: () => TaskType,
  body: HTMLTextAreaElement,
  startSeconds: number,
): { el: HTMLElement; seconds: () => number } {
  let seconds = Math.min(PRACTICE_MAX_SECONDS, Math.max(0, startSeconds));
  let started = seconds > 0;
  let paused = false;
  let lastInput = 0;
  const time = h('strong', { class: 'practice-clock-time' });
  const state = h('span', { class: 'hint' });
  const pauseBtn = h(
    'button',
    { type: 'button', class: 'btn btn-small', hidden: true },
    'Tạm dừng',
  );
  const idle = () => Date.now() - lastInput > PRACTICE_IDLE_MS;
  const render = () => {
    time.textContent = clock(seconds * 1000);
    pauseBtn.hidden = !started;
    pauseBtn.textContent = paused ? 'Tiếp tục' : 'Tạm dừng';
    state.textContent = !started
      ? `Bắt đầu tính khi em viết. IELTS cho khoảng ${TIME_LIMITS[taskType()]} phút cho ${TASK_TYPE_LABELS[taskType()]}.`
      : paused
        ? 'Đã tạm dừng.'
        : idle()
          ? 'Tạm dừng khi em không gõ.'
          : `IELTS cho khoảng ${TIME_LIMITS[taskType()]} phút.`;
  };
  body.addEventListener('input', () => {
    lastInput = Date.now();
    started = true;
    paused = false;
    render();
  });
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    // Resuming counts at once, even before the next keystroke.
    if (!paused) lastInput = Date.now();
    render();
  });
  const timer = window.setInterval(() => {
    if (started && !paused && document.visibilityState === 'visible' && !idle()) {
      seconds = Math.min(PRACTICE_MAX_SECONDS, seconds + 1);
    }
    render();
  }, 1000);
  onLeave(() => window.clearInterval(timer));
  render();
  const el = h(
    'div',
    { class: 'practice-clock', role: 'group', 'aria-label': 'Thời gian viết' },
    h('span', null, 'Thời gian viết '),
    time,
    pauseBtn,
    state,
  );
  return { el, seconds: () => seconds };
}

/** Harper's topic and essay type for a question picked from the prompt bank. */
function categoryForBankPrompt(picked: BankPrompt, config: AppConfig) {
  return {
    essayType: ESSAY_TYPE_FOR[picked.type] ?? '',
    topicId: harperTopicFor(picked.topics, config.topics) ?? '',
  };
}

/** Practice mode editor, also used for rewrites (prompt, topic, task type and image come from the original). */
function practiceEditor(
  config: AppConfig,
  essay: EssayDetail | null,
  parent: EssayDetail | null,
): HTMLElement {
  let currentId = essay?.id ?? null;
  let pendingImage: PickedImage | null = null;
  let hasImage = essay?.hasImage ?? false;
  let dirty = false;
  const isRewrite = Boolean(parent);
  const source = parent ?? essay;

  const taskSel = selectEl(
    'taskType',
    Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    source?.taskType ?? 'task2',
  );
  const category = categoryFields(config.topics, {
    topicId: source?.topicId ?? '',
    diagramType: source?.diagramType ?? '',
    essayType: source?.essayType ?? '',
  });
  const prompt = h('textarea', { name: 'prompt', rows: '4', maxlength: '4000' });
  prompt.value = source?.prompt ?? '';
  const testDate = h('input', { type: 'date', name: 'testDate', value: essay?.testDate ?? '' });
  const body = h('textarea', {
    name: 'body',
    rows: '18',
    class: 'essay-input',
    spellcheck: 'false',
    autocapitalize: 'sentences',
  });
  body.value = essay?.body ?? '';
  const fileInput = h('input', { type: 'file', name: 'image', accept: 'image/png,image/jpeg' });
  const imagePreview = h('div', { class: 'image-preview' });
  const status = h('div', { 'aria-live': 'polite' });

  if (isRewrite) {
    taskSel.disabled = true;
    category.disable();
    prompt.readOnly = true;
  }

  const showImage = () => {
    if (pendingImage) {
      replace(
        imagePreview,
        h('img', {
          src: `data:${pendingImage.mimeType};base64,${pendingImage.base64}`,
          alt: 'Ảnh biểu đồ em đã chọn',
        }),
      );
    } else if (hasImage && (essay || parent)) {
      replace(
        imagePreview,
        remoteImage(
          'essays.image',
          { essayId: isRewrite ? parent!.id : essay!.id },
          'Biểu đồ của đề này',
        ),
      );
    } else {
      replace(imagePreview);
    }
  };
  if (isRewrite) hasImage = parent!.hasImage;
  showImage();

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      pendingImage = await readImageFile(file);
      dirty = true;
      showImage();
      showFieldErrors(form, {});
    } catch (err) {
      fileInput.value = '';
      showFieldErrors(form, { image: errorMessage(err) });
    }
  });

  const imageField = field({
    label: 'Ảnh biểu đồ (PNG hoặc JPG, tối đa 5 MB)',
    control: fileInput,
    name: 'image',
    hint: 'Bắt buộc với Task 1 Academic. Đính kèm biểu đồ trong đề.',
  });
  imageField.append(imagePreview);
  // Task 2: pick a question from the prompt bank (not for rewrites: the question is fixed).
  const bank = promptBankPicker((picked) => {
    prompt.value = picked.prompt;
    category.setValues(categoryForBankPrompt(picked, config));
    dirty = true;
    toast('Đã điền đề. Kiểm tra lại chủ đề và dạng bài.');
    prompt.focus();
  });
  const syncTaskType = () => {
    const task1 = taskSel.value === 'task1_academic';
    bank.hidden = taskSel.value !== 'task2' || isRewrite;
    imageField.hidden = !task1 || isRewrite;
    imagePreview.hidden = !task1;
    category.setTaskType(taskSel.value);
  };
  taskSel.addEventListener('change', syncTaskType);

  const startFromOriginal =
    isRewrite && !essay
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              if (!body.value.trim() || window.confirm('Thay bài đang viết bằng bài gốc?')) {
                body.value = parent!.body;
                body.dispatchEvent(new Event('input'));
              }
            },
          },
          'Bắt đầu từ bài gốc',
        )
      : null;

  const timer = practiceClock(() => taskSel.value as TaskType, body, essay?.timeUsedSeconds ?? 0);
  const payload = () => ({
    timeSpentSeconds: timer.seconds(),
    id: currentId ?? undefined,
    parentEssayId: parent?.id ?? undefined,
    taskType: taskSel.value,
    ...category.values(),
    prompt: prompt.value,
    body: body.value,
    testDate: testDate.value || undefined,
    image: pendingImage ?? undefined,
  });

  const afterSave = (saved: EssayDetail) => {
    currentId = saved.id;
    pendingImage = null;
    hasImage = saved.hasImage;
    dirty = false;
    deleteBtn.hidden = isRewrite;
    history.replaceState(null, '', `#/write/${saved.id}`);
  };

  const saveBtn = h('button', { type: 'button', class: 'btn' }, 'Lưu nháp');
  const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Nộp bài');
  const deleteBtn = h(
    'button',
    { type: 'button', class: 'btn btn-danger-outline', hidden: !currentId || isRewrite },
    'Xoá nháp',
  );

  saveBtn.addEventListener('click', () =>
    busy(saveBtn, 'Đang lưu…', async () => {
      try {
        const saved = await api<EssayDetail>('essays.saveDraft', payload());
        afterSave(saved);
        replace(status, notice('success', `Đã lưu nháp lúc ${formatDateTime(saved.savedAt)}.`));
        showFieldErrors(form, {});
      } catch (err) {
        if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    }),
  );

  deleteBtn.addEventListener('click', async () => {
    if (!currentId) return;
    const ok = await confirmDialog({
      title: 'Xoá bản nháp này?',
      message: 'Bản nháp và ảnh kèm theo sẽ bị xoá, không khôi phục được.',
      confirmLabel: 'Xoá nháp',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('essays.deleteDraft', { id: currentId });
      dirty = false;
      toast('Đã xoá nháp.');
      navigate('/essays');
    } catch (err) {
      replace(status, errorBox(err));
    }
  });

  const form = h(
    'form',
    { class: 'card editor', novalidate: true },
    isRewrite && parent?.rewrite
      ? notice(
          'info',
          h(
            'p',
            null,
            h('strong', null, 'Yêu cầu viết lại: '),
            parent.rewrite.note || 'Viết lại bài này.',
          ),
          h(
            'p',
            null,
            `Hạn ${formatDateTime(parent.rewrite.dueAt)}. Nộp muộn vẫn được nhận và ghi là muộn.`,
          ),
        )
      : null,
    h(
      'div',
      { class: 'grid-3' },
      field({ label: 'Dạng đề', control: taskSel, name: 'taskType' }),
      ...category.fields,
    ),
    bank,
    field({
      label: 'Đề bài',
      control: prompt,
      name: 'prompt',
      hint: 'Chép đúng nguyên văn đề bài.',
    }),
    imageField,
    field({
      label: 'Ngày thi (không bắt buộc)',
      control: testDate,
      name: 'testDate',
      hint: 'Nếu em viết bài này trong kỳ thi thật hoặc thi thử.',
    }),
    timer.el,
    field({ label: 'Bài viết của em', control: body, name: 'body' }),
    startFromOriginal,
    wordCountBox(() => taskSel.value as TaskType, body),
    h('div', { class: 'actions' }, saveBtn, submitBtn, deleteBtn),
    status,
  );
  syncTaskType();
  for (const el of [taskSel, prompt, body, testDate]) {
    el.addEventListener('input', () => (dirty = true));
  }
  category.onChange(() => (dirty = true));
  setUnsavedCheck(() => dirty);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errors: Record<string, string> = isRewrite ? {} : category.errors();
    if (!prompt.value.trim()) errors.prompt = 'Nhập đề bài';
    if (!body.value.trim()) errors.body = 'Viết bài của em';
    if (taskSel.value === 'task1_academic' && !pendingImage && !hasImage) {
      errors.image = 'Đính kèm ảnh biểu đồ. Task 1 Academic không nộp được nếu thiếu ảnh.';
    }
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;
    const ok = await confirmDialog({
      title: 'Nộp bài này?',
      message: 'Sau khi nộp em sẽ không sửa được nữa.',
      confirmLabel: 'Nộp bài',
    });
    if (!ok) return;
    await busy(submitBtn, 'Đang nộp và lưu vào Drive…', async () => {
      try {
        // Save first so a new essay has an ID (and the image is uploaded).
        const saved = await api<EssayDetail>('essays.saveDraft', payload());
        afterSave(saved);
        await api('essays.submit', { ...payload(), id: saved.id, image: undefined });
        dirty = false;
        toast('Đã nộp bài. Thầy/cô sẽ sớm chấm.');
        navigate(`/essays/${saved.id}`);
      } catch (err) {
        if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    });
  });
  return form;
}

/** Test mode set-up: the prompt (and chart image) is entered before the timer starts. */
function testSetup(config: AppConfig): HTMLElement {
  let image: PickedImage | null = null;
  const taskSel = selectEl(
    'taskType',
    Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    'task2',
  );
  const category = categoryFields(config.topics);
  const prompt = h('textarea', { name: 'prompt', rows: '4', maxlength: '4000' });
  const fileInput = h('input', { type: 'file', name: 'image', accept: 'image/png,image/jpeg' });
  const status = h('div', { 'aria-live': 'polite' });
  const startBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Bắt đầu làm bài');
  const imageField = field({
    label: 'Ảnh biểu đồ (PNG hoặc JPG, tối đa 5 MB)',
    control: fileInput,
    name: 'image',
  });
  const limitNote = h('p', { class: 'hint' });
  const bank = promptBankPicker((picked) => {
    prompt.value = picked.prompt;
    category.setValues(categoryForBankPrompt(picked, config));
    toast('Đã điền đề. Kiểm tra lại chủ đề và dạng bài.');
    prompt.focus();
  });
  const sync = () => {
    bank.hidden = taskSel.value !== 'task2';
    imageField.hidden = taskSel.value !== 'task1_academic';
    category.setTaskType(taskSel.value);
    limitNote.textContent = `Thời gian: ${TIME_LIMITS[taskSel.value as TaskType]} phút. Đồng hồ chạy khi em bấm "Bắt đầu làm bài" và vẫn chạy nếu em rời trang.`;
  };
  taskSel.addEventListener('change', sync);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      image = await readImageFile(file);
      showFieldErrors(form, {});
    } catch (err) {
      fileInput.value = '';
      image = null;
      showFieldErrors(form, { image: errorMessage(err) });
    }
  });
  const form = h(
    'form',
    { class: 'card', novalidate: true },
    h(
      'div',
      { class: 'grid-3' },
      field({ label: 'Dạng đề', control: taskSel, name: 'taskType' }),
      ...category.fields,
    ),
    bank,
    field({
      label: 'Đề bài',
      control: prompt,
      name: 'prompt',
      hint: 'Nhập đề trước khi bắt đầu. Sau đó không sửa được.',
    }),
    imageField,
    limitNote,
    startBtn,
    status,
  );
  sync();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errors: Record<string, string> = category.errors();
    if (prompt.value.trim().length < 10) errors.prompt = 'Nhập đầy đủ đề bài';
    if (taskSel.value === 'task1_academic' && !image) errors.image = 'Đính kèm ảnh biểu đồ trước';
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;
    const ok = await confirmDialog({
      title: 'Bắt đầu tính giờ?',
      message: `Em có ${TIME_LIMITS[taskSel.value as TaskType]} phút. Không dán được chữ, hết giờ bài tự nộp.`,
      confirmLabel: 'Bắt đầu làm bài',
    });
    if (!ok) return;
    await busy(startBtn, 'Đang bắt đầu…', async () => {
      try {
        const essay = await api<EssayDetail>('essays.startTest', {
          taskType: taskSel.value,
          ...category.values(),
          prompt: prompt.value,
          image: image ?? undefined,
        });
        navigate(`/write/${essay.id}`, { replace: true });
      } catch (err) {
        if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    });
  });
  return form;
}

interface LocalCopy {
  body: string;
  pasteAttempts: number;
  at: string;
}

function localKey(id: string) {
  return `ielts.autosave.${id}`;
}

function readLocal(id: string): LocalCopy | null {
  try {
    const raw = localStorage.getItem(localKey(id));
    return raw ? (JSON.parse(raw) as LocalCopy) : null;
  } catch {
    return null;
  }
}

function writeLocal(id: string, copy: LocalCopy) {
  try {
    localStorage.setItem(localKey(id), JSON.stringify(copy));
  } catch {
    // storage full or unavailable
  }
}

function clearLocal(id: string) {
  try {
    localStorage.removeItem(localKey(id));
  } catch {
    // ignore
  }
}

/** Timed editor for Test mode and Assigned test mode. */
export function timedEditor(essay: EssayDetail): HTMLElement {
  const skew = essay.serverNow ? Date.parse(essay.serverNow) - Date.now() : 0;
  const deadline = essay.deadlineAt ? Date.parse(essay.deadlineAt) : Date.now();
  const serverNow = () => Date.now() + skew;
  let pasteAttempts = essay.pasteAttempts;
  let submitted = false;
  let submitting = false;
  let lastServerBody = essay.body;

  const body = h('textarea', {
    name: 'body',
    rows: '20',
    class: 'essay-input',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': 'Bài viết của em',
  });
  const local = readLocal(essay.id);
  body.value = essay.body;
  if (local && Date.parse(local.at) > Date.parse(essay.savedAt) && local.body !== essay.body) {
    body.value = local.body; // the browser copy is newer (e.g. connection dropped)
    pasteAttempts = Math.max(pasteAttempts, local.pasteAttempts);
  }

  const timer = h('div', { class: 'timer', role: 'timer', 'aria-live': 'off' });
  const announce = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const saveStatus = h('p', { class: 'save-status', 'aria-live': 'polite' });
  const pasteNote = h('p', { class: 'paste-note', 'aria-live': 'assertive' });
  const status = h('div', { 'aria-live': 'polite' });

  const blockPaste = (e: Event) => {
    e.preventDefault();
    pasteAttempts++;
    pasteNote.textContent = 'Bài kiểm tra không cho dán chữ. Em hãy gõ bài.';
    writeLocal(essay.id, { body: body.value, pasteAttempts, at: new Date().toISOString() });
  };
  body.addEventListener('paste', blockPaste);
  body.addEventListener('drop', blockPaste);
  body.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') blockPaste(e);
  });

  const saveLocal = () =>
    writeLocal(essay.id, { body: body.value, pasteAttempts, at: new Date().toISOString() });

  const saveServer = async () => {
    if (submitted || submitting) return;
    try {
      const saved = await api<EssayDetail>('essays.saveDraft', {
        id: essay.id,
        body: body.value,
        pasteAttempts,
      });
      lastServerBody = saved.body;
      saveStatus.textContent = `Đã lưu lên máy chủ lúc ${new Date().toLocaleTimeString()}.`;
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'forbidden') return;
      saveStatus.textContent =
        'Không kết nối được máy chủ. Bài của em vẫn được lưu trong trình duyệt này.';
    }
  };

  const doSubmit = async (auto: boolean) => {
    if (submitted || submitting) return;
    submitting = true;
    saveLocal();
    replace(status, notice('info', auto ? 'Hết giờ. Đang nộp bài…' : 'Đang nộp và lưu vào Drive…'));
    try {
      await api('essays.submit', {
        id: essay.id,
        body: body.value,
        pasteAttempts,
        autoSubmitted: auto,
      });
      submitted = true;
      clearLocal(essay.id);
      toast(auto ? 'Hết giờ — bài của em đã được nộp.' : 'Đã nộp bài.');
      navigate(`/essays/${essay.id}`);
    } catch (err) {
      submitting = false;
      if (err instanceof ApiClientError && err.code === 'forbidden') {
        // Already submitted (for example from another tab).
        submitted = true;
        clearLocal(essay.id);
        navigate(`/essays/${essay.id}`);
        return;
      }
      replace(
        status,
        errorBox(err),
        auto
          ? notice(
              'warning',
              'Hệ thống thử lại mỗi 15 giây. Bài của em vẫn an toàn trong trình duyệt này.',
            )
          : null,
      );
    }
  };

  const announced = new Set<number>();
  const tick = () => {
    const left = deadline - serverNow();
    timer.textContent = `Còn ${clock(left)}`;
    timer.classList.toggle('low', left < 5 * 60000);
    for (const m of [10, 5, 1]) {
      if (left <= m * 60000 && left > (m - 1) * 60000 && !announced.has(m)) {
        announced.add(m);
        announce.textContent = `Còn ${m} phút.`;
      }
    }
    if (left <= 0) {
      timer.textContent = 'Hết giờ';
      if (!submitting && !submitted) void doSubmit(true);
    }
  };

  const tickTimer = window.setInterval(tick, 1000);
  const localTimer = window.setInterval(saveLocal, LOCAL_SAVE_MS);
  const serverTimer = window.setInterval(() => void saveServer(), SERVER_SAVE_MS);
  const retryTimer = window.setInterval(() => {
    if (!submitted && !submitting && deadline - serverNow() <= 0) void doSubmit(true);
  }, 15_000);
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick();
    else saveLocal();
  };
  document.addEventListener('visibilitychange', onVisible);
  onLeave(() => {
    window.clearInterval(tickTimer);
    window.clearInterval(localTimer);
    window.clearInterval(serverTimer);
    window.clearInterval(retryTimer);
    document.removeEventListener('visibilitychange', onVisible);
    saveLocal();
    if (!submitted) void saveServer();
  });
  setUnsavedCheck(() => !submitted && body.value !== lastServerBody);

  const submitBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Nộp bài');
  submitBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Nộp bài này?',
      message: 'Sau khi nộp em sẽ không sửa được nữa.',
      confirmLabel: 'Nộp bài',
    });
    if (ok) await busy(submitBtn, 'Đang nộp…', () => doSubmit(false));
  });

  tick();
  return page(
    essay.assignmentTitle ?? `Bài kiểm tra ${taskLabel(essay.taskType)}`,
    h(
      'div',
      { class: 'test-bar' },
      timer,
      h(
        'span',
        null,
        `${modeLabel(essay.mode)} · ${taskLabel(essay.taskType)} · ${essay.timeLimitMinutes} phút`,
      ),
    ),
    announce,
    h(
      'div',
      { class: 'card prompt-box' },
      h('h2', null, 'Đề bài'),
      h('p', { class: 'prompt-text' }, essay.prompt),
      essay.hasImage
        ? remoteImage('essays.image', { essayId: essay.id }, 'Biểu đồ của đề này')
        : null,
    ),
    h(
      'div',
      { class: 'card editor' },
      h('label', { for: 'timed-body', class: 'sr-only' }, 'Bài viết của em'),
      Object.assign(body, { id: 'timed-body' }),
      wordCountBox(() => essay.taskType, body),
      pasteNote,
      saveStatus,
      h('div', { class: 'actions' }, submitBtn),
      status,
    ),
    h(
      'p',
      { class: 'hint' },
      'Bài được lưu trong trình duyệt mỗi 15 giây và lên máy chủ mỗi 2 phút. Đồng hồ vẫn chạy nếu em rời trang.',
    ),
  );
}
