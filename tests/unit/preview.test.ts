import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers';

function setup() {
  const app = createTestApp();
  const admin = app.login('admin@example.com');
  const pending = app.call('admin.queue', {}, admin).items[0]; // demo Task 1 essay by An
  const essay = app.db().byId('Essays', pending.id)!;
  const cat = (label: string) => app.db().findOne('ErrorCategories', (c) => c.label === label)!.id;
  const start = essay.body.indexOf('Vietnam only recycle 10%');
  const form = {
    essayId: essay.id,
    scores: { task: 6, coherence: 6.5, lexical: 6, grammar: 5.5 },
    feedback: {
      task: 'Tổng quan rõ ràng.',
      coherence: 'Mạch lạc.',
      lexical: 'Ổn.',
      grammar: 'Chú ý thì.',
    },
    generalComment: 'Bài viết **khá tốt**, hãy chú ý thì của động từ!',
    diagramType: 'static',
    errors: [
      {
        categoryId: cat('Tense'),
        excerpt: 'x',
        start,
        end: start + 24,
        correction: 'Vietnam only recycled 10%',
        note: 'Quá khứ.',
      },
    ],
    rewrite: { required: true, dueDate: '2026-10-20', note: 'Viết lại đoạn 2.' },
    requestId: 'preview-1',
  };
  return { app, admin, essay, form };
}

describe('preview before sending', () => {
  it('shows the email built from the unsaved form and writes nothing', () => {
    const { app, admin, essay, form } = setup();
    const outbox = app.svc.mail.outbox.length;
    const p = app.call('admin.previewResult', form, admin);
    expect(p).toMatchObject({
      to: 'demo.an@example.com',
      studentName: 'Nguyen Van An',
      overall: 6,
      delivery: 'send',
    });
    expect(p.subject).toBe('Your score: Task 1 Academic – Band 6.0');
    expect(p.text).toContain('Bài viết khá tốt, hãy chú ý thì của động từ!');
    expect(p.text).toContain('1. Tense: "Vietnam only recycle 10%" -> Vietnam only recycled 10%');
    expect(p.text).toContain('Rewrite required by 2026-10-20 23:59');
    expect(p.text).toContain('Static');
    expect(p.html).toContain('Band 6.0');
    // Nothing saved or sent.
    expect(app.db().find('Scores', (s) => s.essay_id === essay.id)).toHaveLength(0);
    expect(app.db().byId('Essays', essay.id)!).toMatchObject({
      status: 'pending',
      diagram_type: 'dynamic',
    });
    expect(app.db().find('RewriteRequests', (r) => r.essay_id === essay.id)).toHaveLength(0);
    expect(app.svc.mail.outbox.length).toBe(outbox);
    expect(app.db().find('EmailEvents', (e) => e.essay_id === essay.id)).toHaveLength(0);
  });

  it('reports when no email will go out', () => {
    const { app, admin, essay, form } = setup();
    app.call('admin.saveScore', { ...form, submit: true }, admin);
    expect(app.call('admin.previewResult', form, admin).delivery).toBe('none');
    const again = app.call('admin.previewResult', { ...form, notifyAgain: true }, admin);
    expect(again.delivery).toBe('send');
    expect(again.subject).toContain('Updated score');
    app.db().update('Users', (u) => u.id === essay.student_id, { email: '' });
    expect(app.call('admin.previewResult', { ...form, notifyAgain: true }, admin).delivery).toBe(
      'no_email',
    );
  });

  it('validates like Submit score and is admin-only', () => {
    const { app, admin, form } = setup();
    const bad = app.raw('admin.previewResult', { ...form, scores: { task: 6 } }, admin);
    expect(bad).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    const student = app.login('demo.an@example.com');
    expect(app.raw('admin.previewResult', form, student)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});
