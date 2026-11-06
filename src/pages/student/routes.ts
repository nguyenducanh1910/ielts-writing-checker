import type { Route } from '../../router';
import { assignedPage } from './assigned';
import { dashboardPage } from './dashboard';
import { newEssayPage, rewritePage, writePage } from './editor';
import { essayDetailPage } from './essayDetail';
import { essaysPage } from './essays';
import { settingsPage } from './settings';
import { topicsPage } from './topics';

export const routes: Route[] = [
  { pattern: '/dashboard', guard: 'student', title: 'Thống kê', render: dashboardPage },
  { pattern: '/essays', guard: 'student', title: 'Bài Writing của em', render: essaysPage },
  { pattern: '/essays/:id', guard: 'student', title: 'Bài viết', render: essayDetailPage },
  { pattern: '/new', guard: 'student', title: 'Viết bài', render: newEssayPage },
  { pattern: '/write/:id', guard: 'student', title: 'Đang viết', render: writePage },
  { pattern: '/rewrite/:parentId', guard: 'student', title: 'Viết lại', render: rewritePage },
  { pattern: '/assigned', guard: 'student', title: 'Bài thầy giao', render: assignedPage },
  { pattern: '/topics', guard: 'student', title: 'Chủ đề em đã viết', render: topicsPage },
  { pattern: '/settings', guard: 'user', title: 'Cài đặt', render: settingsPage },
];
