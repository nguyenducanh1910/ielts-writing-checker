import { describe, expect, it } from 'vitest';
import { sourceScoreRows } from '../../apps-script/src/calibration';
import { runHourlyJob } from '../../apps-script/src/triggers';
import { createCtx } from '../../apps-script/src/context';
import { matchClaudeErrors } from '../../shared/claude';
import { SEED_ERROR_CATEGORIES } from '../../shared/constants';
import { guessFromCorrection, resolveCategory } from '../../shared/errorCategory';
import { createTestApp } from '../helpers';

const cats = SEED_ERROR_CATEGORIES.map((c) => ({
  id: c.label,
  label: c.label,
  criterion: c.criterion,
}));

describe('error categories from the AI', () => {
  it('keeps exact labels and maps near labels', () => {
    expect(resolveCategory('Articles', cats)).toBe('Articles');
    expect(resolveCategory('article', cats)).toBe('Articles');
    expect(resolveCategory('Verb tense', cats)).toBe('Tense');
    expect(resolveCategory('Wrong preposition', cats)).toBe('Prepositions');
    expect(resolveCategory('Missing overview', cats)).toBe('Missing overview (Task 1)');
  });

  it('turns a criterion name into the category that fits the correction', () => {
    const g = (excerpt: string, correction: string, label = 'Grammatical Range and Accuracy') =>
      resolveCategory(label, cats, { excerpt, correction, note: '' });
    expect(g('show a increase', 'show an increase')).toBe('Articles');
    expect(g('use this extra time do exercise', 'use this extra time to do exercise')).toBe(
      'Prepositions',
    );
    expect(g('air pollution cause serious', 'air pollution causes serious')).toBe(
      'Subject-verb agreement',
    );
    expect(g('this trends', 'this trend')).toBe('Plurals and countability');
    expect(g('two main problems cause by', 'two main problems caused by')).toBe('Passive voice');
    expect(g('the main reason are', 'the main reason is')).toBe('Subject-verb agreement');
    expect(g('pressring issue', 'pressing issue', 'Lexical Resource')).toBe('Spelling');
    expect(g('most popular of transport', 'most popular mode of transport', 'Lexical')).toBe(
      'Word choice',
    );
    // Nothing clear: the criterion's usual category
    expect(g('The core of argument that', 'The core of the argument is that')).toBe(
      'Sentence fragment',
    );
    expect(resolveCategory('Task Response', cats, { excerpt: 'x', correction: 'y z w' })).toBe(
      'Underdeveloped idea',
    );
  });

  it('uses the Vietnamese explanation when the correction is not clear', () => {
    expect(
      resolveCategory('Grammar', cats, {
        excerpt: 'If I am rich, I will buy',
        correction: 'If I were rich, I would buy',
        note: 'Sai câu điều kiện loại 2',
      }),
    ).toBe('Conditionals');
  });

  it('returns null for a label it cannot place', () => {
    expect(resolveCategory('Something else entirely', cats)).toBeNull();
    expect(guessFromCorrection('abc', '')).toBe('');
  });

  it('splits a list of misspelt words into one error per word', () => {
    const body = 'The bicvcle was notible in that peiod.';
    const m = matchClaudeErrors(
      [
        {
          excerpt: 'bicvcle, notible, peiod',
          category: 'Spelling',
          correction: 'bicycle, notable, period',
          note: '',
        },
      ],
      cats,
      body,
    );
    expect(m.map((x) => [x.excerpt, x.correction, x.categoryId, x.unplaced])).toEqual([
      ['bicvcle', 'bicycle', 'Spelling', false],
      ['notible', 'notable', 'Spelling', false],
      ['peiod', 'period', 'Spelling', false],
    ]);
  });
});

function setup() {
  const app = createTestApp();
  const admin = app.login('admin@example.com');
  const pending = app.call('admin.queue', {}, admin).items[0];
  const essay = app.db().byId('Essays', pending.id)!;
  // The rule counts essays submitted after it was switched on
  createCtx(app.svc).db.insert('Settings', {
    key: 'auto_send_since',
    value: '2000-01-01T00:00:00.000Z',
  });
  return { app, admin, essay };
}

function addAiDraft(app: ReturnType<typeof createTestApp>, essayId: string, body: string) {
  const firstWords = body.split(/\s+/).slice(0, 3).join(' ');
  const ctx = createCtx(app.svc);
  ctx.db.insert('Drafts', {
    id: app.svc.uuid(),
    essay_id: essayId,
    kind: 'ai',
    raw_text: '',
    parsed_json: JSON.stringify({
      scores: { task: 6, coherence: 6.5, lexical: 6, grammar: 5.5 },
      feedback: { task: 'Tốt', coherence: 'Khá', lexical: 'Ổn', grammar: 'Cần sửa' },
      generalComment: 'Bài khá.',
      suggestedTopic: '',
      errors: [
        {
          excerpt: firstWords,
          category: 'Grammatical Range and Accuracy',
          correction: firstWords + 's',
          note: '',
        },
        {
          excerpt: 'text that is not in the essay at all',
          category: 'Articles',
          correction: 'x',
          note: '',
        },
      ],
      overall: 6,
    }),
    created_at: ctx.nowIso,
  });
}

describe('results sent automatically after 24 hours', () => {
  it('waits 24 hours, then sends the AI result without making it a sample', () => {
    const { app, admin, essay } = setup();
    addAiDraft(app, essay.id, essay.body);
    const sinceSubmit = app.svc.now().getTime() - Date.parse(essay.submitted_at);
    if (sinceSubmit < 23 * 3600000) {
      expect(runHourlyJob(app.svc).autoSent).toMatchObject({ sent: 0 });
      expect(app.db().byId('Essays', essay.id)!.status).not.toBe('scored');
    }
    app.svc.advance(25 * 3600000);
    const before = app.svc.mail.outbox.length;
    const res = runHourlyJob(app.svc);
    expect(res.autoSent).toMatchObject({ sent: 1 });
    const after = app.db().byId('Essays', essay.id)!;
    expect(after.status).toBe('scored');
    const score = app.db().findOne('Scores', (s) => s.essay_id === essay.id)!;
    expect(
      [score.criterion_1, score.criterion_2, score.criterion_3, score.criterion_4].map(Number),
    ).toEqual([6, 6.5, 6, 5.5]);
    // The error that is not in the essay is left out; the other one got a category.
    const errs = app.db().find('ErrorLog', (e) => e.essay_id === essay.id);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.category_id).not.toBe('');
    expect(app.svc.mail.outbox.length).toBeGreaterThan(before);
    // Not a calibration sample and not used to measure bias
    expect(app.db().find('CalibrationSamples', (s) => s.essay_id === essay.id)).toHaveLength(0);
    expect(sourceScoreRows(createCtx(app.svc)).some((r) => r.essayId === essay.id)).toBe(false);
    expect(
      app.db().find('AiJobs', (j) => j.essay_id === essay.id && j.step === 'auto_sent'),
    ).toHaveLength(1);
    // Sent once only
    expect(runHourlyJob(app.svc).autoSent).toMatchObject({ sent: 0 });

    // The teacher edits and sends it again: it counts as the teacher's result.
    app.call(
      'admin.saveScore',
      {
        essayId: essay.id,
        scores: { task: 6, coherence: 6, lexical: 6, grammar: 6 },
        topicId: after.topic_id,
        errors: [],
        submit: true,
      },
      admin,
    );
    expect(
      app.db().find('AiJobs', (j) => j.essay_id === essay.id && j.step === 'auto_sent'),
    ).toHaveLength(0);
    expect(app.db().find('CalibrationSamples', (s) => s.essay_id === essay.id)).toHaveLength(1);
  });

  it("uses the teacher's saved form when it has all four scores", () => {
    const { app, admin, essay } = setup();
    addAiDraft(app, essay.id, essay.body);
    app.call(
      'admin.saveScore',
      {
        essayId: essay.id,
        scores: { task: 7, coherence: 7, lexical: 6.5, grammar: 6.5 },
        topicId: essay.topic_id,
        errors: [],
        submit: false,
      },
      admin,
    );
    app.svc.advance(25 * 3600000);
    expect(runHourlyJob(app.svc).autoSent).toMatchObject({ sent: 1 });
    const score = app.db().findOne('Scores', (s) => s.essay_id === essay.id)!;
    expect(Number(score.criterion_1)).toBe(7);
    // The teacher's own work: a normal sample, no auto marker
    expect(
      app.db().find('AiJobs', (j) => j.essay_id === essay.id && j.step === 'auto_sent'),
    ).toHaveLength(0);
  });

  it('does not send a backlog submitted before the rule was switched on', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const essay = app.db().byId('Essays', app.call('admin.queue', {}, admin).items[0].id)!;
    addAiDraft(app, essay.id, essay.body);
    app.svc.advance(48 * 3600000);
    expect(runHourlyJob(app.svc).autoSent).toMatchObject({ sent: 0 });
    expect(app.db().byId('Essays', essay.id)!.status).not.toBe('scored');
  });

  it('can be turned off (0 hours)', () => {
    const { app, admin, essay } = setup();
    addAiDraft(app, essay.id, essay.body);
    app.call('admin.ai.saveSettings', { autoSendHours: 0 }, admin);
    expect(app.call('admin.ai.settings', {}, admin).autoSendHours).toBe(0);
    app.svc.advance(48 * 3600000);
    expect(runHourlyJob(app.svc).autoSent).toMatchObject({ sent: 0 });
    expect(app.db().byId('Essays', essay.id)!.status).not.toBe('scored');
  });
});
