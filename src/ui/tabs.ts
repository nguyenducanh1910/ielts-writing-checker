// Accessible tabs (WAI-ARIA pattern with arrow-key navigation).
import { h, uid } from '../dom';

export interface TabDef {
  id: string;
  label: string;
  panel: HTMLElement;
}

export interface Tabs {
  element: HTMLElement;
  select(id: string): void;
}

export function tabs(defs: TabDef[], label: string): Tabs {
  const prefix = uid('tabs');
  const buttons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  const select = (id: string, focus = false) => {
    defs.forEach((d, i) => {
      const on = d.id === id;
      buttons[i].setAttribute('aria-selected', String(on));
      buttons[i].tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
      if (on && focus) buttons[i].focus();
    });
  };
  const list = h('div', { role: 'tablist', 'aria-label': label });
  defs.forEach((d, i) => {
    const btn = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `${prefix}-tab-${i}`,
        'aria-controls': `${prefix}-panel-${i}`,
      },
      d.label,
    );
    btn.addEventListener('click', () => select(d.id));
    btn.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (e.key === 'Home') select(defs[0].id, true);
      else if (e.key === 'End') select(defs[defs.length - 1].id, true);
      else if (dir) select(defs[(i + dir + defs.length) % defs.length].id, true);
      else return;
      e.preventDefault();
    });
    buttons.push(btn);
    list.appendChild(btn);
    const panel = h(
      'div',
      { role: 'tabpanel', id: `${prefix}-panel-${i}`, 'aria-labelledby': btn.id, tabindex: '0' },
      d.panel,
    );
    panels.push(panel);
  });
  const element = h('div', { class: 'tabs' }, list, ...panels);
  if (defs.length) select(defs[0].id);
  return { element, select: (id) => select(id, true) };
}
