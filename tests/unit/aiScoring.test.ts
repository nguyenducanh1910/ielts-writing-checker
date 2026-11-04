import { describe, expect, it } from 'vitest';
import { runAiJobs } from '../../apps-script/src/aiScoring';
import type { HttpRequest } from '../../apps-script/src/services';
import {
  buildGeminiReconcilePrompt,
  geminiReconcileText,
  selectSamples,
} from '../../shared/aiScoring';
import { createTestApp } from '../helpers';

const BODY =
  'Nowadays many people thinks that technology is good. In my opinion the society benefit from it. ' +
  'word '.repeat(240);
const KEY = 'AIzaTestKey_0123456789abcdef';

function result(scores: Record<string, number>, comment = 'g') {
  return {
    scores,
    feedback: { task: 'a', coherence: 'b', lexical: 'c', grammar: 'd' },
    general_comment: comment,
    suggested_topic: 'Technology',
    errors: [
      {
        excerpt: 'people thinks',
        category: 'Subject-verb agreement',
        correction: 'people think',
        note: '',
      },
    ],
  };
}

function gemini(json: unknown, status = 200) {
  return {
    status,
    text: JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 },
    }),
  };
}

const turns = (r: HttpRequest) => (JSON.parse(r.body).contents as unknown[]).length;

function prepare() {
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
  const essayId = d.id as string;
  const pasteClaude = () =>
    app.call(
      'admin.saveClaudeDraft',
      {
        essayId,
        rawText: JSON.stringify(
          result({ task: 6, coherence: 6, lexical: 6, grammar: 5.5 }, 'claude'),
        ),
      },
      admin,
    );
  app.svc.http.handler = (r) =>
    turns(r) === 1
      ? gemini(result({ task: 7, coherence: 6.5, lexical: 7, grammar: 6.5 }, 'gemini'))
      : gemini({
          notes: '1. Lệch Lexical. 2. Không. 3. Lexical 6.5.',
          result: result({ task: 6.5, coherence: 6, lexical: 6.5, grammar: 6 }, 'reconciled'),
        });
  return { app, admin, essayId, topic, pasteClaude };
}

describe('automatic scoring (free: pasted Claude draft + Gemini)', () => {
  it('explains a missing UrlFetch permission instead of a generic server error', () => {
    const { app, admin } = prepare();
    app.call('admin.ai.saveSettings', { geminiKey: KEY }, admin);
    app.svc.http.handler = () => {
      throw new Error('You do not have permission to call UrlFetchApp.fetchAll.');
    };
    const r = app.call('admin.ai.test', {}, admin);
    expect(r.gemini.ok).toBe(false);
    expect(r.gemini.message).toContain('cấp quyền');
  });

  it('accepts keys with dots or pasted line breaks and names a bad key field', () => {
    const { app, admin } = prepare();
    const bad = app.raw('admin.ai.saveSettings', { geminiKey: 'short key!' }, admin);
    expect(bad).toMatchObject({ ok: false, error: { fields: { geminiKey: expect.any(String) } } });
    const s = app.call(
      'admin.ai.saveSettings',
      { geminiKey: ' AQ.Ab8RN6Kx_test-0123\n456789abcdef ' },
      admin,
    );
    expect(s).toMatchObject({ hasGeminiKey: true });
  });

  it('needs the Gemini key and a pasted Claude draft first', () => {
    const { app, admin, essayId, pasteClaude } = prepare();
    expect(app.raw('admin.ai.score', { essayId }, admin)).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: expect.stringContaining('khoá Gemini') },
    });
    const s = app.call('admin.ai.saveSettings', { geminiKey: KEY }, admin);
    expect(s).toMatchObject({ hasGeminiKey: true, geminiModel: 'gemini-flash-latest' });
    expect(JSON.stringify(s)).not.toContain(KEY);
    expect(app.raw('admin.ai.score', { essayId }, admin)).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: expect.stringContaining('Copy for Claude') },
    });
    pasteClaude();
    const res = app.call('admin.ai.score', { essayId }, admin);
    expect(res.reconciled.scores).toEqual({ task: 6.5, coherence: 6, lexical: 6.5, grammar: 6 });
    expect(res.reconciled.generalComment).toBe('reconciled');
    expect(res.gemini).toMatchObject({ overall: 7, model: 'gemini-flash-latest' });
    // Gemini saw the essay first, then its own answer and the reconcile prompt with Claude's draft.
    const [first, second] = app.svc.http.requests;
    expect(first.headers['x-goog-api-key']).toBe(KEY);
    expect(first.url).toContain('gemini-flash-latest:generateContent');
    expect(turns(second)).toBe(3);
    expect(second.body).toContain('Examiner A (Claude)');
    // Stored like the manual workflow: Gemini result + reconcile notes the page can load.
    const sf = app.db().find('SourceFeedback', (x) => x.essay_id === essayId);
    const gem = app.db().findOne('FeedbackSources', (x) => x.name === 'Gemini')!;
    expect(sf.find((x) => x.source_id === gem.id)).toMatchObject({
      criterion_1: '7',
      overall: '7',
    });
    const page = app.call('admin.essay', { id: essayId }, admin);
    expect(page.reconcile.rawText).toContain('```json');
    expect(page.essay.status).not.toBe('scored'); // nothing sent to the student
  });

  it('falls back to the flash model when the chosen one is overloaded', () => {
    const { app, admin, essayId, pasteClaude } = prepare();
    app.call('admin.ai.saveSettings', { geminiKey: KEY }, admin);
    pasteClaude();
    const ok = app.svc.http.handler;
    app.svc.http.handler = (r) =>
      r.url.includes('gemini-flash-latest') ? { status: 503, text: '{}' } : ok(r);
    const res = app.call('admin.ai.score', { essayId }, admin);
    expect(res.gemini.model).toBe('gemini-flash-lite-latest');
    expect(res.warnings.join(' ')).toContain('quá tải');
  });

  it('scores queued essays in the background and skips those without a Claude draft', () => {
    const { app, admin, essayId, pasteClaude } = prepare();
    app.call('admin.ai.saveSettings', { geminiKey: KEY }, admin);
    expect(app.call('admin.ai.queue', { essayIds: [essayId] }, admin)).toMatchObject({
      queued: 0,
      noDraft: 1,
    });
    pasteClaude();
    expect(app.call('admin.ai.queue', { essayIds: [essayId] }, admin)).toMatchObject({ queued: 1 });
    expect(app.svc.scheduled).toEqual(['aiJob']);
    expect(runAiJobs(app.svc)).toMatchObject({ done: 1, failed: 0, left: 0 });
    const item = app.call('admin.queue', {}, admin).items.find((i: any) => i.id === essayId);
    expect(item.ai.status).toBe('done');
  });

  it('a sent result becomes a calibration sample unless the teacher unticked it', () => {
    const { app, admin, essayId } = prepare();
    const score = {
      essayId,
      scores: { task: 6.5, coherence: 6, lexical: 6, grammar: 5.5 },
      feedback: { task: 'a', coherence: 'b', lexical: 'c', grammar: 'd' },
      generalComment: 'ok',
      topicId: prepare().topic,
      errors: [],
      rewrite: { required: false, dueDate: '', note: '' },
      submit: true,
      notifyAgain: false,
      requestId: 'r1',
    };
    score.topicId = app.call('admin.essay', { id: essayId }, admin).essay.topicId;
    app.call('admin.saveScore', score, admin);
    expect(app.call('admin.essay', { id: essayId }, admin).isSample).toBe(true);
    app.call('admin.setSample', { essayId, sample: false }, admin);
    app.call('admin.saveScore', { ...score, requestId: 'r2' }, admin);
    expect(app.call('admin.essay', { id: essayId }, admin).isSample).toBe(false);
  });
});

describe('sample choice and Gemini reconcile parsing', () => {
  const c = (
    id: string,
    subtype: string,
    overall: number,
    scoredAt: string,
    taskType = 'task2',
  ) => ({
    id,
    taskType,
    subtype,
    topicId: 't',
    overall,
    scoredAt,
  });
  it('prefers the same essay type, spreads bands, never the essay itself', () => {
    const picked = selectSamples(
      [
        c('a', 'opinion', 6, '2026-10-01'),
        c('b', 'opinion', 6, '2026-10-05'),
        c('c', 'opinion', 7, '2026-10-02'),
        c('d', 'discussion', 5, '2026-10-09'),
        c('e', 'opinion', 6, '2026-10-09', 'task1_academic'),
        c('self', 'opinion', 8, '2026-10-10'),
      ],
      { id: 'self', taskType: 'task2', subtype: 'opinion', topicId: 't' },
      3,
    );
    expect(picked).toEqual(['b', 'c', 'd']);
  });
  it('turns Gemini JSON into notes + a json block, and the prompt carries both biases', () => {
    const out = geminiReconcileText(JSON.stringify({ notes: 'N', result: { a: 1 } }))!;
    expect(out.text).toBe('N\n\n```json\n{\n  "a": 1\n}\n```');
    expect(geminiReconcileText('not json')).toBeNull();
    const prompt = buildGeminiReconcilePrompt({
      taskType: 'task2',
      claudeDraftJson: '{}',
      geminiDraftJson: '{}',
      claudeBias: { bias: { overall: -0.25 }, samples: 12 },
      geminiBias: { bias: { overall: 0.75 }, samples: 9 },
    });
    expect(prompt).toContain('Claude (12 essays)');
    expect(prompt).toContain('overall +0.75');
  });
});
