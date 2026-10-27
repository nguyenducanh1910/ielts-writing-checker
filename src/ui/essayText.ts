// Essay text with highlighted errors. Text is inserted as text nodes, and the
// rendered characters match the stored body exactly, so selections map to
// character offsets.
import { CRITERIA, CRITERION_SHORT, type Criterion } from '../../shared/constants';
import { h } from '../dom';

export interface Highlight {
  id: string;
  start: number | null;
  end: number | null;
  label: string;
  correction: string;
  active?: boolean;
  /** Colours the highlight: red TA/TR, orange CC, blue LR, purple GRA. */
  criterion?: Criterion | null;
}

/** Colour key shown above highlighted essays (colour is never the only cue: each mark names its category). */
export function highlightLegend(): HTMLElement {
  return h(
    'p',
    { class: 'highlight-legend' },
    'Highlight colours: ',
    ...CRITERIA.map((c) =>
      h(
        'span',
        { class: `legend-item err-${c}` },
        h('span', { class: `swatch swatch-${c}`, 'aria-hidden': 'true' }),
        CRITERION_SHORT[c],
      ),
    ),
  );
}

export function essayText(
  body: string,
  highlights: Highlight[],
  onSelectHighlight?: (id: string) => void,
): HTMLElement {
  const container = h('div', { class: 'essay-text', dataset: { essayText: '' } });
  const placed = highlights.filter(
    (x) =>
      x.start !== null && x.end !== null && x.start >= 0 && x.end <= body.length && x.end > x.start,
  );
  const bounds = new Set<number>([0, body.length]);
  for (const x of placed) {
    bounds.add(x.start!);
    bounds.add(x.end!);
  }
  const points = [...bounds].sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const text = body.slice(from, to);
    const covering = placed.filter((x) => x.start! <= from && x.end! >= to);
    if (covering.length === 0) {
      container.appendChild(document.createTextNode(text));
      continue;
    }
    const description = covering.map((x) => `${x.label}: ${x.correction}`).join('; ');
    const mark = h(
      'mark',
      {
        class: `err${covering[0].criterion ? ` err-${covering[0].criterion}` : ''}${covering.some((x) => x.active) ? ' active' : ''}`,
        tabindex: onSelectHighlight ? '0' : null,
        title: description,
        'aria-label': `${text} (error — ${description})`,
        dataset: { ids: covering.map((x) => x.id).join(' ') },
      },
      text,
    );
    if (onSelectHighlight) {
      const pick = () => onSelectHighlight(covering[0].id);
      mark.addEventListener('click', pick);
      mark.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
    }
    container.appendChild(mark);
  }
  return container;
}

/** Character offsets of the current selection inside an essayText container. */
export function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const offsetOf = (node: Node, offset: number): number => {
    const pre = document.createRange();
    pre.selectNodeContents(container);
    pre.setEnd(node, offset);
    return pre.toString().length;
  };
  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  return start < end ? { start, end } : null;
}
