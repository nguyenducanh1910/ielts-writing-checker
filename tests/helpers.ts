import { callApi } from '../apps-script/src/api';
import { createCtx } from '../apps-script/src/context';
import { runSetup } from '../apps-script/src/setup';
import { createMemoryServices, type MemoryServices } from '../apps-script/testing/memory';

export interface TestApp {
  svc: MemoryServices;
  raw(action: string, payload?: unknown, token?: string): ReturnType<typeof callApi>;
  call<T = any>(action: string, payload?: unknown, token?: string): T;
  login(email: string): string;
  db(): ReturnType<typeof createCtx>['db'];
}

export function createTestApp(options: { demo?: boolean } = {}): TestApp {
  const svc = createMemoryServices();
  runSetup(svc, { demo: options.demo ?? true });
  const app: TestApp = {
    svc,
    raw(action, payload = {}, token) {
      return callApi(svc, JSON.stringify({ action, payload, token }));
    },
    call(action, payload = {}, token) {
      const res = app.raw(action, payload, token);
      if (!res.ok) {
        const err = new Error(`${action}: ${res.error.code} ${res.error.message}`) as Error & {
          code: string;
          fields?: Record<string, string>;
        };
        err.code = res.error.code;
        err.fields = res.error.fields;
        throw err;
      }
      return res.data as any;
    },
    login(email) {
      const before = svc.mail.outbox.length;
      app.call('auth.requestLink', { email });
      const mail = svc.mail.outbox.slice(before).find((m) => m.to === email);
      if (!mail) throw new Error(`No login email for ${email}`);
      const token = /token=([a-f0-9]+)/.exec(mail.text)?.[1];
      if (!token) throw new Error('No token in email');
      // Login links are rate limited per email; tests log in many times.
      svc.cache.clear();
      return app.call('auth.exchange', { token }).sessionToken as string;
    },
    db() {
      return createCtx(svc).db;
    },
  };
  return app;
}
