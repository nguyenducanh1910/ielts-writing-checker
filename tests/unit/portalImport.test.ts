import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers';

const SECRET = 'portal-secret-'.padEnd(64, 'x');
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const BODY = 'Public transport should be cheaper for everyone. '.repeat(30);

function setup() {
  const app = createTestApp();
  app.svc.props.PORTAL_SECRET = SECRET;
  const admin = app.login('admin@example.com');
  const config = app.call('config.get');
  const topic = (label: string) => config.topics.find((t: any) => t.label === label).id;
  const base = (over: Record<string, unknown> = {}) => ({
    secret: SECRET,
    submissionId: 'sub-0000-0001',
    studentEmail: 'demo.binh@example.com',
    studentName: 'Tran Thi Binh',
    taskType: 'task2',
    topicId: topic('Transport'),
    essayType: 'discussion',
    prompt: 'Discuss whether public transport should be free.',
    body: BODY,
    mode: 'practice',
    ...over,
  });
  return { app, admin, base };
}

describe('essays imported from IELTS Harper Portal', () => {
  it('joins the normal queue and Drive archive for the matching student', () => {
    const { app, admin, base } = setup();
    const res = app.call('portal.essays.import', base());
    expect(res).toMatchObject({ duplicate: false, driveStatus: 'ok' });
    const essay = app.db().byId('Essays', res.essayId)!;
    const binh = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    expect(essay).toMatchObject({
      student_id: binh.id,
      status: 'pending',
      mode: 'practice',
      source: 'portal:sub-0000-0001',
    });
    const item = app.call('admin.queue', {}, admin).items.find((i: any) => i.id === res.essayId);
    expect(item).toBeTruthy();
  });

  it('is idempotent: a retried request does not create a second essay', () => {
    const { app, base } = setup();
    const first = app.call('portal.essays.import', base());
    const again = app.call('portal.essays.import', base());
    expect(again).toEqual({ essayId: first.essayId, duplicate: true });
    expect(app.db().find('Essays', (e) => e.source === 'portal:sub-0000-0001')).toHaveLength(1);
  });

  it('refuses a wrong or missing secret, and works only when a long secret is set', () => {
    const { app, base } = setup();
    expect(app.raw('portal.essays.import', base({ secret: 'nope' }))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    app.svc.props.PORTAL_SECRET = 'short';
    expect(app.raw('portal.essays.import', base({ secret: 'short' }))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('times a test-mode essay from the portal start time', () => {
    const { app, base } = setup();
    const startedAt = new Date(app.svc.now().getTime() - 45 * 60000).toISOString();
    const res = app.call(
      'portal.essays.import',
      base({
        submissionId: 'sub-test-0001',
        mode: 'test',
        startedAt,
        autoSubmitted: true,
        pasteAttempts: 2,
      }),
    );
    const essay = app.db().byId('Essays', res.essayId)!;
    expect(essay).toMatchObject({
      mode: 'test',
      time_used_seconds: '2700',
      over_time: 'true',
      auto_submitted: 'true',
      paste_attempts: '2',
    });
  });

  it("times a retried test essay from the student's submit time, not its arrival", () => {
    const { app, base } = setup();
    const now = app.svc.now().getTime();
    const res = app.call(
      'portal.essays.import',
      base({
        submissionId: 'sub-late-0001',
        mode: 'test',
        startedAt: new Date(now - 3 * 3600000).toISOString(),
        submittedAt: new Date(now - 3 * 3600000 + 30 * 60000).toISOString(),
      }),
    );
    expect(app.db().byId('Essays', res.essayId)!).toMatchObject({
      time_used_seconds: '1800',
      over_time: 'false',
    });
  });

  it('creates a Harper student for a new email, and needs the image for Task 1', () => {
    const { app, base } = setup();
    const noImage = app.raw(
      'portal.essays.import',
      base({
        submissionId: 'sub-t1-0001',
        taskType: 'task1_academic',
        topicId: undefined,
        essayType: undefined,
        diagramType: 'dynamic',
      }),
    );
    expect(noImage).toMatchObject({ ok: false, error: { fields: { image: expect.any(String) } } });
    const res = app.call(
      'portal.essays.import',
      base({
        submissionId: 'sub-t1-0002',
        studentEmail: 'newcomer@example.com',
        studentName: 'Newcomer',
        taskType: 'task1_academic',
        topicId: undefined,
        essayType: undefined,
        diagramType: 'dynamic',
        image: { base64: PNG, mimeType: 'image/png', name: 'chart.png' },
      }),
    );
    const user = app.db().findOne('Users', (u) => u.email === 'newcomer@example.com')!;
    expect(user).toMatchObject({ role: 'student', name: 'Newcomer' });
    expect(app.db().byId('Essays', res.essayId)!.image_file_id).not.toBe('');
  });
});

describe('one-time login from IELTS Harper Portal', () => {
  const signin = (over: Record<string, unknown> = {}) => ({
    secret: SECRET,
    studentEmail: 'demo.binh@example.com',
    studentName: 'Tran Thi Binh',
    next: '/essays',
    ...over,
  });
  const tokenOf = (url: string) => decodeURIComponent(/token=([^&]+)/.exec(url)![1]);

  it('gives a link that logs the student in once and opens the page asked for', () => {
    const { app } = setup();
    const { url } = app.call('portal.signin', signin());
    expect(url).toMatch(/#\/auth\?token=[^&]+&next=%2Fessays$/);
    const res = app.call('auth.exchange', { token: tokenOf(url) });
    expect(res.user).toMatchObject({ email: 'demo.binh@example.com', role: 'student' });
    expect(app.raw('auth.exchange', { token: tokenOf(url) })).toMatchObject({ ok: false });
  });

  it('expires after 2 minutes', () => {
    const { app } = setup();
    const { url } = app.call('portal.signin', signin());
    app.svc.advance(3 * 60000);
    expect(app.raw('auth.exchange', { token: tokenOf(url) })).toMatchObject({ ok: false });
  });

  it('refuses a wrong secret, an admin email and a page outside Harper', () => {
    const { app } = setup();
    expect(app.raw('portal.signin', signin({ secret: 'x'.repeat(64) }))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(app.raw('portal.signin', signin({ studentEmail: 'admin@example.com' }))).toMatchObject({
      ok: false,
    });
    expect(app.raw('portal.signin', signin({ next: 'https://evil.example/' }))).toMatchObject({
      ok: false,
      error: { fields: { next: expect.any(String) } },
    });
  });

  it('creates the Harper account of a portal student who has none', () => {
    const { app } = setup();
    const { url } = app.call(
      'portal.signin',
      signin({ studentEmail: 'new.one@example.com', studentName: 'New One' }),
    );
    expect(app.call('auth.exchange', { token: tokenOf(url) }).user.email).toBe(
      'new.one@example.com',
    );
  });
});

describe('practice time from the portal', () => {
  it('keeps the time spent writing a practice essay', () => {
    const { app, base } = setup();
    const res = app.call(
      'portal.essays.import',
      base({ submissionId: 'sub-time-0001', timeSpentSeconds: 1500 }),
    );
    expect(app.db().byId('Essays', res.essayId)!).toMatchObject({
      mode: 'practice',
      time_used_seconds: '1500',
      over_time: 'false',
    });
  });
});

describe('classes created from IELTS Harper Portal', () => {
  it('creates the class once and puts students without a class in it', () => {
    const { app, admin } = setup();
    const students = [
      { email: 'new.one@example.com', name: 'Nguyen Van Mot' },
      { email: 'admin@example.com', name: 'Teacher' },
    ];
    const first = app.call('portal.classes.ensure', { secret: SECRET, label: 'K233 TC', students });
    expect(first).toMatchObject({ created: true, added: 1, skippedAdmins: 1 });
    const again = app.call('portal.classes.ensure', {
      secret: SECRET,
      label: 'k233 tc',
      students: [...students, { email: 'NEW.two@example.com', name: 'Tran Thi Hai' }],
    });
    expect(again).toMatchObject({ classId: first.classId, created: false, added: 1 });
    const one = app.db().findOne('Users', (u) => u.email === 'new.one@example.com')!;
    const two = app.db().findOne('Users', (u) => u.email === 'new.two@example.com')!;
    expect(one).toMatchObject({ class: first.classId, role: 'student' });
    expect(two.class).toBe(first.classId);
    expect(app.db().find('Classes', (c) => c.label.toLowerCase() === 'k233 tc')).toHaveLength(1);
    const lists = app.call('admin.lists', {}, admin);
    expect(lists.classes.some((c: any) => c.label === 'K233 TC' && c.active)).toBe(true);
  });

  it('leaves a student already in another class where they are', () => {
    const { app } = setup();
    const a = app.call('portal.classes.ensure', {
      secret: SECRET,
      label: 'Class A',
      students: [{ email: 's@example.com', name: 'Student S' }],
    });
    const b = app.call('portal.classes.ensure', {
      secret: SECRET,
      label: 'Class B',
      students: [{ email: 's@example.com', name: 'Student S' }],
    });
    expect(b).toMatchObject({ added: 0, keptInOtherClass: 1 });
    expect(app.db().findOne('Users', (u) => u.email === 's@example.com')!.class).toBe(a.classId);
  });

  it('refuses a wrong secret', () => {
    const { app } = setup();
    expect(
      app.raw('portal.classes.ensure', { secret: 'nope', label: 'X', students: [] }),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('queues a Gemini draft for an essay from Classroom unless the teacher turned it off', () => {
    const { app, admin, base } = setup();
    // No key yet: nothing queued.
    expect(app.call('portal.essays.import', base()).aiQueued).toBe(false);
    app.call('admin.ai.saveSettings', { geminiKey: 'AIzaTestKey_0123456789abcdef' }, admin);
    const res = app.call('portal.essays.import', base({ submissionId: 'sub-auto-2' }));
    expect(res.aiQueued).toBe(true);
    expect(app.db().findOne('AiJobs', (j) => j.essay_id === res.essayId)?.status).toBe('queued');
    expect(app.svc.scheduled).toContain('aiJob');
    const off = app.call('admin.ai.saveSettings', { autoDraft: false }, admin);
    expect(off.autoDraft).toBe(false);
    expect(app.call('portal.essays.import', base({ submissionId: 'sub-auto-3' })).aiQueued).toBe(
      false,
    );
  });
});
