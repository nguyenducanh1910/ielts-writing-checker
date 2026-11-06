// Error practice: short tasks about the mistakes in a scored essay. The band and feedback unlock
// once every task is answered correctly. Wrong answers can be tried again; after a few tries the
// answer and the teacher's note are shown and the student enters it to move on.
import {
  answerMatches,
  PRACTICE_TRIES_BEFORE_ANSWER,
  type PracticeTask,
} from '../../../shared/practice';
import { api } from '../../api';
import { type Child, h, replace } from '../../dom';
import { busy, errorBox, notice } from '../../ui/components';

interface TaskUi {
  heading: string;
  body: Child[];
  /** Current answer is right. */
  check: () => boolean;
  /** Show the answer after too many wrong tries. */
  reveal: () => Child;
  /** Focus the first control. */
  focus: () => void;
}

/** "." after a revealed answer, unless it already ends with punctuation. */
const stop = (text: string) => (/[.!?…]$/.test(text.trim()) ? ' ' : '. ');

/** The student's sentence with a marked gap (or the given middle part) in it. */
function sentence(before: string, middle: Child, after: string): HTMLElement {
  return h('p', { class: 'practice-sentence' }, before, middle, after);
}

function radioGroup(name: string, legend: string, options: string[]) {
  const inputs = options.map((_, i) =>
    h('input', { type: 'radio', name, value: String(i), id: `${name}-${i}` }),
  );
  const fieldset = h(
    'fieldset',
    { class: 'practice-options' },
    h('legend', null, legend),
    ...options.map((text, i) =>
      h('label', { class: 'practice-option', for: `${name}-${i}` }, inputs[i], ' ', text),
    ),
  );
  const selected = () => {
    const i = inputs.findIndex((x) => x.checked);
    return i === -1 ? null : i;
  };
  return { fieldset, inputs, selected };
}

function gapUi(t: Extract<PracticeTask, { kind: 'gap' }>): TaskUi {
  const input = h('input', { type: 'text', id: `in-${t.id}`, autocomplete: 'off' });
  return {
    heading: 'Điền từ đúng vào chỗ trống',
    body: [
      sentence(t.before, h('span', { class: 'practice-gap' }, '______'), t.after),
      h('p', { class: 'hint' }, 'Em đã viết: ', h('span', { class: 'excerpt' }, `“${t.original}”`)),
      h('label', { for: input.id }, 'Từ đúng cho chỗ trống'),
      input,
    ],
    check: () => answerMatches(input.value, t.answer),
    reveal: () => [
      'Từ đúng là: ',
      h('strong', null, t.answer),
      stop(t.answer),
      'Gõ lại để tiếp tục.',
    ],
    focus: () => input.focus(),
  };
}

function chooseUi(t: Extract<PracticeTask, { kind: 'choose' }>): TaskUi {
  const group = radioGroup(`ch-${t.id}`, 'Câu nào đúng?', t.options);
  return {
    heading: 'Chọn câu đúng',
    body: [group.fieldset],
    check: () => group.selected() === t.answer,
    reveal: () => [
      'Câu đúng là: ',
      h('strong', null, t.options[t.answer]),
      stop(t.options[t.answer]),
      'Chọn câu đó để tiếp tục.',
    ],
    focus: () => group.inputs[0].focus(),
  };
}

function orderUi(t: Extract<PracticeTask, { kind: 'order' }>): TaskUi {
  const chosen: number[] = [];
  const line = h('span', { class: 'practice-line', 'aria-live': 'polite' });
  const bank = h('div', { class: 'practice-bank', role: 'group', 'aria-label': 'Các từ cần dùng' });
  const render = () => {
    replace(
      line,
      ...(chosen.length
        ? chosen.map((i) =>
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small practice-word',
                'aria-label': `Bỏ “${t.words[i]}”`,
                onclick: () => {
                  chosen.splice(chosen.indexOf(i), 1);
                  render();
                },
              },
              t.words[i],
            ),
          )
        : [h('span', { class: 'hint' }, 'Bấm các từ bên dưới theo đúng thứ tự')]),
    );
    replace(
      bank,
      ...t.words.map((w, i) =>
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small practice-word',
            disabled: chosen.includes(i),
            onclick: () => {
              chosen.push(i);
              render();
            },
          },
          w,
        ),
      ),
    );
  };
  render();
  const reset = h('button', { type: 'button', class: 'linklike' }, 'Làm lại');
  reset.addEventListener('click', () => {
    chosen.length = 0;
    render();
  });
  return {
    heading: 'Sắp xếp từ theo đúng thứ tự',
    body: [sentence(t.before, line, t.after), bank, h('p', null, reset)],
    check: () => answerMatches(chosen.map((i) => t.words[i]).join(' '), t.answer),
    reveal: () => [
      'Thứ tự đúng là: ',
      h('strong', null, t.answer),
      stop(t.answer),
      'Sắp xếp lại để tiếp tục.',
    ],
    focus: () => bank.querySelector<HTMLButtonElement>('button')?.focus(),
  };
}

function categoryUi(t: Extract<PracticeTask, { kind: 'category' }>): TaskUi {
  const group = radioGroup(`cat-${t.id}`, 'Đây là loại lỗi gì?', t.options);
  return {
    heading: 'Gọi tên lỗi',
    body: [
      h(
        'p',
        { class: 'practice-sentence' },
        h('span', { class: 'excerpt' }, `“${t.excerpt}”`),
        t.correction ? [' → ', h('span', { class: 'correction' }, t.correction)] : null,
      ),
      group.fieldset,
    ],
    check: () => group.selected() === t.answer,
    reveal: () => ['Đó là: ', h('strong', null, t.options[t.answer]), '. Chọn để tiếp tục.'],
    focus: () => group.inputs[0].focus(),
  };
}

function matchUi(t: Extract<PracticeTask, { kind: 'match' }>): TaskUi {
  const selects = t.items.map((item, i) => {
    const sel = h(
      'select',
      { id: `m-${t.id}-${i}` },
      h('option', { value: '' }, 'Chọn…'),
      ...t.options.map((o, j) => h('option', { value: String(j) }, o)),
    );
    return { item, sel };
  });
  return {
    heading: 'Nối mỗi lỗi với cách sửa',
    body: [
      h(
        'div',
        { class: 'practice-match' },
        ...selects.map(({ item, sel }) =>
          h(
            'div',
            { class: 'field' },
            h('label', { for: sel.id }, h('span', { class: 'excerpt' }, `“${item}”`)),
            sel,
          ),
        ),
      ),
    ],
    check: () => selects.every(({ sel }, i) => sel.value === String(t.answer[i])),
    reveal: () => [
      'Cặp đúng là: ',
      h(
        'ul',
        null,
        ...t.items.map((item, i) =>
          h('li', null, `“${item}” → `, h('strong', null, t.options[t.answer[i]])),
        ),
      ),
      'Chọn lại để tiếp tục.',
    ],
    focus: () => selects[0]?.sel.focus(),
  };
}

function taskUi(t: PracticeTask): TaskUi {
  switch (t.kind) {
    case 'gap':
      return gapUi(t);
    case 'choose':
      return chooseUi(t);
    case 'order':
      return orderUi(t);
    case 'category':
      return categoryUi(t);
    case 'match':
      return matchUi(t);
  }
}

export function practiceView(essayId: string, tasks: PracticeTask[], onUnlocked: () => void) {
  const progress = h('p', { class: 'hint', 'aria-live': 'polite' });
  const box = h('div');

  const finish = () => {
    const btn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Xem điểm và nhận xét');
    const status = h('div', { 'aria-live': 'polite' });
    btn.addEventListener('click', () =>
      busy(btn, 'Đang mở…', async () => {
        try {
          await api('essays.completePractice', { id: essayId });
          onUnlocked();
        } catch (err) {
          replace(status, errorBox(err));
        }
      }),
    );
    progress.textContent = `Đã xong cả ${tasks.length} câu.`;
    const heading = h('h3', { tabindex: '-1' }, 'Làm tốt lắm!');
    replace(
      box,
      heading,
      h('p', null, 'Em đã luyện xong các lỗi trong bài. Điểm và nhận xét đã sẵn sàng.'),
      btn,
      status,
    );
    heading.focus();
  };

  const show = (index: number) => {
    if (index >= tasks.length) return finish();
    const task = tasks[index];
    const ui = taskUi(task);
    let tries = 0;
    let solved = false;
    progress.textContent = `Câu ${index + 1}/${tasks.length}`;
    const feedback = h('div', { 'aria-live': 'polite' });
    const checkBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Kiểm tra');
    const explain = () =>
      task.category || task.note
        ? h(
            'p',
            { class: 'hint' },
            task.category ? [h('strong', null, task.category), task.note ? ': ' : ''] : null,
            task.note,
          )
        : null;
    const heading = h('h3', { tabindex: '-1' }, ui.heading);
    const form = h(
      'form',
      { class: 'practice-task', novalidate: true },
      heading,
      ...ui.body,
      h('div', { class: 'actions' }, checkBtn),
      feedback,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (solved) return;
      if (ui.check()) {
        solved = true;
        checkBtn.hidden = true;
        const next = h(
          'button',
          { type: 'button', class: 'btn btn-primary' },
          index + 1 < tasks.length ? 'Câu tiếp theo' : 'Hoàn thành',
        );
        next.addEventListener('click', () => show(index + 1));
        replace(
          feedback,
          notice('success', h('p', null, h('strong', null, 'Đúng rồi!')), explain()),
          next,
        );
        next.focus();
        return;
      }
      tries++;
      replace(
        feedback,
        tries >= PRACTICE_TRIES_BEFORE_ANSWER
          ? notice('warning', h('p', null, 'Chưa đúng. ', ui.reveal()), explain())
          : notice('error', 'Chưa đúng. Em xem lại và thử thêm lần nữa.'),
      );
    });
    replace(box, form);
    if (index > 0) heading.focus();
  };

  show(0);
  return h(
    'section',
    { class: 'card practice', 'aria-labelledby': 'practice-title' },
    h('h2', { id: 'practice-title' }, 'Trước khi xem điểm'),
    h(
      'p',
      null,
      `Thầy/cô đã chấm bài này và đánh dấu một số lỗi. Em làm ${tasks.length} câu ngắn về các lỗi đó để mở band và nhận xét.`,
    ),
    progress,
    box,
  );
}
