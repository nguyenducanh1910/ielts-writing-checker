import { describe, expect, it } from 'vitest';
import {
  bandOverTime,
  criterionAverages,
  type DashEssay,
  essaysPerWeek,
  progressHighlights,
  rewriteImprovements,
  topErrorsByCriterion,
  topicsCovered,
} from '../../shared/dashboard';
import { createTestApp } from '../helpers';

let seq = 0;
function essay(
  day: number,
  errors: Array<[string, 'grammar' | 'lexical' | 'coherence' | 'task']>,
  extra: Partial<DashEssay> = {},
): DashEssay {
  seq++;
  const date = new Date(Date.UTC(2026, 8, day)).toISOString();
  return {
    id: `e${seq}`,
    taskType: 'task2',
    mode: 'practice',
    topicId: 't1',
    topic: 'Education',
    submittedAt: date,
    scoredAt: date,
    wordCount: 100,
    overall: 6,
    criteria: { task: 6, coherence: 6, lexical: 6, grammar: 6 },
    errors: errors.map(([category, criterion]) => ({
      categoryId: category,
      category,
      criterion,
      excerpt: `x ${category}`,
      correction: `y ${category}`,
    })),
    isRewrite: false,
    ...extra,
  };
}

describe('progress highlights', () => {
  it('flags improving, mistake avoided and needs attention using errors per 100 words', () => {
    const before = [
      essay(1, [
        ['Articles', 'grammar'],
        ['Articles', 'grammar'],
        ['Spelling', 'lexical'],
        ['Spelling', 'lexical'],
      ]),
      essay(2, [
        ['Articles', 'grammar'],
        ['Tense', 'grammar'],
      ]),
      essay(3, [['Articles', 'grammar']]),
    ];
    const after = [
      essay(4, [
        ['Articles', 'grammar'],
        ['Tense', 'grammar'],
        ['Tense', 'grammar'],
      ]),
      essay(5, [['Tense', 'grammar']]),
      essay(6, []),
    ];
    const hl = progressHighlights([...after, ...before]);
    const byCat = Object.fromEntries(hl.map((x) => [x.category, x]));
    expect(byCat.Spelling.kind).toBe('avoided'); // 2 before, 0 after
    expect(byCat.Articles.kind).toBe('improving'); // 4/300 → 1/300
    expect(byCat.Articles.previousRate).toBe(1.33);
    expect(byCat.Articles.recentRate).toBe(0.33);
    expect(byCat.Tense.kind).toBe('attention'); // 1 → 3
    expect(hl[0].kind).toBe('avoided'); // shown first
  });

  it('does not penalise longer essays', () => {
    const before = [1, 2, 3].map((d) => essay(d, [['Articles', 'grammar']], { wordCount: 100 }));
    const after = [4, 5, 6].map((d) =>
      essay(
        d,
        [
          ['Articles', 'grammar'],
          ['Articles', 'grammar'],
        ],
        { wordCount: 300 },
      ),
    );
    // 3 errors / 300 words = 1.0 before; 6 / 900 = 0.67 after → improving.
    expect(progressHighlights([...before, ...after])[0]).toMatchObject({
      category: 'Articles',
      kind: 'improving',
    });
  });

  it('needs at least 4 scored essays', () => {
    expect(progressHighlights([essay(1, []), essay(2, []), essay(3, [])])).toEqual([]);
  });
});

describe('dashboard numbers', () => {
  it('computes band over time, averages, top errors and weekly counts', () => {
    const list = [
      essay(
        1,
        [
          ['Articles', 'grammar'],
          ['Articles', 'grammar'],
          ['Tense', 'grammar'],
          ['Prepositions', 'grammar'],
        ],
        { overall: 5.5, mode: 'test' },
      ),
      essay(
        20,
        [
          ['Articles', 'grammar'],
          ['Spelling', 'lexical'],
        ],
        { overall: 6.5, criteria: { task: 7, coherence: 6, lexical: 6.5, grammar: 6 } },
      ),
      essay(25, [], { overall: null, criteria: null }),
    ];
    const pts = bandOverTime(list);
    expect(pts.map((p) => p.overall)).toEqual([5.5, 6.5]);
    expect(pts[0].mode).toBe('test');
    expect(criterionAverages(list)).toEqual({ task: 6.5, coherence: 6, lexical: 6.25, grammar: 6 });
    const now = new Date(Date.UTC(2026, 8, 28));
    const top30 = topErrorsByCriterion(list, now, 30);
    expect(top30.grammar.map((t) => [t.category, t.count])).toEqual([
      ['Articles', 3],
      ['Prepositions', 1],
    ]);
    expect(top30.grammar[0].example).toEqual({ excerpt: 'x Articles', correction: 'y Articles' });
    const top10 = topErrorsByCriterion(list, now, 10);
    expect(top10.grammar.map((t) => t.category)).toEqual(['Articles']);
    const weeks = essaysPerWeek(list, now, 6);
    expect(weeks).toHaveLength(6);
    expect(weeks.reduce((s, w) => s + w.count, 0)).toBe(3);
  });

  it('lists topics covered and seeded topics not attempted', () => {
    const res = topicsCovered(
      [essay(1, [])],
      [
        { id: 't1', label: 'Education', seeded: true },
        { id: 't2', label: 'Crime', seeded: true },
        { id: 't3', label: 'Other', seeded: false },
      ],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.notAttempted).toEqual(['Crime']);
  });
});

describe('rewrite improvements', () => {
  it('pairs a scored rewrite with its original and computes the change', () => {
    const orig = essay(1, [], {
      overall: 5.5,
      criteria: { task: 6, coherence: 5.5, lexical: 5.5, grammar: 5 },
    });
    const rw = essay(5, [], {
      overall: 6.5,
      criteria: { task: 6.5, coherence: 6.5, lexical: 6, grammar: 6.5 },
      isRewrite: true,
      parentId: orig.id,
    });
    const [x] = rewriteImprovements([orig, rw]);
    expect(x.change).toEqual({ task: 0.5, coherence: 1, lexical: 0.5, grammar: 1.5, overall: 1 });
    expect(rewriteImprovements([rw])).toEqual([]); // original not available
  });
});

describe('dashboard and calibration update after a score is submitted', () => {
  it('changes dashboard and source calibration numbers (cache cleared)', () => {
    const app = createTestApp();
    const student = app.login('demo.an@example.com');
    const admin = app.login('admin@example.com');
    const before = app.call('dashboard.get', {}, student);
    const calBefore = app.call('admin.calibration', {}, admin);
    const ai = (cal: any) => cal.sources.find((s: any) => s.name === 'AI4IELTS');

    // Score the pending demo Task 1 essay.
    const pending = app.call('admin.queue', {}, admin).items[0];
    const sourceId = app.db().findOne('FeedbackSources', (s) => s.name === 'AI4IELTS')!.id;
    app.call(
      'admin.saveSourceFeedback',
      { essayId: pending.id, sourceId, scores: { task: 9, coherence: 9, lexical: 9, grammar: 9 } },
      admin,
    );
    const topicId = app.db().byId('Essays', pending.id)!.topic_id;
    app.call(
      'admin.saveScore',
      {
        essayId: pending.id,
        scores: { task: 5, coherence: 5, lexical: 5, grammar: 5 },
        feedback: {},
        generalComment: '',
        topicId,
        errors: [],
        submit: true,
      },
      admin,
    );

    const after = app.call('dashboard.get', {}, student);
    expect(after.counts.scored).toBe(before.counts.scored + 1);
    expect(after.bandOverTime.length).toBe(before.bandOverTime.length + 1);
    const calAfter = app.call('admin.calibration', {}, admin);
    expect(ai(calAfter).samples).toBe(ai(calBefore).samples + 1);
    expect(ai(calAfter).bias.overall).toBeGreaterThan(ai(calBefore).bias.overall);
  });

  it('filters the dashboard by task type and mode', () => {
    const app = createTestApp();
    const student = app.login('demo.an@example.com');
    const all = app.call('dashboard.get', {}, student);
    const tests = app.call('dashboard.get', { mode: 'test' }, student);
    expect(tests.bandOverTime.every((p: any) => p.mode === 'test')).toBe(true);
    expect(tests.bandOverTime.length).toBeLessThan(all.bandOverTime.length);
    const t1 = app.call('dashboard.get', { taskType: 'task1_academic' }, student);
    expect(t1.counts.scored).toBe(0);
  });

  it('shows the rewrite request on the student dashboard', () => {
    const app = createTestApp();
    const student = app.login('demo.an@example.com');
    const dash = app.call('dashboard.get', {}, student);
    expect(dash.rewrites).toHaveLength(1);
    expect(dash.rewrites[0]).toMatchObject({
      status: 'requested',
      topic: 'Education · Discussion',
    });
  });
});

describe('switched-off feedback sources', () => {
  it('hides inactive tools from scoring and calibration unless they have results', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const id = (name: string) => app.db().findOne('FeedbackSources', (s) => s.name === name)!.id;
    for (const name of ['AI4IELTS', 'Wispace']) {
      app.call('admin.sources.save', { id: id(name), name, active: false }, admin);
    }
    // Remove the demo results for Wispace so it has no history.
    app.db().remove('SourceFeedback', (r) => r.source_id === id('Wispace'));
    const cal = app.call('admin.calibration', {}, admin).sources.map((s: any) => s.name);
    expect(cal).toContain('Claude');
    expect(cal).toContain('Perplexity');
    expect(cal).toContain('AI4IELTS'); // inactive but has demo results
    expect(cal).not.toContain('Wispace');
    const pending = app.call('admin.queue', {}, admin).items[0];
    const view = app.call('admin.essay', { id: pending.id }, admin);
    expect(view.sources.filter((s: any) => s.active).map((s: any) => s.name)).toEqual([
      'Claude',
      'Perplexity',
    ]);
  });
});
