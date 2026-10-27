// Tiny DOM builder. Text is always inserted as text nodes, never parsed as HTML.

export type Child = Node | string | number | null | undefined | false | Child[];

type Props = {
  [key: string]: unknown;
  class?: string;
  dataset?: Record<string, string>;
  style?: string;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'dataset') {
        Object.assign(el.dataset, value as Record<string, string>);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === 'value' && 'value' in el) {
        (el as HTMLInputElement).value = String(value);
      } else if (key === 'checked' && 'checked' in el) {
        (el as HTMLInputElement).checked = Boolean(value);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replace(el: Element, ...children: Child[]) {
  clear(el);
  append(el, children);
}

let idSeq = 0;
export function uid(prefix = 'id'): string {
  return `${prefix}-${++idSeq}`;
}
