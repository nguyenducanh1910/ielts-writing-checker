import { describe, expect, it } from 'vitest';
import { createCtx } from '../../apps-script/src/context';
import { recordEmailOpen } from '../../apps-script/src/email';
import { createTestApp, type TestApp } from '../helpers';

const BODY =
  'Nowadays many people thinks that technology is good. In my opinion the society benefit from it. ' +
  'word '.repeat(240);

function prepare() {
  const app = createTestApp();
  const config = app.call('config.get');
  const topic = (label: string) => config.topics.find((t: any) => t.label === label).id;
  const student = app.login('demo.binh@example.com');
  const admin = app.login('admin@example.com');
  const fields = {
    taskType: 'task2',
    topicId: topic('Technology'),
    essayType: 'discussion',
    prompt: 'Discuss both views and give your opinion.',
    body: BODY,
  };
  const d = app.call('essays.saveDraft', fields, student);
  app.call('essays.submit', { id: d.id, ...fields }, student);
  const cat = (label: string) => app.db().findOne('ErrorCategories', (c) => c.label === label)!.id;
  const at = (text: string) => ({
    start: BODY.indexOf(text),
    end: BODY.indexOf(text) + text.length,
  });
  const score = (errors: unknown[], extra: Record<string, unknown> = {}) =>
    app.call(
      'admin.saveScore',
      {
        essayId: d.id,
        scores: { task: 6.5, coherence: 6, lexical: 6, grammar: 5.5 },
        feedback: { task: 'A', coherence: 'B', lexical: 'C', grammar: 'D' },
        generalComment: 'Khá tốt.',
        topicId: topic('Technology'),
        essayType: 'discussion',
        errors,
        rewrite: { required: false, dueDate: '', note: '' },
        submit: true,
        notifyAgain: false,
        requestId: `r-${Math.random().toString(16).slice(2)}`,
        ...extra,
      },
      admin,
    );
  const errors = [
    {
      categoryId: cat('Subject-verb agreement'),
      excerpt: 'people thinks',
      ...at('people thinks'),
      correction: 'people think',
      note: 'Chủ ngữ số nhiều.',
    },
    {
      categoryId: cat('Articles'),
      excerpt: 'the society',
      ...at('the society'),
      correction: 'society',
      note: '',
    },
  ];
  return { app, admin, student, essayId: d.id as string, score, errors };
}

const essayRow = (app: TestApp, id: string) => app.db().byId('Essays', id)!;

describe('error practice before the result', () => {
  it('locks the score, feedback and corrections for the student everywhere', () => {
    const { app, admin, student, essayId, score, errors } = prepare();
    score(errors);
    const view = app.call('essays.get', { id: essayId }, student);
    expect(view.studentStatus).toBe('practice');
    expect(view.score).toBeNull();
    expect(view.overall).toBeNull();
    expect(view.errors).toEqual([]);
    expect(view.practice.tasks.length).toBeGreaterThan(0);
    expect(view.practice.tasks.length).toBeLessThanOrEqual(5);

    const listed = app.call('essays.listMine', {}, student).find((e: any) => e.id === essayId);
    expect(listed).toMatchObject({ studentStatus: 'practice', overall: null });

    // The dashboard neither counts the band nor shows the corrections (they are the answers).
    const dash = app.call('dashboard.get', {}, student);
    expect(JSON.stringify(dash)).not.toContain('people think"');
    expect(dash.bandOverTime.some((p: any) => p.essayId === essayId)).toBe(false);

    // The teacher still sees everything.
    expect(app.call('admin.essay', { id: essayId }, admin).essay.score.overall).toBe(6);
    expect(app.call('essays.get', { id: essayId }, admin).score.overall).toBe(6);
  });

  it('unlocks once the practice is done, and remembers when', () => {
    const { app, student, essayId, score, errors } = prepare();
    score(errors);
    const before = app.call('dashboard.get', {}, student);
    const view = app.call('essays.completePractice', { id: essayId }, student);
    expect(view.score.overall).toBe(6);
    expect(view.errors).toHaveLength(2);
    expect(view.practice).toBeNull();
    expect(view.studentStatus).toBe('scored');
    expect(essayRow(app, essayId).practice_done_at).not.toBe('');
    expect(essayRow(app, essayId).result_viewed_at).not.toBe('');
    // The dashboard (cached) shows the new band straight away.
    const after = app.call('dashboard.get', {}, student);
    expect(after.counts.scored).toBe(before.counts.scored + 1);
    // Doing it again changes nothing.
    const doneAt = essayRow(app, essayId).practice_done_at;
    app.svc.advance(60000);
    app.call('essays.completePractice', { id: essayId }, student);
    expect(essayRow(app, essayId).practice_done_at).toBe(doneAt);
  });

  it('needs no practice when no errors were tagged, and keeps results scored before as they were', () => {
    const { app, student, essayId, score, errors } = prepare();
    score([]);
    expect(essayRow(app, essayId).practice_required).toBe('');
    expect(app.call('essays.get', { id: essayId }, student).score.overall).toBe(6);
    expect(app.svc.mail.outbox.at(-1)!.subject).toContain('Band 6.0');
    // Re-scoring with errors later does not lock a result the student has already seen.
    score(errors, { notifyAgain: true });
    expect(app.call('essays.get', { id: essayId }, student).score).not.toBeNull();
    // Demo essays scored before this feature are not locked either.
    const old = app.call('essays.listMine', {}, student).filter((e: any) => e.status === 'scored');
    expect(old.every((e: any) => e.overall !== null)).toBe(true);
  });

  it('does not let a student unlock someone else’s essay', () => {
    const { app, essayId, score, errors } = prepare();
    score(errors);
    const other = app.login('demo.an@example.com');
    expect(app.raw('essays.completePractice', { id: essayId }, other)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(app.raw('essays.markViewed', { id: essayId }, other).ok).toBe(false);
  });
});

describe('result activity for the teacher', () => {
  it('shows sent, opened, seen on the website and practice done', () => {
    const { app, admin, student, essayId, score, errors } = prepare();
    score(errors);
    const activity = () =>
      app.call('admin.queue', { status: 'scored' }, admin).items.find((i: any) => i.id === essayId)
        .activity;
    expect(activity()).toMatchObject({
      email: 'sent',
      emailOpenedAt: null,
      viewedAt: null,
      practice: 'waiting',
    });

    // The email's tracking image is loaded (first time only is kept).
    const token = app.db().findOne('EmailEvents', (e) => e.essay_id === essayId)!.open_token;
    expect(recordEmailOpen(createCtx(app.svc), 'not-a-token')).toBe(false);
    expect(recordEmailOpen(createCtx(app.svc), token)).toBe(true);
    expect(recordEmailOpen(createCtx(app.svc), token)).toBe(false);
    expect(activity()).toMatchObject({ email: 'opened' });

    // Opening the essay counts as seen; the teacher opening it does not.
    app.call('essays.markViewed', { id: essayId }, admin);
    expect(activity().viewedAt).toBeNull();
    app.call('essays.markViewed', { id: essayId }, student);
    expect(activity().viewedAt).not.toBeNull();

    app.call('essays.completePractice', { id: essayId }, student);
    expect(activity()).toMatchObject({ practice: 'done' });

    // The same activity is on the student's page.
    const binh = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    const overview = app.call('admin.studentOverview', { studentId: binh.id }, admin);
    expect(overview.essays.find((e: any) => e.id === essayId).activity).toMatchObject({
      email: 'opened',
      practice: 'done',
    });
  });

  it('says when the student has no email address', () => {
    const { app, admin, essayId, score } = prepare();
    const binh = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    app.db().update('Users', (u) => u.id === binh.id, { email: '' });
    score([]);
    const item = app
      .call('admin.queue', { status: 'scored' }, admin)
      .items.find((i: any) => i.id === essayId);
    expect(item.activity).toMatchObject({ email: 'no_email', practice: 'not_required' });
  });
});

describe('before setup() adds the new columns', () => {
  it('does not lock results, so the email and the website agree', () => {
    const { app, student, essayId, score, errors } = prepare();
    // Simulate a Sheet from before this update: the three new Essays columns (the last ones)
    // have no header yet.
    const sheet = app.svc.spreadsheet.getSheetByName('Essays')!;
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const first = header.indexOf('practice_required') + 1;
    expect(header.slice(first - 1)).toEqual([
      'practice_required',
      'practice_done_at',
      'result_viewed_at',
    ]);
    sheet.getRange(1, first, 1, 3).setValues([['', '', '']]);
    score(errors);
    expect(app.call('essays.get', { id: essayId }, student).score.overall).toBe(6);
    expect(app.svc.mail.outbox.at(-1)!.subject).toContain('Band 6.0');
  });
});
