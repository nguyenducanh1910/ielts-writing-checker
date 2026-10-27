import { describe, expect, it } from 'vitest';
import { callApi } from '../../apps-script/src/api';
import { createTestApp } from '../helpers';

describe('login links and sessions', () => {
  it('emails a single-use link and creates a session', () => {
    const app = createTestApp();
    app.call('auth.requestLink', { email: 'Demo.An@Example.com' });
    const mail = app.svc.mail.outbox.at(-1)!;
    expect(mail.to).toBe('demo.an@example.com');
    const token = /token=([a-f0-9]+)/.exec(mail.text)![1];
    expect(token).toHaveLength(64);

    // Only the hash is stored.
    const stored = app.db().all('LoginTokens');
    expect(stored.some((t) => t.token_hash === token)).toBe(false);
    expect(stored.some((t) => t.token_hash === app.svc.sha256Hex(token))).toBe(true);

    const { sessionToken, user } = app.call('auth.exchange', { token });
    expect(user.role).toBe('student');
    expect(
      app
        .db()
        .all('Sessions')
        .some((s) => s.token_hash === sessionToken),
    ).toBe(false);
    expect(app.call('me.get', {}, sessionToken).email).toBe('demo.an@example.com');

    // Single use.
    expect(() => app.call('auth.exchange', { token })).toThrow(/invalid or has expired/);
  });

  it('requires consent and a valid class', () => {
    const app = createTestApp();
    try {
      app.call('auth.signup', { name: 'X Y', email: 'x@example.com', classId: 'nope' });
      expect.fail('should throw');
    } catch (err) {
      const fields = (err as { fields: Record<string, string> }).fields;
      expect(fields.consent).toBeDefined();
      expect(fields.classId).toBeDefined();
      expect(fields.password).toBeDefined();
    }
  });

  it('expires login links after 15 minutes', () => {
    const app = createTestApp();
    app.call('auth.requestLink', { email: 'demo.an@example.com' });
    const token = /token=([a-f0-9]+)/.exec(app.svc.mail.outbox.at(-1)!.text)![1];
    app.svc.advance(16 * 60000);
    expect(() => app.call('auth.exchange', { token })).toThrow(/expired/);
  });

  it('gives the same answer for unknown emails and sends nothing', () => {
    const app = createTestApp();
    const res = app.call('auth.requestLink', { email: 'nobody@example.com' });
    expect(res.message).toMatch(/If that email is registered/);
    expect(app.svc.mail.outbox).toHaveLength(0);
  });

  it('rate limits to 3 links per email per hour and 30 overall', () => {
    const app = createTestApp();
    for (let i = 0; i < 5; i++) app.call('auth.requestLink', { email: 'demo.an@example.com' });
    expect(app.svc.mail.outbox).toHaveLength(3);
    app.svc.advance(61 * 60000);
    app.call('auth.requestLink', { email: 'demo.an@example.com' });
    expect(app.svc.mail.outbox).toHaveLength(4);

    app.svc.cache.clear();
    for (let i = 0; i < 40; i++) app.call('auth.requestLink', { email: `x${i}@example.com` });
    app.call('auth.requestLink', { email: 'demo.binh@example.com' });
    // Global budget of 30 used up by unknown emails, so Binh gets nothing this hour.
    expect(app.svc.mail.outbox.filter((m) => m.to === 'demo.binh@example.com')).toHaveLength(0);
  });

  it('limits new sign-ups per hour', () => {
    const app = createTestApp();
    const classId = app.call('config.get').classes[0].id;
    let refused = 0;
    for (let i = 0; i < 35; i++) {
      const res = app.raw('auth.signup', {
        name: `User ${i}`,
        email: `u${i}@example.com`,
        password: 'long enough',
        classId,
        consent: true,
      });
      if (!res.ok) refused++;
    }
    expect(refused).toBe(5);
    expect(app.db().find('Users', (u) => u.email.startsWith('u'))).toHaveLength(30);
  });

  it('logout ends the session', () => {
    const app = createTestApp();
    const token = app.login('demo.an@example.com');
    app.call('auth.logout', {}, token);
    expect(() => app.call('me.get', {}, token)).toThrow(/unauthenticated/);
  });

  it('takes the role from ADMIN_EMAIL, never from input', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    expect(app.call('me.get', {}, admin).role).toBe('admin');
    const student = app.login('demo.an@example.com');
    // Extra fields are ignored; role cannot be set.
    app.call('me.update', { name: 'Nguyen Van An', role: 'admin' }, student);
    expect(app.call('me.get', {}, student).role).toBe('student');
  });

  it('rejects malformed requests', () => {
    const app = createTestApp();
    expect(app.raw('nope')).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    expect(callApi(app.svc, 'not json')).toMatchObject({ ok: false });
    expect(callApi(app.svc, '[]')).toMatchObject({ ok: false });
    expect(callApi(app.svc, '')).toMatchObject({ ok: false });
  });

  it('holds the script lock for writes and releases it', () => {
    const app = createTestApp();
    const before = app.svc.lock.acquisitions;
    app.call('auth.requestLink', { email: 'demo.an@example.com' });
    expect(app.svc.lock.acquisitions).toBe(before + 1);
    expect(app.svc.lock.held).toBe(false);
    app.call('config.get');
    expect(app.svc.lock.acquisitions).toBe(before + 1);
  });
});
