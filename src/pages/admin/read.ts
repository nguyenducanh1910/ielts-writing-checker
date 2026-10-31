// Read all: every essay matching the queue filters, one after another on one page, so the teacher
// can read a whole group (for example every answer to one prompt) without opening each essay.
// Reading changes nothing: no status, no email.
import { MIN_WORDS, type TaskType } from '../../../shared/constants';
import { promptKey } from '../../../shared/promptKey';
import { api } from '../../api';
import { type Child, h, replace } from '../../dom';
import type { RouteContext } from '../../router';
import { async, badge, busy, empty, errorBox, link, page } from '../../ui/components';
import { formatDateTime, QUEUE_STATUS_LABELS, taskLabel } from '../../ui/format';
import { remoteImage } from '../../ui/image';
import { filterQuery, NEXT_KEYS, queueFilters } from './queue';
import type { QueueResponse, ReadItem } from './types';

/** Essays fetched per request; matches READ_MAX on the server. */
const PAGE_SIZE = 20;

export function readAllPage(ctx: RouteContext): Node {
  const q = ctx.query;
  const back = link(`/admin${filterQuery(q)}`, '← Back to the queue');
  return page(
    'Read all',
    h('p', null, back),
    async(
      async () => {
        const queue = await api<QueueResponse>('admin.queue', queueFilters(q));
        const first = queue.items.slice(0, PAGE_SIZE).map((i) => i.id);
        const read = first.length
          ? await api<{ items: ReadItem[] }>('admin.readEssays', { ids: first })
          : { items: [] };
        return { queue, first: read.items };
      },
      ({ queue, first }) => {
        const ids = queue.items.map((i) => i.id);
        if (!ids.length) return empty('No essays match these filters.');
        return readView(queue, ids, first, filterQuery(q, NEXT_KEYS));
      },
      'Loading the essays…',
    ),
  );
}

function readView(
  queue: QueueResponse,
  ids: string[],
  first: ReadItem[],
  scoreQuery: string,
): Child[] {
  const nav = h('ol', { class: 'read-nav-list' });
  const list = h('div', { class: 'read-list' });
  const more = h('div', { class: 'read-more', 'aria-live': 'polite' });
  const articles: HTMLElement[] = [];
  let loaded = 0;
  let prevKey = '';

  // Navigation entries for every essay; the ones not loaded yet load on click.
  const names = new Map(queue.items.map((i) => [i.id, i.studentName]));
  const navLinks = ids.map((id, n) => {
    const a = h(
      'a',
      { href: `#read-${id}`, class: 'read-nav-link' },
      `${n + 1}. ${names.get(id) ?? ''}`,
    );
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      while (n >= loaded && (await loadMore())) {
        // Keep loading until the essay is on the page.
      }
      go(n);
    });
    nav.appendChild(h('li', null, a));
    return a;
  });

  // An essay counts as read once its end has been on screen.
  const seen =
    'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const n = Number((entry.target as HTMLElement).dataset.index);
            navLinks[n]?.classList.add('read');
            navLinks[n]?.setAttribute('aria-label', `${navLinks[n].textContent} (read)`);
            seen?.unobserve(entry.target);
          }
        })
      : null;

  const add = (items: ReadItem[]) => {
    for (const item of items) {
      const n = loaded++;
      const key = promptKey(item.prompt);
      const article = essayArticle(item, n, ids.length, key !== '' && key === prevKey, scoreQuery);
      prevKey = key;
      articles.push(article);
      list.appendChild(article);
      const end = article.querySelector<HTMLElement>('.read-end');
      if (end && seen) seen.observe(end);
    }
    renderMore();
  };

  let loading: Promise<boolean> | null = null;
  const loadMore = (): Promise<boolean> => {
    if (loaded >= ids.length) return Promise.resolve(false);
    loading ??= api<{ items: ReadItem[] }>('admin.readEssays', {
      ids: ids.slice(loaded, loaded + PAGE_SIZE),
    })
      .then((res) => {
        // An essay deleted in the meantime is skipped, not retried for ever.
        if (!res.items.length) loaded = Math.min(ids.length, loaded + PAGE_SIZE);
        add(res.items);
        return true;
      })
      .catch((err) => {
        replace(more, errorBox(err), moreButton());
        return false;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };

  const moreButton = () => {
    const btn = h(
      'button',
      { type: 'button', class: 'btn' },
      `Load the next ${Math.min(PAGE_SIZE, ids.length - loaded)} essays`,
    );
    btn.addEventListener('click', () => busy(btn, 'Loading…', () => loadMore().then(() => {})));
    return btn;
  };

  const renderMore = () => {
    replace(
      more,
      loaded < ids.length
        ? [h('p', { class: 'hint' }, `Showing ${loaded} of ${ids.length}.`), moreButton()]
        : h('p', { class: 'hint' }, `That's all ${ids.length} essays.`),
    );
  };

  /** Scroll to essay n and move focus to its heading. */
  const go = (n: number) => {
    const article = articles[n];
    if (!article) return;
    article.scrollIntoView({ behavior: 'smooth', block: 'start' });
    article.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  };

  /** The essay whose top is nearest above the middle of the screen. */
  const current = (): number => {
    const middle = window.innerHeight / 3;
    let index = 0;
    articles.forEach((a, i) => {
      if (a.getBoundingClientRect().top <= middle) index = i;
    });
    return index;
  };

  // J / K move to the next / previous essay (not while typing in a field).
  const onKey = (e: KeyboardEvent) => {
    if (!list.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = e.key.toLowerCase();
    if (key !== 'j' && key !== 'k') return;
    e.preventDefault();
    const n = current();
    if (key === 'j') {
      if (n + 1 < loaded) go(n + 1);
      else loadMore().then((ok) => ok && go(n + 1));
    } else {
      go(Math.max(0, n - 1));
    }
  };
  document.addEventListener('keydown', onKey);

  add(first);
  return [
    h(
      'p',
      { class: 'hint' },
      `${ids.length} essay${ids.length === 1 ? '' : 's'} in queue order. Press `,
      h('kbd', null, 'J'),
      ' for the next essay and ',
      h('kbd', null, 'K'),
      ' for the previous one. Reading changes nothing for the student.',
    ),
    h(
      'div',
      { class: 'read-layout' },
      h(
        'nav',
        { class: 'read-nav', 'aria-label': 'Essays on this page' },
        h('h2', { class: 'read-nav-title' }, 'Students'),
        nav,
      ),
      h('div', null, list, more),
    ),
  ];
}

function essayArticle(
  item: ReadItem,
  n: number,
  total: number,
  samePromptAsAbove: boolean,
  scoreQuery: string,
): HTMLElement {
  const min = MIN_WORDS[item.taskType as TaskType] ?? 0;
  const scored = item.queueStatus === 'scored';
  const headingId = `read-h-${item.id}`;
  const status = scored
    ? badge(
        item.overall !== null ? `Scored · Band ${item.overall.toFixed(1)}` : 'Scored',
        'success',
      )
    : badge(QUEUE_STATUS_LABELS[item.queueStatus] ?? item.queueStatus, 'info');
  const chart = h('div');
  if (item.hasImage) {
    // Charts load when the essay comes near the screen, so a long page stays quick.
    const show = () =>
      replace(
        chart,
        remoteImage('admin.essayImage', { essayId: item.id }, 'Chart or diagram for this task'),
      );
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((x) => x.isIntersecting)) {
            io.disconnect();
            show();
          }
        },
        { rootMargin: '400px 0px' },
      );
      io.observe(chart);
    } else {
      show();
    }
  }
  return h(
    'article',
    {
      class: 'card read-essay',
      id: `read-${item.id}`,
      'aria-labelledby': headingId,
      'data-index': String(n),
    },
    h(
      'h2',
      { id: headingId, tabindex: '-1' },
      `${n + 1}. ${item.studentName}`,
      item.className ? h('span', { class: 'read-class' }, ` · ${item.className}`) : null,
    ),
    h(
      'p',
      { class: 'hint' },
      `${n + 1} of ${total} · ${taskLabel(item.taskType)} · ${item.topic} · Submitted ${formatDateTime(item.submittedAt)}`,
    ),
    h(
      'p',
      null,
      status,
      ' ',
      badge(`${item.wordCount} words`, item.wordCount < min ? 'warning' : ''),
      item.wordCount < min ? h('span', { class: 'sr-only' }, ` (under ${min})`) : null,
      item.isRewrite ? [' ', badge('Rewrite', 'info')] : null,
      item.assignmentTitle ? [' ', badge(item.assignmentTitle)] : null,
    ),
    samePromptAsAbove
      ? h('p', { class: 'hint' }, 'Same prompt as the essay above.')
      : [h('h3', null, 'Prompt'), h('p', { class: 'prompt-text' }, item.prompt)],
    chart,
    h('h3', null, 'Essay'),
    h('div', { class: 'essay-text' }, item.body),
    h(
      'p',
      { class: 'read-end' },
      link(`/admin/score/${item.id}${scoreQuery}`, scored ? 'Edit score' : 'Score this', {
        class: 'btn btn-small btn-primary',
      }),
    ),
  );
}
