import { describe, expect, it } from 'vitest';
import { normalizePrompt, promptKey, promptLabel } from '../../shared/promptKey';
import { createTestApp } from '../helpers';

const PROMPT = 'Some people think university education should be FREE. Do you agree or disagree?';
const BODY = 'University should be free for everyone because education is a right. '.repeat(40);

describe('prompt matching', () => {
  it('ignores capitals, spaces, line breaks and punctuation', () => {
    const key = promptKey(PROMPT);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(
      promptKey(
        'some people think  university education\nshould be free — do you agree or disagree',
      ),
    ).toBe(key);
    expect(promptKey('It’s “free”.')).toBe(promptKey('It\'s "free"'));
  });

  it('treats different wording as a different prompt', () => {
    expect(promptKey(PROMPT.replace('FREE', 'cheap'))).not.toBe(promptKey(PROMPT));
    expect(promptKey('   ')).toBe('');
    expect(normalizePrompt('Ngữ pháp: TỐT!')).toBe('ngữ pháp tốt');
  });

  it('shortens long prompts for the dropdown', () => {
    expect(promptLabel('a\n  b')).toBe('a b');
    expect(promptLabel('x'.repeat(200))).toHaveLength(90);
  });
});

function prepare() {
  const app = createTestApp();
  const admin = app.login('admin@example.com');
  const config = app.call('config.get');
  const topicId = config.topics.find((t: any) => t.label === 'Education').id;
  const queue = app.call('admin.queue', {}, admin);
  const an = queue.students.find((s: any) => s.name === 'Nguyen Van An').id;
  const fields = {
    taskType: 'task2',
    topicId,
    essayType: 'agree_disagree',
    body: BODY,
  };
  // The same question: one submitted by a student, one added by the teacher (different spacing
  // and capitals), and one on a different question.
  const student = app.login('demo.binh@example.com');
  const draft = app.call('essays.saveDraft', { ...fields, prompt: PROMPT }, student);
  app.call('essays.submit', { id: draft.id, ...fields, prompt: PROMPT }, student);
  const added = app.call(
    'admin.essays.create',
    { ...fields, studentId: an, prompt: PROMPT.toLowerCase().replace(' ', '   ') },
    admin,
  ).essayId as string;
  const other = app.call(
    'admin.essays.create',
    { ...fields, studentId: an, prompt: 'Some people think homework should be banned. Agree?' },
    admin,
  ).essayId as string;
  return { app, admin, student, submitted: draft.id as string, added, other };
}

describe('the Prompt filter in the queue', () => {
  it('groups essays on the same prompt however they were submitted', () => {
    const { app, admin, submitted, added, other } = prepare();
    const all = app.call('admin.queue', {}, admin);
    const group = all.prompts.find((p: any) => p.key === promptKey(PROMPT));
    expect(group).toMatchObject({ count: 2 });
    expect(group.label.startsWith('Some people think university')).toBe(true);
    // A prompt answered only once is not offered.
    expect(
      all.prompts.some(
        (p: any) => p.key === promptKey('Some people think homework should be banned. Agree?'),
      ),
    ).toBe(false);

    const filtered = app.call('admin.queue', { promptKey: group.key }, admin);
    expect(filtered.items.map((i: any) => i.id).sort()).toEqual([submitted, added].sort());
    expect(filtered.items.some((i: any) => i.id === other)).toBe(false);
  });

  it('can show waiting and scored essays together', () => {
    const { app, admin, added } = prepare();
    const scoredBefore = app.call('admin.queue', { status: 'scored' }, admin).items.length;
    const waiting = app.call('admin.queue', {}, admin).items.length;
    const all = app.call('admin.queue', { status: 'all' }, admin).items;
    expect(all.length).toBe(scoredBefore + waiting);
    expect(all.some((i: any) => i.id === added)).toBe(true);
  });

  it('rejects a malformed prompt key', () => {
    const { app, admin } = prepare();
    expect(app.raw('admin.queue', { promptKey: 'nope' }, admin).ok).toBe(false);
  });
});

describe('Read all', () => {
  it('returns the full essays in the order asked for, for the teacher only', () => {
    const { app, admin, student, submitted, added } = prepare();
    const res = app.call('admin.readEssays', { ids: [added, submitted] }, admin);
    expect(res.items.map((i: any) => i.id)).toEqual([added, submitted]);
    expect(res.items[1]).toMatchObject({
      studentName: 'Tran Thi Binh',
      prompt: PROMPT,
      body: BODY,
      queueStatus: 'new',
      overall: null,
    });
    expect(app.raw('admin.readEssays', { ids: [submitted] }, student)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    // At most 20 at a time.
    const many = Array.from({ length: 21 }, () => submitted);
    expect(app.raw('admin.readEssays', { ids: many }, admin).ok).toBe(false);
  });

  it('tells the scoring page how many essays share the prompt', () => {
    const { app, admin, added, other } = prepare();
    expect(app.call('admin.essay', { id: added }, admin).samePrompt).toEqual({
      key: promptKey(PROMPT),
      count: 2,
    });
    expect(app.call('admin.essay', { id: other }, admin).samePrompt.count).toBe(1);
  });
});
