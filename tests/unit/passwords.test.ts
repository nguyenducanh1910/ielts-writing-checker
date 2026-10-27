import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers';

type App = ReturnType<typeof createTestApp>;

function signup(app: App, email: string, password = 'secret-pass') {
  const classId = app.call('config.get').classes[0].id;
  return app.call('auth.signup', {
    name: 'Le Thi Hoa',
    email,
    password,
    classId,
    consent: true,
    timezone: 'Asia/Ho_Chi_Minh',
  });
}

describe('passwords', () => {
  it('signs up straight into the site without sending email', () => {
    const app = createTestApp();
    const res = signup(app, 'Hoa@Example.com');
    expect(app.svc.mail.outbox).toHaveLength(0);
    expect(res.user).toMatchObject({
      email: 'hoa@example.com',
      role: 'student',
      hasPassword: true,
    });
    expect(app.call('me.get', {}, res.sessionToken).email).toBe('hoa@example.com');
    // Only a salted, iterated hash is stored.
    const row = app.db().findOne('Users', (u) => u.email === 'hoa@example.com')!;
    expect(row.password_hash).toMatch(/^v1\$1000\$[a-f0-9]+\$[a-f0-9]{64}$/);
    expect(row.password_hash).not.toContain('secret-pass');
  });

  it('logs in with the right password only', () => {
    const app = createTestApp();
    signup(app, 'hoa@example.com');
    const res = app.call('auth.login', { email: ' HOA@example.com ', password: 'secret-pass' });
    expect(app.call('me.get', {}, res.sessionToken).name).toBe('Le Thi Hoa');
    expect(() =>
      app.call('auth.login', { email: 'hoa@example.com', password: 'wrong-pass' }),
    ).toThrow(/email or password is incorrect/);
    expect(() => app.call('auth.login', { email: 'nobody@example.com', password: 'x' })).toThrow(
      /email or password is incorrect/,
    );
  });

  it('rate limits password attempts per email', () => {
    const app = createTestApp();
    signup(app, 'hoa@example.com');
    for (let i = 0; i < 10; i++) {
      expect(app.raw('auth.login', { email: 'hoa@example.com', password: 'guess' }).ok).toBe(false);
    }
    expect(() =>
      app.call('auth.login', { email: 'hoa@example.com', password: 'secret-pass' }),
    ).toThrow(/Too many login attempts/);
  });

  it('lets an unused account without a password be claimed by signing up', () => {
    const app = createTestApp();
    // A student the teacher added, or someone whose login email never arrived.
    const before = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    app.db().remove('Essays', (e) => e.student_id === before.id);
    // Logging in to it emails a login link instead of failing.
    expect(
      app.call('auth.login', { email: 'demo.binh@example.com', password: 'whatever1' }),
    ).toEqual({ linkSent: true, email: 'demo.binh@example.com', knownAccount: true });
    const res = signup(app, 'demo.binh@example.com');
    expect(res.user.id).toBe(before.id);
    expect(res.user.name).toBe(before.name);
    // Now it has a password, so signing up again is refused.
    expect(() => signup(app, 'demo.binh@example.com', 'another-pass')).toThrow(
      /already has an account/,
    );
  });

  it('refuses to claim an account someone already used', () => {
    const app = createTestApp();
    app.login('demo.an@example.com');
    expect(() => signup(app, 'demo.an@example.com')).toThrow(/already has an account/);
    // A password-less account that was used: logging in emails a login link.
    const before = app.svc.mail.outbox.length;
    expect(
      app.call('auth.login', { email: 'demo.an@example.com', password: 'whatever1' }),
    ).toMatchObject({ linkSent: true, knownAccount: true });
    const mail = app.svc.mail.outbox.slice(before).find((m) => m.to === 'demo.an@example.com');
    expect(mail?.text).toMatch(/token=/);
  });

  it('sets and changes the password from Settings', () => {
    const app = createTestApp();
    const token = app.login('demo.an@example.com');
    expect(app.call('me.get', {}, token).hasPassword).toBe(false);
    expect(app.call('me.setPassword', { newPassword: 'first-pass' }, token).hasPassword).toBe(true);
    // Changing it needs the current password.
    expect(() => app.call('me.setPassword', { newPassword: 'second-pass' }, token)).toThrow();
    app.call(
      'me.setPassword',
      { currentPassword: 'first-pass', newPassword: 'second-pass' },
      token,
    );
    expect(
      app.raw('auth.login', { email: 'demo.an@example.com', password: 'second-pass' }).ok,
    ).toBe(true);
    expect(() =>
      app.call('me.setPassword', { currentPassword: 'second-pass', newPassword: 'short' }, token),
    ).toThrow();
  });

  it('lets only the admin set a student password, and never returns the hash', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const student = app.login('demo.an@example.com');
    const an = app.db().findOne('Users', (u) => u.email === 'demo.an@example.com')!;
    expect(() =>
      app.call(
        'admin.students.setPassword',
        { studentId: an.id, password: 'teacher-set' },
        student,
      ),
    ).toThrow(/forbidden/);
    app.call('admin.students.setPassword', { studentId: an.id, password: 'teacher-set' }, admin);
    expect(
      app.raw('auth.login', { email: 'demo.an@example.com', password: 'teacher-set' }).ok,
    ).toBe(true);
    const list = app.call('admin.students', {}, admin) as Array<Record<string, unknown>>;
    expect(list.find((s) => s.id === an.id)).toMatchObject({ hasPassword: true });
    expect(JSON.stringify(list)).not.toContain('v1$');
    expect(JSON.stringify(app.call('me.get', {}, student))).not.toContain('v1$');
  });

  it('an empty password asks for a login link, without saying whether the email has an account', () => {
    const app = createTestApp();
    const before = app.svc.mail.outbox.length;
    const known = app.call('auth.login', { email: 'demo.an@example.com', password: '' });
    const unknown = app.call('auth.login', { email: 'nobody@example.com', password: '' });
    expect(known).toEqual({ linkSent: true, email: 'demo.an@example.com' });
    expect(unknown).toEqual({ linkSent: true, email: 'nobody@example.com' });
    const sent = app.svc.mail.outbox.slice(before).map((m) => m.to);
    expect(sent).toEqual(['demo.an@example.com']);
  });
});
