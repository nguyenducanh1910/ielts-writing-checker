import type { Route } from '../../router';
import { assignPage } from './assign';
import { overviewPage } from './overview';
import { resultsPage } from './results';
import { studentClassroomPage } from './student';
import { submissionsPage } from './submissions';

export const routes: Route[] = [
  { pattern: '/lop', guard: 'admin', title: 'Tổng quan lớp học', render: overviewPage },
  { pattern: '/lop/bai-nop', guard: 'admin', title: 'Bài nộp', render: submissionsPage },
  { pattern: '/lop/giao-bai', guard: 'admin', title: 'Giao bài', render: assignPage },
  { pattern: '/lop/ket-qua', guard: 'admin', title: 'Kết quả & phạt', render: resultsPage },
  {
    pattern: '/lop-cua-em',
    guard: 'student',
    title: 'Lớp học của em',
    render: studentClassroomPage,
  },
];

/** Admin menu sections: the class system and the Writing site. */
export const CLASSROOM_NAV: Array<[string, string]> = [
  ['/lop', 'Tổng quan'],
  ['/lop/bai-nop', 'Bài nộp'],
  ['/lop/giao-bai', 'Giao bài'],
  ['/lop/ket-qua', 'Kết quả & phạt'],
];
