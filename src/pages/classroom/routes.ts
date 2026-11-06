import type { Route } from '../../router';
import { assignPage } from './assign';
import { overviewPage } from './overview';
import { studentProgressPage, teacherProgressPage } from './progress';
import { resultsPage } from './results';
import { studentClassroomPage } from './student';
import { submissionsPage } from './submissions';

export const routes: Route[] = [
  { pattern: '/lop', guard: 'admin', title: 'Tổng quan lớp học', render: overviewPage },
  { pattern: '/lop/bai-nop', guard: 'admin', title: 'Bài nộp', render: submissionsPage },
  { pattern: '/lop/giao-bai', guard: 'admin', title: 'Giao bài', render: assignPage },
  { pattern: '/lop/ket-qua', guard: 'admin', title: 'Kết quả & phạt', render: resultsPage },
  { pattern: '/lop/hoc-sinh', guard: 'admin', title: 'Học sinh', render: teacherProgressPage },
  {
    pattern: '/lop-cua-em/tien-bo',
    guard: 'student',
    title: 'Tiến bộ & ôn tập',
    render: studentProgressPage,
  },
  {
    pattern: '/lop-cua-em',
    guard: 'student',
    title: 'Lớp học của em',
    render: studentClassroomPage,
  },
];
