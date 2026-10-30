import { describe, expect, it } from 'vitest';
import {
  BATCH_MAX,
  batchRef,
  buildBatchClaudePrompt,
  ESSAY_END,
  ESSAY_START,
  parseBatchReply,
} from '../../shared/claude';
import { createTestApp } from '../helpers';

const reply = (excerpt: string, task = 6.5) => ({
  scores: { task, coherence: 6, lexical: 6, grammar: 5.5 },
  feedback: { task: 'Tốt.', coherence: 'Mạch lạc.', lexical: 'Ổn.', grammar: 'Chú ý thì.' },
  general_comment: 'Bài làm khá.',
  suggested_topic: 'Education',
  errors: [{ excerpt, category: 'Articles', correction: 'the city', note: '' }],
});

describe('batch prompt for Claude', () => {
  const essay = (essayId: string, body: string) => ({
    essayId,
    taskType: 'task2' as const,
    prompt: 'Discuss both views.',
    topic: 'Education',
    essayType: 'Discussion',
    wordCount: 250,
    body,
    recurringErrors: [],
  });

  it('labels every essay with its code and keeps each essay between markers', () => {
    const text = buildBatchClaudePrompt([
      essay('aaaa1111-0000-4000-8000-000000000000', 'First essay.'),
      essay('bbbb2222-0000-4000-8000-000000000000', `Second ${ESSAY_END} essay.`),
    ]);
    expect(text).toContain('score these 2 IELTS Writing essays');
    expect(text).toContain('=== Essay aaaa1111 (1 of 2) ===');
    expect(text).toContain('=== Essay bbbb2222 (2 of 2) ===');
    expect(text.split(ESSAY_START)).toHaveLength(3);
    // A student cannot close the data block early.
    expect(text.split(ESSAY_END)).toHaveLength(3);
    expect(text).toContain('"essays"');
    expect(text).toContain('Vietnamese');
  });

  it('makes the essay code from the start of the ID', () => {
    expect(batchRef('AB12cd34-5678-4000-8000-000000000000')).toBe('ab12cd34');
  });
});

describe('batch reply parsing', () => {
  it('splits the answer into one single-essay reply per essay', () => {
    const answer = JSON.stringify({
      essays: [
        { essay: 'AAAA1111', ...reply('a city') },
        { essay: 'bbbb2222', ...reply('an city', 7) },
      ],
    });
    const parsed = parseBatchReply('```json\n' + answer + '\n```');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items.map((i) => i.ref)).toEqual(['aaaa1111', 'bbbb2222']);
    expect(parsed.items.every((i) => i.result.ok)).toBe(true);
    // The stored reply is the essay's own result, without the batch code.
    expect(JSON.parse(parsed.items[1].rawText)).toEqual(reply('an city', 7));
  });

  it('accepts a bare list and a sentence around the JSON', () => {
    const parsed = parseBatchReply(
      `Here you go:\n${JSON.stringify([{ essay: 'aaaa1111', ...reply('x') }])}\nDone.`,
    );
    expect(parsed.ok && parsed.items).toHaveLength(1);
  });

  it('keeps good results when one item is wrong, and flags missing or repeated codes', () => {
    const parsed = parseBatchReply(
      JSON.stringify({
        essays: [
          { essay: 'aaaa1111', ...reply('x') },
          { essay: 'bbbb2222', ...reply('y'), scores: { task: 11 } },
          { essay: 'aaaa1111', ...reply('z') },
          reply('w'),
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items.map((i) => i.result.ok)).toEqual([true, false, false, false]);
    const errorsOf = (i: number) => {
      const r = parsed.items[i].result;
      return r.ok ? [] : r.errors;
    };
    expect(errorsOf(1).join(' ')).toMatch(/scores\.task/);
    expect(errorsOf(2)).toEqual(['Essay aaaa1111 appears twice.']);
    expect(errorsOf(3)).toEqual(['"essay" (the essay code) is missing.']);
  });

  it('refuses answers that are not JSON, have no list, or have too many essays', () => {
    expect(parseBatchReply('Sorry, I cannot.').ok).toBe(false);
    expect(parseBatchReply('{"scores": {}}').ok).toBe(false);
    const many = Array.from({ length: BATCH_MAX + 1 }, (_, i) => ({
      essay: `e${i}`,
      ...reply('x'),
    }));
    expect(parseBatchReply(JSON.stringify({ essays: many }))).toEqual({
      ok: false,
      errors: [`The reply has more than ${BATCH_MAX} essays.`],
    });
  });
});

describe('batch actions on the back end', () => {
  const BODY = 'People who live in a city have many chances. '.repeat(30);

  function prepare() {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const config = app.call('config.get');
    const topic = (label: string) => config.topics.find((t: any) => t.label === label).id;
    const binh = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    const add = (taskType: 'task2' | 'task1_academic') =>
      app.call(
        'admin.essays.create',
        taskType === 'task2'
          ? {
              studentId: binh.id,
              taskType,
              topicId: topic('Education'),
              essayType: 'discussion',
              prompt: 'Discuss both views and give your opinion.',
              body: BODY,
            }
          : {
              studentId: binh.id,
              taskType,
              diagramType: 'dynamic',
              prompt: 'Summarise the information in the chart.',
              body: BODY,
              image: { mimeType: 'image/png', base64: PNG },
            },
        admin,
      ).essayId as string;
    return { app, admin, add };
  }

  it('returns what the batch prompt needs for Task 2 essays only', () => {
    const { app, admin, add } = prepare();
    const ids = [add('task2'), add('task2')];
    const res = app.call('admin.batchPrompt', { essayIds: ids }, admin);
    expect(res.essays.map((e: any) => e.essayId)).toEqual(ids);
    expect(res.essays[0]).toMatchObject({
      studentName: 'Tran Thi Binh',
      taskType: 'task2',
      topic: 'Education',
      essayType: 'Discussion',
      body: BODY,
    });
    expect(Array.isArray(res.essays[0].recurringErrors)).toBe(true);
    // The prompt builds from exactly this data.
    expect(buildBatchClaudePrompt(res.essays)).toContain(`=== Essay ${batchRef(ids[1])} (2 of 2)`);

    const task1 = add('task1_academic');
    expect(app.raw('admin.batchPrompt', { essayIds: [task1] }, admin)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    const six = Array.from({ length: BATCH_MAX + 1 }, () => ids[0]);
    expect(app.raw('admin.batchPrompt', { essayIds: six }, admin).ok).toBe(false);
  });

  it('saves one Claude draft per essay, ready on its scoring page', () => {
    const { app, admin, add } = prepare();
    const [a, b] = [add('task2'), add('task2')];
    const res = app.call(
      'admin.saveClaudeDrafts',
      {
        drafts: [
          { essayId: a, rawText: JSON.stringify(reply('a city')) },
          { essayId: b, rawText: JSON.stringify(reply('not in this essay')) },
        ],
      },
      admin,
    );
    expect(res.saved.map((s: any) => [s.essayId, s.errors, s.unplaced])).toEqual([
      [a, 1, 0],
      [b, 1, 1],
    ]);
    const view = app.call('admin.essay', { id: a }, admin);
    expect(view.claudeDraft.parsed.scores.task).toBe(6.5);
    expect(view.essay.queueStatus).toBe('claude_pasted');
  });

  it('saves nothing when any reply is invalid or an essay is repeated', () => {
    const { app, admin, add } = prepare();
    const [a, b] = [add('task2'), add('task2')];
    const before = app.db().all('Drafts').length;
    const bad = app.raw(
      'admin.saveClaudeDrafts',
      {
        drafts: [
          { essayId: a, rawText: JSON.stringify(reply('a city')) },
          { essayId: b, rawText: '{"scores": {}}' },
        ],
      },
      admin,
    );
    expect(bad).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    const twice = app.raw(
      'admin.saveClaudeDrafts',
      {
        drafts: [
          { essayId: a, rawText: JSON.stringify(reply('a city')) },
          { essayId: a, rawText: JSON.stringify(reply('a city')) },
        ],
      },
      admin,
    );
    expect(twice.ok).toBe(false);
    expect(app.db().all('Drafts')).toHaveLength(before);
  });

  it('is for admins only', () => {
    const { app, add } = prepare();
    const id = add('task2');
    const student = app.login('demo.binh@example.com');
    expect(app.raw('admin.batchPrompt', { essayIds: [id] }, student)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(
      app.raw(
        'admin.saveClaudeDrafts',
        { drafts: [{ essayId: id, rawText: JSON.stringify(reply('x')) }] },
        student,
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

// 1×1 PNG for the Task 1 essay.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
