// "Choose from the prompt bank" (Task 2): 331 IELTS Writing Task 2 prompts, narrowed by topic,
// question type and a search box. Picking one fills in the prompt, essay type and topic.
// Same bank and behaviour as IELTS Harper Portal's "Write my own essay".
import type { BankPrompt, PromptType } from '../data/promptBank';
import { h, replace } from '../dom';
import { loading } from './components';

const PAGE = 15;

export const BANK_TYPE_LABELS: Record<PromptType, string> = {
  agree_disagree: 'Agree or disagree',
  discussion: 'Discuss both views',
  advantages: 'Advantages and disadvantages',
  causes_solutions: 'Causes, problems and solutions',
  positive_negative: 'Positive or negative development',
  other: 'Other (two-part questions)',
};

let idSeq = 0;

/** A button that opens the bank; onPick receives the chosen prompt. */
export function promptBankPicker(onPick: (p: BankPrompt) => void): HTMLElement {
  const panelId = `prompt-bank-${++idSeq}`;
  const panel = h('div', { id: panelId, class: 'prompt-bank', hidden: true });
  const toggle = h(
    'button',
    { type: 'button', class: 'btn', 'aria-expanded': 'false', 'aria-controls': panelId },
    'Choose from the prompt bank',
  );
  let loaded = false;
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', async () => {
    const open = panel.hidden !== false;
    setOpen(open);
    if (!open || loaded) return;
    loaded = true;
    replace(panel, loading('Loading the prompt bank…'));
    const { PROMPT_BANK, BANK_TOPICS } = await import('../data/promptBank');
    replace(panel, browser(PROMPT_BANK, BANK_TOPICS));
  });

  function browser(bank: BankPrompt[], topics: string[]): HTMLElement {
    const count = (match: (p: BankPrompt) => boolean) => bank.filter(match).length;
    const topic = h(
      'select',
      null,
      h('option', { value: '' }, `All topics (${bank.length})`),
      topics.map((x) => h('option', { value: x }, `${x} (${count((p) => p.topics.includes(x))})`)),
    );
    const type = h(
      'select',
      null,
      h('option', { value: '' }, 'All question types'),
      (Object.keys(BANK_TYPE_LABELS) as PromptType[]).map((x) =>
        h('option', { value: x }, `${BANK_TYPE_LABELS[x]} (${count((p) => p.type === x)})`),
      ),
    );
    const search = h('input', {
      type: 'search',
      placeholder: 'Search the questions, e.g. children',
      'aria-label': 'Search the questions',
    });
    // Inside the essay form: Enter in the search box must not submit the essay.
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    const status = h('p', { class: 'hint', 'aria-live': 'polite' });
    const list = h('ul', { class: 'prompt-bank-list' });
    const more = h('button', { type: 'button', class: 'btn btn-small' }, 'Show more');
    let shown = PAGE;

    const matches = () => {
      const q = search.value.trim().toLowerCase();
      const want = topic.value;
      return bank
        .filter(
          (p) =>
            (!want || p.topics.includes(want)) &&
            (!type.value || p.type === type.value) &&
            (!q || p.prompt.toLowerCase().includes(q)),
        )
        .sort((a, b) => (want ? Number(b.topics[0] === want) - Number(a.topics[0] === want) : 0));
    };

    const pick = (p: BankPrompt) => {
      setOpen(false);
      onPick(p);
    };

    const item = (p: BankPrompt) =>
      h(
        'li',
        null,
        h('p', { class: 'prompt-bank-text' }, p.prompt),
        h(
          'div',
          { class: 'prompt-bank-meta' },
          h('span', { class: 'badge badge-info' }, BANK_TYPE_LABELS[p.type]),
          p.topics.map((x, i) => h('span', { class: i === 0 ? 'badge' : 'badge muted' }, x)),
          h(
            'button',
            { type: 'button', class: 'btn btn-primary btn-small', onclick: () => pick(p) },
            'Use this question',
          ),
        ),
      );

    const draw = () => {
      const found = matches();
      status.textContent = `${found.length} questions`;
      replace(list, found.slice(0, shown).map(item));
      more.hidden = found.length <= shown;
    };
    const restart = () => {
      shown = PAGE;
      draw();
    };
    topic.addEventListener('change', restart);
    type.addEventListener('change', restart);
    search.addEventListener('input', restart);
    more.addEventListener('click', () => {
      shown += PAGE;
      draw();
    });
    draw();

    const random = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small',
        onclick: () => {
          const found = matches();
          if (found.length) pick(found[Math.floor(Math.random() * found.length)]);
        },
      },
      'Random question',
    );

    return h(
      'div',
      null,
      h(
        'div',
        { class: 'grid-2' },
        h('label', { class: 'prompt-bank-filter' }, 'Filter by topic', topic),
        h('label', { class: 'prompt-bank-filter' }, 'Filter by question type', type),
      ),
      search,
      h('div', { class: 'prompt-bank-bar' }, status, random),
      list,
      more,
    );
  }

  return h('div', { class: 'prompt-bank-wrap' }, toggle, panel);
}
