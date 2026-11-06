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
          ['Chủ đề / dạng bài', 'Dạng đề', 'Hình thức', 'Ngày', 'Tổng', ''],
          data.rows.map((r) => [
            r.topic,
            taskLabel(r.taskType),
            modeLabel(r.mode),
            formatDate(r.date),
            r.overall === null ? badge('Chờ chấm') : formatBand(r.overall),
            link(essayHref(r.essayId), 'Mở bài'),
          ]),
          'Bài đã nộp theo chủ đề, mới nhất trước',
        )
      : empty('Em chưa nộp bài nào.'),
    ...gapList(
      'Chủ đề Task 2 em chưa viết',
      data.notAttempted,
      'Em đã viết đủ mọi chủ đề. Rất tốt!',
    ),
    ...gapList(
      'Dạng bài Task 2 em chưa viết',
      data.essayTypesNotAttempted,
      'Em đã thử mọi dạng bài.',
    ),
    ...gapList(
      'Dạng biểu đồ Task 1 em chưa viết',
      data.diagramTypesNotAttempted,
      'Em đã thử mọi dạng biểu đồ.',
    ),
  );
}

export function topicsPage(): Node {
  return page(
    'Chủ đề em đã viết',
    async(
      () => api<TopicHistory>('topics.history'),
      (data) => topicHistoryView(data, (id) => `/essays/${id}`),
      'Đang tải chủ đề…',
    ),
  );
}
