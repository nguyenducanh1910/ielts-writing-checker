import type { Route } from '../../router';
import { addEssayPage } from './addEssay';
import { assignmentDetailPage, assignmentsPage, newAssignmentPage } from './assignments';
import { calibrationPage } from './calibration';
import { claudeSetupPage } from './claudeSetup';
import { emailsPage } from './emails';
import { listsPage } from './lists';
import { queuePage } from './queue';
import { scoringPage } from './scoring';
import { studentOverviewPage, studentsPage } from './students';

export const routes: Route[] = [
  { pattern: '/admin', guard: 'admin', title: 'Queue', render: queuePage },
  { pattern: '/admin/essays/new', guard: 'admin', title: 'Add an essay', render: addEssayPage },
  { pattern: '/admin/score/:id', guard: 'admin', title: 'Scoring', render: scoringPage },
  { pattern: '/admin/students', guard: 'admin', title: 'Students', render: studentsPage },
  {
    pattern: '/admin/students/:id',
    guard: 'admin',
    title: 'Student overview',
    render: studentOverviewPage,
  },
  { pattern: '/admin/assignments', guard: 'admin', title: 'Assignments', render: assignmentsPage },
  {
    pattern: '/admin/assignments/new',
    guard: 'admin',
    title: 'New assignment',
    render: newAssignmentPage,
  },
  {
    pattern: '/admin/assignments/:id',
    guard: 'admin',
    title: 'Assignment',
    render: assignmentDetailPage,
  },
  {
    pattern: '/admin/calibration',
    guard: 'admin',
    title: 'Source calibration',
    render: calibrationPage,
  },
  { pattern: '/admin/lists', guard: 'admin', title: 'Lists', render: listsPage },
  { pattern: '/admin/claude', guard: 'admin', title: 'Claude setup', render: claudeSetupPage },
  { pattern: '/admin/emails', guard: 'admin', title: 'Email', render: emailsPage },
];
