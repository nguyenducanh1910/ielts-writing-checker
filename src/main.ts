import './styles.css';
import { api, setSessionExpiredHandler } from './api';
import { h, replace } from './dom';
import { addRoutes, currentPath, navigate, startRouter } from './router';
import { clearSession, getUser } from './session';
import { authCallbackPage, loginPage, privacyPage, signupPage } from './pages/auth';
import { routes as studentRoutes } from './pages/student/routes';
import { routes as adminRoutes } from './pages/admin/routes';

addRoutes([
  { pattern: '/login', guard: 'guest', title: 'Log in', render: loginPage },
  { pattern: '/signup', guard: 'guest', title: 'Sign up', render: signupPage },
  { pattern: '/auth', guard: 'public', title: 'Logging in', render: authCallbackPage },
  { pattern: '/privacy', guard: 'public', title: 'Privacy notice', render: privacyPage },
  ...studentRoutes,
  ...adminRoutes,
]);

const STUDENT_NAV: Array<[string, string]> = [
  ['/dashboard', 'Dashboard'],
  ['/essays', 'My essays'],
  ['/new', 'Write'],
  ['/assigned', 'Assigned to me'],
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
];

const app = document.getElementById('app')!;
const header = h('header', { class: 'site-header' });
const main = h('main', { id: 'main', tabindex: '-1' });
const footer = h(
  'footer',
  { class: 'site-footer' },
  h('a', { href: '#/privacy' }, 'Privacy notice'),
);
app.append(header, main, footer);

// The skip link must not change the URL hash (the hash is the router's path).
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  main.focus();
  main.scrollIntoView();
});

function renderHeader() {
  const user = getUser();
  const { path } = currentPath();
  const items = user ? (user.role === 'admin' ? ADMIN_NAV : STUDENT_NAV) : [];
  const navLink = ([href, label]: [string, string]) => {
    const current =
      path === href || (href !== '/admin' && href !== '/new' && path.startsWith(`${href}/`));
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
    h('ul', null, ...items.map(navLink)),
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
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'H'),
      'IELTS Harper',
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

startRouter((node, title) => {
  renderHeader();
  replace(main, node);
  document.title = `${title} · IELTS Harper`;
  const heading = main.querySelector<HTMLElement>('h1');
  (heading ?? main).focus({ preventScroll: false });
  window.scrollTo(0, 0);
});
