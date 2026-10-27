// Hash router (#/path?query) so GitHub Pages needs no server rewrites.
import { getUser } from './session';

export type Guard = 'public' | 'guest' | 'student' | 'admin' | 'user';

export interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
}

export interface Route {
  pattern: string;
  guard: Guard;
  title: string;
  render: (ctx: RouteContext) => Node | Promise<Node>;
}

const routes: Array<Route & { regex: RegExp; keys: string[] }> = [];
let cleanups: Array<() => void> = [];
let renderTarget: (node: Node, title: string) => void = () => undefined;
let renderSeq = 0;

export function addRoutes(list: Route[]) {
  for (const r of list) {
    const keys: string[] = [];
    const regex = new RegExp(
      '^' +
        r.pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_m, k: string) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '$',
    );
    routes.push({ ...r, regex, keys });
  }
}

/** Register work to undo when the user leaves the page (timers, listeners). */
export function onLeave(fn: () => void) {
  cleanups.push(fn);
}

/** A page with unsaved work registers a check; leaving then asks for confirmation. */
let hasUnsavedWork: (() => boolean) | null = null;
export function setUnsavedCheck(fn: (() => boolean) | null) {
  hasUnsavedWork = fn;
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  const hash = `#${path}`;
  if (options.replace) {
    history.replaceState(null, '', hash);
    void route();
  } else if (location.hash === hash) {
    void route();
  } else {
    location.hash = hash;
  }
}

export function currentPath(): { path: string; query: URLSearchParams } {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs ?? '') };
}

export function homeFor(): string {
  const user = getUser();
  if (!user) return '/login';
  return user.role === 'admin' ? '/admin' : '/dashboard';
}

let lastHash = location.hash;

export async function route() {
  if (
    hasUnsavedWork &&
    location.hash !== lastHash &&
    hasUnsavedWork() &&
    !window.confirm('You have unsaved changes. Leave this page anyway?')
  ) {
    history.replaceState(null, '', lastHash);
    return;
  }
  lastHash = location.hash;
  hasUnsavedWork = null;
  for (const fn of cleanups) {
    try {
      fn();
    } catch {
      // ignore cleanup errors
    }
  }
  cleanups = [];

  const { path, query } = currentPath();
  if (path === '/') return navigate(homeFor(), { replace: true });
  const match = routes.find((r) => r.regex.test(path));
  if (!match) return renderTarget(notFound(), 'Not found');
  const user = getUser();
  if (match.guard === 'guest' && user) return navigate(homeFor(), { replace: true });
  if (['student', 'admin', 'user'].includes(match.guard) && !user) {
    return navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
  }
  if (match.guard === 'admin' && user?.role !== 'admin')
    return renderTarget(forbidden(), 'No access');
  if (match.guard === 'student' && user?.role !== 'student') {
    return navigate(homeFor(), { replace: true });
  }
  const values = match.regex.exec(path)!.slice(1);
  const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(values[i])]));
  const seq = ++renderSeq;
  const node = await match.render({ params, query, path });
  if (seq === renderSeq) renderTarget(node, match.title);
}

export function startRouter(target: (node: Node, title: string) => void) {
  renderTarget = target;
  window.addEventListener('hashchange', () => void route());
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedWork?.()) e.preventDefault();
  });
  void route();
}

function notFound(): Node {
  const el = document.createElement('section');
  const h1 = document.createElement('h1');
  h1.textContent = 'Page not found';
  const a = document.createElement('a');
  a.href = '#/';
  a.textContent = 'Go to the home page';
  el.append(h1, a);
  return el;
}

function forbidden(): Node {
  const el = document.createElement('section');
  const h1 = document.createElement('h1');
  h1.textContent = 'You do not have access to this page';
  el.append(h1);
  return el;
}
