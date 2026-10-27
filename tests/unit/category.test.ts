import { describe, expect, it } from 'vitest';
import { buildClaudePrompt } from '../../shared/claude';
import { essayCategoryLabel } from '../../shared/constants';
import { createTestApp } from '../helpers';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const BODY = 'An essay with enough words to submit. '.repeat(40);

function setup() {
  const app = createTestApp();
  const config = app.call('config.get');
  const topic = (label: string) => config.topics.find((t: any) => t.label === label).id;
  const student = app.login('demo.binh@example.com');
  return { app, topic, student };
}

describe('Task 1 diagram type and Task 2 topic + essay type', () => {
  it('requires a diagram type for Task 1 and stores no topic', () => {
    const { app, student } = setup();
    const missing = app.raw(
      'essays.saveDraft',
      { taskType: 'task1_academic', prompt: 'p', body: 'b' },
      student,
    );
    expect(missing).toMatchObject({ ok: false, error: { fields: { diagramType: 'Required' } } });
    const bad = app.raw(
      'essays.saveDraft',
      { taskType: 'task1_academic', diagramType: 'pie', body: 'b' },
      student,
    );
    expect(bad.ok).toBe(false);

    const d = app.call(
      'essays.saveDraft',
      {
        taskType: 'task1_academic',
        diagramType: 'process',
        prompt: 'The diagram shows how tea is made.',
        body: BODY,
        image: { base64: PNG, mimeType: 'image/png' },
      },
      student,
    );
    expect(d).toMatchObject({ diagramType: 'process', topicId: '', topic: 'Process' });
    app.call(
      'essays.submit',
      {
        id: d.id,
        taskType: 'task1_academic',
        diagramType: 'process',
        prompt: 'The diagram shows how tea is made.',
        body: BODY,
      },
      student,
    );
    const essay = app.db().byId('Essays', d.id)!;
    expect(app.svc.drive.folders.get(essay.drive_folder_id)!.name).toBe(
      'Tran Thi Binh - Task 1 Academic - Process - 2026-10-10',
    );
  });

  it('requires a topic and an essay type for Task 2', () => {
    const { app, topic, student } = setup();
    const res = app.raw(
      'essays.saveDraft',
      { taskType: 'task2', topicId: topic('Crime'), body: 'b' },
      student,
    );
    expect(res).toMatchObject({ ok: false, error: { fields: { essayType: 'Required' } } });
    const d = app.call(
      'essays.saveDraft',
      {
        taskType: 'task2',
        topicId: topic('Crime'),
        essayType: 'res',
        prompt: 'Why is crime rising?',
        body: BODY,
      },
      student,
    );
    expect(d).toMatchObject({
      topic: 'Crime · R.E.S',
      topicName: 'Crime',
      essayType: 'res',
      diagramType: '',
    });
    const listed = app.call('essays.listMine', {}, student).find((e: any) => e.id === d.id);
    expect(listed.topic).toBe('Crime · R.E.S');
  });

  it('applies the same rules to timed tests, teacher uploads and assignments', () => {
    const { app, topic, student } = setup();
    expect(
      app.raw(
        'essays.startTest',
        { taskType: 'task2', topicId: topic('Work'), prompt: 'Some people say work…' },
        student,
      ).ok,
    ).toBe(false);
    const t = app.call(
      'essays.startTest',
      {
        taskType: 'task2',
        topicId: topic('Work'),
        essayType: 'two_part',
        prompt: 'Some people say work…',
      },
      student,
    );
    expect(t.essayType).toBe('two_part');

    const admin = app.login('admin@example.com');
    const binh = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    const up = app.call(
      'admin.essays.create',
      {
        studentId: binh.id,
        taskType: 'task1_academic',
        diagramType: 'map',
        prompt: 'The maps show a town.',
        body: BODY,
        image: { base64: PNG, mimeType: 'image/png' },
      },
      admin,
    );
    expect(app.db().byId('Essays', up.essayId)).toMatchObject({
      diagram_type: 'map',
      topic_id: '',
    });

    const now = app.svc.now();
    const ielts7 = app.call('config.get').classes.find((c: any) => c.label === 'IELTS 7').id;
    const a = app.call(
      'admin.assignments.create',
      {
        title: 'Mixed charts',
        taskType: 'task1_academic',
        diagramType: 'mixed',
        prompt: 'The chart and table show…',
        image: { base64: PNG, mimeType: 'image/png' },
        classIds: [ielts7],
        opensAt: now.toISOString(),
        closesAt: new Date(now.getTime() + 86400000).toISOString(),
      },
      admin,
    );
    const started = app.call('assignments.start', { id: a.id }, student);
    expect(started).toMatchObject({ diagramType: 'mixed', topic: 'Mixed' });
  });

  it('a rewrite keeps the original’s topic and essay type', () => {
    const { app, student } = setup();
    // Demo essay for An: Education · Discussion, with a rewrite request.
    const an = app.login('demo.an@example.com');
    const rr = app.db().all('RewriteRequests')[0];
    const draft = app.call('essays.saveDraft', { parentEssayId: rr.essay_id, body: BODY }, an);
    expect(draft).toMatchObject({ essayType: 'discussion', topic: 'Education · Discussion' });
    expect(student).toBeTruthy();
  });

  it('lets the admin correct the type when scoring, and renames the folder', () => {
    const { app } = setup();
    const admin = app.login('admin@example.com');
    const pending = app.call('admin.queue', {}, admin).items[0]; // demo Task 1 essay (Dynamic)
    expect(pending.topic).toBe('Dynamic');
    app.call(
      'admin.saveScore',
      {
        essayId: pending.id,
        diagramType: 'static',
        scores: { task: 6, coherence: 6, lexical: 6, grammar: 6 },
        errors: [],
        submit: true,
      },
      admin,
    );
    const essay = app.db().byId('Essays', pending.id)!;
    expect(essay.diagram_type).toBe('static');
    expect(app.svc.drive.folders.get(essay.drive_folder_id)!.name).toMatch(
      / - Task 1 Academic - Static - /,
    );
  });

  it('still scores older essays saved with only a topic', () => {
    const { app } = setup();
    const admin = app.login('admin@example.com');
    const pending = app.call('admin.queue', {}, admin).items[0];
    app.db().update('Essays', (e) => e.id === pending.id, {
      diagram_type: '',
      topic_id: app.db().all('Topics')[1].id,
    });
    const res = app.call(
      'admin.saveScore',
      {
        essayId: pending.id,
        scores: { task: 6, coherence: 6, lexical: 6, grammar: 6 },
        errors: [],
        submit: true,
      },
      admin,
    );
    expect(res.status).toBe('scored');
  });

  it('lists diagram and essay types not yet attempted', () => {
    const { app, student } = setup();
    const history = app.call('topics.history', {}, student);
    // Binh's demo essays: Task 2 Health (R.E.S) and Task 1 Transport (Dynamic).
    expect(history.essayTypesNotAttempted).toEqual([
      'Agree or disagree',
      'Discussion',
      'Pros & Cons',
      '2-part question',
    ]);
    expect(history.diagramTypesNotAttempted).toEqual(['Static', 'Process', 'Map', 'Mixed']);
  });
});

describe('labels and the Claude prompt', () => {
  it('builds display labels', () => {
    expect(essayCategoryLabel({ taskType: 'task1_academic', topic: '', diagramType: 'map' })).toBe(
      'Map',
    );
    expect(essayCategoryLabel({ taskType: 'task1_academic', topic: 'Environment' })).toBe(
      'Environment',
    );
    expect(essayCategoryLabel({ taskType: 'task2', topic: 'Health', essayType: 'pros_cons' })).toBe(
      'Health · Pros & Cons',
    );
    expect(essayCategoryLabel({ taskType: 'task2', topic: 'Health' })).toBe('Health');
  });

  it('tells Claude the diagram type or the topic and essay type', () => {
    const base = { prompt: 'p', wordCount: 1, body: 'b', recurringErrors: [] };
    const t1 = buildClaudePrompt({
      ...base,
      taskType: 'task1_academic',
      topic: '',
      diagramType: 'Process',
    });
    expect(t1).toContain('Diagram type: Process');
    expect(t1).not.toContain('Topic:');
    const t2 = buildClaudePrompt({
      ...base,
      taskType: 'task2',
      topic: 'Education',
      essayType: 'Discussion',
    });
    expect(t2).toContain('Topic: Education\nEssay type: Discussion');
  });
});
