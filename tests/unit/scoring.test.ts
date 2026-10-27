import { describe, expect, it } from 'vitest';
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
  const d = app.call(
    'essays.saveDraft',
    {
      taskType: 'task2',
      topicId: topic('Technology'),
      essayType: 'discussion',
      prompt: 'Discuss.',
      body: BODY,
    },
    student,
  );
  app.call(
    'essays.submit',
    {
      id: d.id,
      taskType: 'task2',
      topicId: topic('Technology'),
      essayType: 'discussion',
      prompt: 'Discuss.',
      body: BODY,
    },
    student,
  );
  const cats = app.db().all('ErrorCategories');
  const cat = (label: string) => cats.find((c) => c.label === label)!.id;
  const sources = app.db().all('FeedbackSources');
  const source = (name: string) => sources.find((s) => s.name === name)!.id;
  return { app, student, admin, essayId: d.id as string, topic, cat, source };
}

function scorePayload(p: ReturnType<typeof prepare>, extra: Record<string, unknown> = {}) {
  const start = BODY.indexOf('people thinks');
  return {
    essayId: p.essayId,
    scores: { task: 6.5, coherence: 6, lexical: 6, grammar: 5.5 },
    feedback: { task: 'Good **position**.', coherence: 'OK', lexical: 'OK', grammar: 'Check SVA' },
    generalComment: 'Well done.',
    topicId: p.topic('Technology'),
    errors: [
      {
        categoryId: p.cat('Subject-verb agreement'),
        excerpt: 'people thinks',
        start,
        end: start + 13,
        correction: 'people think',
        note: '',
      },
      {
        categoryId: p.cat('Articles'),
        excerpt: 'the society',
        start: BODY.indexOf('the society'),
        end: BODY.indexOf('the society') + 11,
        correction: 'society',
        note: '',
      },
    ],
    rewrite: { required: false, dueDate: '', note: '' },
    submit: true,
    notifyAgain: false,
    requestId: 'req-1',
    ...extra,
  };
}

function rows(app: TestApp, table: any, essayId: string) {
  return app.db().find(table, (r: any) => r.essay_id === essayId);
}

describe('Submit score', () => {
  it('writes Scores, ErrorLog, SourceFeedback and EmailEvents rows and locks the essay', () => {
    const p = prepare();
    const { app, admin, essayId } = p;
    // Claude draft and one external result first.
    const reply = JSON.stringify({
      scores: { task: 7, coherence: 6.5, lexical: 6, grammar: 6 },
      feedback: { task: 'a', coherence: 'b', lexical: 'c', grammar: 'd' },
      general_comment: 'g',
      suggested_topic: 'Technology',
      errors: [],
    });
    app.call('admin.saveClaudeDraft', { essayId, rawText: reply }, admin);
    app.call(
      'admin.saveSourceFeedback',
      {
        essayId,
        sourceId: p.source('AI4IELTS'),
        scores: { task: 7, coherence: 7, lexical: 7, grammar: 6.5 },
        feedbackText: '<b>Great</b>',
      },
      admin,
    );

    const res = app.call('admin.saveScore', scorePayload(p), admin);
    expect(res).toEqual({ email: 'sent', status: 'scored' });

    const score = rows(app, 'Scores', essayId)[0];
    expect(score.overall).toBe('6'); // (6.5+6+6+5.5)/4 = 6.0
    const errors = rows(app, 'ErrorLog', essayId);
    expect(errors).toHaveLength(2);
    expect(
      errors.every((e: any) => e.student_id === app.db().byId('Essays', essayId)!.student_id),
    ).toBe(true);
    const sf = rows(app, 'SourceFeedback', essayId);
    expect(sf.map((s: any) => app.db().byId('FeedbackSources', s.source_id)!.name).sort()).toEqual([
      'AI4IELTS',
      'Claude',
    ]);
    const claudeRow = sf.find((s: any) => s.source_id === p.source('Claude'))!;
    expect(claudeRow.criterion_1).toBe('7');
    expect(claudeRow.overall).toBe('6.5');
    const events = rows(app, 'EmailEvents', essayId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'result',
      status: 'sent',
      idempotency_key: `result:${essayId}:1`,
    });
    expect(app.db().byId('Essays', essayId)!.status).toBe('scored');

    // The result email has the essentials and escapes text.
    const mail = app.svc.mail.outbox.at(-1)!;
    expect(mail.to).toBe('demo.binh@example.com');
    expect(mail.subject).toContain('Band 6.0');
    expect(mail.text).toContain('Task Response: 6.5');
    expect(mail.text).toContain('Subject-verb agreement');
    expect(mail.html).toContain('#/essays/' + essayId);
  });

  it('only shows the final score to the student after Submit score', () => {
    const p = prepare();
    const { app, admin, student, essayId } = p;
    app.call('admin.saveScore', scorePayload(p, { submit: false }), admin);
    expect(app.db().byId('Essays', essayId)!.status).toBe('in_review');
    const view = app.call('essays.get', { id: essayId }, student);
    expect(view.score).toBeNull();
    expect(view.errors).toEqual([]);
    expect(app.svc.mail.outbox.filter((m) => m.subject.includes('score'))).toHaveLength(0);
    app.call('admin.saveScore', scorePayload(p), admin);
    expect(app.call('essays.get', { id: essayId }, student).score.overall).toBe(6);
  });

  it('a double click sends only one email', () => {
    const p = prepare();
    const { app, admin, essayId } = p;
    app.call('admin.saveScore', scorePayload(p), admin);
    app.call('admin.saveScore', scorePayload(p), admin);
    expect(rows(app, 'EmailEvents', essayId).filter((e: any) => e.status === 'sent')).toHaveLength(
      1,
    );
    // Re-send with "Notify student again": the same request ID (double click) sends once.
    app.call(
      'admin.saveScore',
      scorePayload(p, { notifyAgain: true, requestId: 'again-1' }),
      admin,
    );
    app.call(
      'admin.saveScore',
      scorePayload(p, { notifyAgain: true, requestId: 'again-1' }),
      admin,
    );
    const sent = rows(app, 'EmailEvents', essayId).filter((e: any) => e.status === 'sent');
    expect(sent.map((e: any) => e.type)).toEqual(['result', 'result_resent']);
  });

  it('a failed email keeps the score and can be retried', () => {
    const p = prepare();
    const { app, admin, essayId } = p;
    app.svc.mail.failNext = 1;
    const res = app.call('admin.saveScore', scorePayload(p), admin);
    expect(res.email).toBe('failed');
    expect(rows(app, 'Scores', essayId)).toHaveLength(1);
    expect(app.db().byId('Essays', essayId)!.status).toBe('scored');
    expect(app.call('admin.emails', {}, admin).failed).toHaveLength(1);

    const retry = app.call('admin.resendEmail', { essayId }, admin);
    expect(retry.outcomes).toEqual({ sent: 1 });
    const events = rows(app, 'EmailEvents', essayId);
    expect(events.map((e: any) => e.status)).toEqual(['failed', 'sent']);
    // Retrying again does nothing.
    expect(app.call('admin.resendEmail', { essayId }, admin).outcomes).toEqual({});
  });

  it('queues email when the daily quota is used up and sends it later', () => {
    const p = prepare();
    const { app, admin, essayId } = p;
    app.svc.mail.quota = 5; // below the reserve of 10 kept for login links
    const res = app.call('admin.saveScore', scorePayload(p), admin);
    expect(res.email).toBe('queued');
    expect(app.call('admin.queue', {}, admin).emailQueued).toBe(1);
    // Login links still go out while result emails wait.
    const before = app.svc.mail.outbox.length;
    app.call('auth.requestLink', { email: 'demo.an@example.com' });
    expect(app.svc.mail.outbox.length).toBe(before + 1);

    app.svc.mail.quota = 100; // quota returns
    const sent = app.call('admin.emails.sendQueued', {}, admin);
    expect(sent).toMatchObject({ sent: 1, remaining: 0 });
    expect(rows(app, 'EmailEvents', essayId).map((e: any) => e.status)).toEqual(['sent']);
  });

  it('requires valid scores and placed errors to submit', () => {
    const p = prepare();
    const { app, admin } = p;
    const bad = scorePayload(p, {
      scores: { task: 6.3, coherence: 10, lexical: 6, grammar: null },
      errors: [
        { categoryId: p.cat('Articles'), excerpt: 'x', start: null, end: null, correction: '' },
      ],
    });
    const res = app.raw('admin.saveScore', bad, admin);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.error.fields!)).toEqual(
      expect.arrayContaining([
        'scores.task',
        'scores.coherence',
        'scores.grammar',
        'errors[0].start',
      ]),
    );
    expect(rows(app, 'Scores', p.essayId)).toHaveLength(0);
  });

  it('renames the Drive folder when the admin changes the topic', () => {
    const p = prepare();
    const { app, admin, essayId } = p;
    app.call('admin.saveScore', scorePayload(p, { topicId: p.topic('Education') }), admin);
    const essay = app.db().byId('Essays', essayId)!;
    expect(app.svc.drive.folders.get(essay.drive_folder_id)!.name).toBe(
      'Tran Thi Binh - Task 2 - Education - 2026-10-10',
    );
  });

  it('creates a rewrite request; the rewrite links to the original and shows as overdue when late', () => {
    const p = prepare();
    const { app, admin, student, essayId } = p;
    app.call(
      'admin.saveScore',
      scorePayload(p, { rewrite: { required: true, dueDate: '2026-10-12', note: 'Fix SVA' } }),
      admin,
    );
    const rr = rows(app, 'RewriteRequests', essayId)[0];
    // End of 12 Oct in Asia/Ho_Chi_Minh (UTC+7) = 16:59:59.999Z.
    expect(rr.due_at).toBe('2026-10-12T16:59:59.999Z');
    let view = app.call('essays.get', { id: essayId }, student);
    expect(view.rewrite).toMatchObject({ status: 'requested', note: 'Fix SVA' });
    expect(view.studentStatus).toBe('rewrite_due');

    app.svc.advance(3 * 86400000); // past the due date
    view = app.call('essays.get', { id: essayId }, student);
    expect(view.studentStatus).toBe('overdue');

    const rewrite = app.call(
      'essays.saveDraft',
      { parentEssayId: essayId, body: BODY.replace('thinks', 'think') },
      student,
    );
    expect(rewrite.parentEssayId).toBe(essayId);
    expect(rewrite.prompt).toBe('Discuss.');
    const done = app.call(
      'essays.submit',
      { id: rewrite.id, body: BODY.replace('thinks', 'think') },
      student,
    );
    expect(done.essay.status).toBe('pending');
    const after = app.call('essays.get', { id: essayId }, student);
    expect(after.rewrite).toMatchObject({
      status: 'submitted',
      late: true,
      rewriteEssayId: rewrite.id,
    });
    // The rewrite folder name ends in " - Rewrite".
    const folder = app.svc.drive.folders.get(app.db().byId('Essays', rewrite.id)!.drive_folder_id)!;
    expect(folder.name).toMatch(/ - Rewrite$/);
    // The admin scoring page shows the original and its final score.
    const adminView = app.call('admin.essay', { id: rewrite.id }, admin);
    expect(adminView.parent.score.overall).toBe(6);
  });

  it('waives a rewrite when "Rewrite required" is unticked', () => {
    const p = prepare();
    const { app, admin, essayId } = p;
    app.call(
      'admin.saveScore',
      scorePayload(p, { rewrite: { required: true, dueDate: '2026-10-20', note: '' } }),
      admin,
    );
    app.call(
      'admin.saveScore',
      scorePayload(p, { rewrite: { required: false, dueDate: '', note: '' } }),
      admin,
    );
    expect(rows(app, 'RewriteRequests', essayId)[0].status).toBe('waived');
  });
});
