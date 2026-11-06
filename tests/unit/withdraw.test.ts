import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers';

const BODY = 'Some people think that technology is good for society. ' + 'word '.repeat(250);

function submitted() {
  const app = createTestApp();
  const config = app.call('config.get');
  const topic = config.topics.find((t: any) => t.label === 'Technology').id;
  const student = app.login('demo.binh@example.com');
  const admin = app.login('admin@example.com');
  const draft = {
    taskType: 'task2',
    topicId: topic,
    essayType: 'discussion',
    prompt: 'Discuss.',
    body: BODY,
  };
  const d = app.call('essays.saveDraft', draft, student);
  app.call('essays.submit', { id: d.id, ...draft }, student);
  return { app, admin, essayId: d.id as string };
}

const inQueue = (app: any, admin: string, id: string) =>
  app.call('admin.queue', {}, admin).items.some((x: any) => x.id === id);

describe('taking an essay out of the marking queue', () => {
  it('hides the essay from the queue and puts it back on request', () => {
    const { app, admin, essayId } = submitted();
    expect(inQueue(app, admin, essayId)).toBe(true);

    const res = app.call('admin.essays.withdraw', { essayId }, admin);
    expect(res.withdrawnAt).toBeTruthy();
    expect(inQueue(app, admin, essayId)).toBe(false);
    expect(app.call('admin.essay', { id: essayId }, admin).essay.withdrawnAt).toBeTruthy();
    expect(app.raw('admin.ai.score', { essayId }, admin)).toMatchObject({ ok: false });

    app.call('admin.essays.withdraw', { essayId, restore: true }, admin);
    expect(inQueue(app, admin, essayId)).toBe(true);
  });

  it('is for teachers only', () => {
    const { app, essayId } = submitted();
    const student = app.login('demo.binh@example.com');
    expect(app.raw('admin.essays.withdraw', { essayId }, student)).toMatchObject({ ok: false });
  });
});
