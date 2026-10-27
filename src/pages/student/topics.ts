// Topics I've written, and seeded topics not yet attempted.
import { api } from '../../api';
import { h } from '../../dom';
import { async, badge, empty, link, page, table } from '../../ui/components';
import { formatBand, formatDate, modeLabel, taskLabel } from '../../ui/format';

export interface TopicHistory {
  rows: Array<{
    essayId: string;
    topicId: string;
    topic: string;
    taskType: string;
    mode: string;
    date: string;
    overall: number | null;
  }>;
  notAttempted: string[];
  diagramTypesNotAttempted?: string[];
  essayTypesNotAttempted?: string[];
}

function gapList(title: string, items: string[] | undefined, done: string): HTMLElement[] {
  return [
    h('h2', null, title),
    items && items.length
      ? h('ul', { class: 'tag-list' }, ...items.map((t) => h('li', null, badge(t, 'warning'))))
      : h('p', null, done),
  ];
}

export function topicHistoryView(
  data: TopicHistory,
  essayHref: (id: string) => string,
): HTMLElement {
  return h(
    'div',
    null,
    data.rows.length
      ? table(
          ['Topic / type', 'Task type', 'Mode', 'Date', 'Overall', ''],
          data.rows.map((r) => [
            r.topic,
            taskLabel(r.taskType),
            modeLabel(r.mode),
            formatDate(r.date),
            r.overall === null ? badge('Pending') : formatBand(r.overall),
            link(essayHref(r.essayId), 'Open essay'),
          ]),
          'Submitted essays by topic, newest first',
        )
      : empty('No submitted essays yet.'),
    ...gapList(
      'Task 2 topics not yet attempted',
      data.notAttempted,
      'You have written about every topic. Great coverage!',
    ),
    ...gapList(
      'Task 2 essay types not yet attempted',
      data.essayTypesNotAttempted,
      'You have tried every essay type.',
    ),
    ...gapList(
      'Task 1 diagram types not yet attempted',
      data.diagramTypesNotAttempted,
      'You have tried every diagram type.',
    ),
  );
}

export function topicsPage(): Node {
  return page(
    "Topics I've written",
    async(
      () => api<TopicHistory>('topics.history'),
      (data) => topicHistoryView(data, (id) => `/essays/${id}`),
      'Loading topics…',
    ),
  );
}
