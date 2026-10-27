import type { Route } from '../../router';
import { assignedPage } from './assigned';
import { dashboardPage } from './dashboard';
import { newEssayPage, rewritePage, writePage } from './editor';
import { essayDetailPage } from './essayDetail';
import { essaysPage } from './essays';
import { settingsPage } from './settings';
import { topicsPage } from './topics';

export const routes: Route[] = [
  { pattern: '/dashboard', guard: 'student', title: 'Dashboard', render: dashboardPage },
  { pattern: '/essays', guard: 'student', title: 'My essays', render: essaysPage },
  { pattern: '/essays/:id', guard: 'student', title: 'Essay', render: essayDetailPage },
  { pattern: '/new', guard: 'student', title: 'Write', render: newEssayPage },
  { pattern: '/write/:id', guard: 'student', title: 'Writing', render: writePage },
  { pattern: '/rewrite/:parentId', guard: 'student', title: 'Rewrite', render: rewritePage },
  { pattern: '/assigned', guard: 'student', title: 'Assigned to me', render: assignedPage },
  { pattern: '/topics', guard: 'student', title: "Topics I've written", render: topicsPage },
  { pattern: '/settings', guard: 'user', title: 'Settings', render: settingsPage },
];
