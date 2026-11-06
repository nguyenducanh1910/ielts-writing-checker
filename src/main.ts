import './styles.css';
import { api, setSessionExpiredHandler } from './api';
import { h, replace } from './dom';
import { addRoutes, currentPath, navigate, startRouter } from './router';
import { clearSession, getUser } from './session';
import { authCallbackPage, loginPage, privacyPage, signupPage } from './pages/auth';
import { routes as studentRoutes } from './pages/student/routes';
import { routes as adminRoutes } from './pages/admin/routes';
import { routes as classroomRoutes } from './pages/classroom/routes';
import { classroomEnabled, setClassroomExpiredHandler } from './classroomApi';
import { installErrorReporting, reportClientError, showVersionStatus } from './health';
import { setRenderErrorHandler } from './ui/components';

installErrorReporting();
setRenderErrorHandler((err) => reportClientError(err, 'render'));

addRoutes([
  { pattern: '/login', guard: 'guest', title: 'Log in', render: loginPage },
  { pattern: '/signup', guard: 'guest', title: 'Sign up', render: signupPage },
  { pattern: '/auth', guard: 'public', title: 'Logging in', render: authCallbackPage },
  { pattern: '/privacy', guard: 'public', title: 'Privacy notice', render: privacyPage },
  ...studentRoutes,
  ...adminRoutes,
  ...(classroomEnabled() ? classroomRoutes : []),
]);

const STUDENT_NAV: Array<[string, string]> = [
  ...(classroomEnabled()
    ? ([
        ['/lop-cua-em', 'Lớp học'],
        ['/lop-cua-em/tien-bo', 'Tiến bộ'],
      ] as Array<[string, string]>)
    : []),
  ['/essays', 'My essays'],
  ['/new', 'Write'],
  ['/assigned', 'Assigned to me'],
  ['/dashboard', 'Dashboard'],
  ['/topics', 'Topics'],
  ['/settings', 'Settings'],
];

const ADMIN_NAV: Array<[string, string]> = [
  ['/admin', 'Queue'],
  ['/admin/students', 'Students'],
  ['/admin/assignments', 'Assignments'],
  ['/admin/calibration', 'Source calibration'],
  ['/admin/emails', 'Email'],
  ['/admin/lists', 'Lists'],
  ['/admin/claude', 'Claude setup'],
  ['/admin/ai', 'Chấm tự động'],
];

// With the class system connected, the teacher has one menu: class pages, Writing scoring,
// and the less used Writing tools under "Công cụ Writing".
const TEACHER_NAV: Array<[string, string]> = [
  ['/lop', 'Tổng quan'],
  ['/lop/bai-nop', 'Bài nộp'],
  ['/admin', 'Chấm Writing'],
  ['/lop/giao-bai', 'Giao bài'],
  ['/lop/ket-qua', 'Kết quả & phạt'],
  ['/lop/hoc-sinh', 'Học sinh'],
];
const WRITING_TOOLS: Array<[string, string]> = [
  ['/admin/students', 'Học sinh (Writing)'],
  ['/admin/assignments', 'Đề giao (Writing)'],
  ['/admin/ai', 'Chấm tự động'],
  ['/admin/calibration', 'Hiệu chỉnh theo nguồn'],
  ['/admin/emails', 'Email'],
  ['/admin/lists', 'Danh sách lỗi'],
  ['/admin/claude', 'Cài đặt Claude'],
];
/** Writing pages reached from the scoring queue count as "Chấm Writing". */
const SCORING_PAGES = /^\/admin(\/score\/|\/read$|\/essays\/)/;

const app = document.getElementById('app')!;
const header = h('header', { class: 'site-header' });
const main = h('main', { id: 'main', tabindex: '-1' });
const versionSlot = h('div', { class: 'version-slot' });
const versionText = h('span', { class: 'version-line' });
const footer = h(
  'footer',
  { class: 'site-footer' },
  h('a', { href: '#/privacy' }, 'Privacy notice'),
  ' ',
  versionText,
);
app.append(header, versionSlot, main, footer);

// The skip link must not change the URL hash (the hash is the router's path).
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  main.focus();
  main.scrollIntoView();
});

function renderHeader() {
  const user = getUser();
  const { path } = currentPath();
  const teacher = user?.role === 'admin';
  const unified = teacher && classroomEnabled();
  const items = user ? (teacher ? (unified ? TEACHER_NAV : ADMIN_NAV) : STUDENT_NAV) : [];
  const isCurrent = (href: string) =>
    path === href ||
    (href === '/admin' && SCORING_PAGES.test(path)) ||
    (href !== '/admin' &&
      href !== '/new' &&
      href !== '/lop' &&
      href !== '/lop-cua-em' &&
      path.startsWith(`${href}/`));
  const toolsCurrent = unified && WRITING_TOOLS.some(([href]) => isCurrent(href));
  const tools = unified
    ? h(
        'li',
        null,
        h(
          'details',
          { class: 'nav-more' },
          h('summary', { 'aria-current': toolsCurrent ? 'page' : null }, 'Công cụ Writing'),
          h(
            'ul',
            null,
            ...WRITING_TOOLS.map(([href, label]) =>
              h(
                'li',
                null,
                h(
                  'a',
                  { href: `#${href}`, 'aria-current': isCurrent(href) ? 'page' : null },
                  label,
                ),
              ),
            ),
          ),
        ),
      )
    : null;
  const navLink = ([href, label]: [string, string]) => {
    const current = isCurrent(href);
    return h(
      'li',
      null,
      h('a', { href: `#${href}`, 'aria-current': current ? 'page' : null }, label),
    );
  };
  const logout = h('button', { type: 'button', class: 'btn btn-small' }, 'Log out');
  logout.addEventListener('click', async () => {
    try {
      await api('auth.logout');
    } catch {
      // The session is cleared locally either way.
    }
    clearSession();
    navigate('/login');
  });
  const toggle = h(
    'button',
    { type: 'button', class: 'nav-toggle', 'aria-expanded': 'false', 'aria-controls': 'site-nav' },
    'Menu',
  );
  const nav = h(
    'nav',
    { id: 'site-nav', 'aria-label': 'Main' },
    h('ul', null, ...items.map(navLink), tools),
    user
      ? h(
          'div',
          { class: 'user-box' },
          // Students have Settings in the menu; the admin reaches it (e.g. to set a password) here.
          user.role === 'admin'
            ? h('a', { href: '#/settings', title: 'Settings' }, user.name)
            : h('span', null, user.name),
          logout,
        )
      : null,
  );
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    nav.classList.toggle('open', !open);
  });
  replace(
    header,
    h(
      'a',
      { class: 'brand', href: '#/' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'A'),
      'IELTS Classroom Portal',
    ),
    user ? toggle : null,
    user
      ? nav
      : h(
          'nav',
          { 'aria-label': 'Main' },
          h('a', { href: '#/login' }, 'Log in'),
          ' ',
          h('a', { href: '#/signup' }, 'Sign up'),
        ),
  );
}

setSessionExpiredHandler(() => {
  navigate('/login?expired=1');
});
setClassroomExpiredHandler(() => {
  navigate('/login?expired=1');
});

startRouter((node, title) => {
  renderHeader();
  showVersionStatus(getUser()?.role === 'admin', versionSlot, versionText);
  replace(main, node);
  document.title = `${title} · IELTS Classroom Portal`;
  const heading = main.querySelector<HTMLElement>('h1');
  (heading ?? main).focus({ preventScroll: false });
  window.scrollTo(0, 0);
});
