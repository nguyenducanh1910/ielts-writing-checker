import { describe, expect, it } from 'vitest';
import {
  answerMatches,
  buildPracticeTasks,
  normalizeAnswer,
  type PracticeError,
  type PracticeTask,
  sentenceAround,
} from '../../shared/practice';

const BODY =
  'Nowadays technology is everywhere. Many people thinks that phones are useful. ' +
  'However, the society should be careful because of the children spend too much time online. ' +
  'In conclusion, I am agree that we need rules.';

function err(id: string, excerpt: string, correction: string, category = 'Grammar'): PracticeError {
  const start = BODY.indexOf(excerpt);
  return {
    id,
    category,
    criterion: 'grammar',
    excerpt,
    correction,
    note: `Ghi chú ${id}`,
    start: start === -1 ? null : start,
    end: start === -1 ? null : start + excerpt.length,
  };
}

const ERRORS = [
  err('e1', 'people thinks', 'people think', 'Subject-verb agreement'),
  err('e2', 'the society', 'society', 'Articles'),
  err('e3', 'because of the children spend', 'because children spend', 'Word choice'),
  err('e4', 'I am agree', 'I agree', 'Verb form'),
];
const LABELS = ['Articles', 'Tense', 'Spelling', 'Prepositions', 'Word order', 'Verb form'];

/** Solve a task with its own answer, as a student would after the reveal. */
function solves(task: PracticeTask): boolean {
  switch (task.kind) {
    case 'gap':
      return answerMatches(task.answer, task.answer);
    case 'order':
      return [...task.words].sort().join(' ') === task.answer.split(' ').sort().join(' ');
    case 'choose':
    case 'category':
      return task.answer >= 0 && task.answer < task.options.length;
    case 'match':
      return task.answer.every((a) => a >= 0) && task.answer.length === task.items.length;
  }
}

describe('practice tasks built from tagged errors', () => {
  it('gives at most 5 tasks, mixes the kinds, and adds a matching task for 4+ errors', () => {
    const tasks = buildPracticeTasks(BODY, ERRORS, LABELS, 'essay-1');
    expect(tasks.length).toBeLessThanOrEqual(5);
    expect(tasks).toHaveLength(5); // one task per error, plus one matching task
    expect(tasks.at(-1)!.kind).toBe('match');
    expect(new Set(tasks.map((t) => t.kind)).size).toBeGreaterThanOrEqual(3);
    expect(tasks.every(solves)).toBe(true);
  });

  it('gives the same tasks for the same essay and different ones for another', () => {
    const a = buildPracticeTasks(BODY, ERRORS, LABELS, 'essay-1');
    expect(buildPracticeTasks(BODY, ERRORS, LABELS, 'essay-1')).toEqual(a);
    const seeds = ['essay-2', 'essay-3', 'essay-4', 'essay-5'];
    expect(
      seeds.some(
        (s) => JSON.stringify(buildPracticeTasks(BODY, ERRORS, LABELS, s)) !== JSON.stringify(a),
      ),
    ).toBe(true);
  });

  it('needs no practice when no errors were tagged, and caps long lists', () => {
    expect(buildPracticeTasks(BODY, [], LABELS, 'x')).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({ ...ERRORS[i % 4], id: `m${i}` }));
    expect(buildPracticeTasks(BODY, many, LABELS, 'x')).toHaveLength(5);
  });

  it('builds a gap in the student’s own sentence', () => {
    const tasks = buildPracticeTasks(BODY, [ERRORS[1]], LABELS, 'gap-seed');
    const gap = tasks.find((t) => t.kind === 'gap');
    expect(gap).toMatchObject({
      kind: 'gap',
      before: 'However, ',
      after: ' should be careful because of the children spend too much time online.',
      original: 'the society',
      answer: 'society',
      note: 'Ghi chú e2',
    });
  });

  it('offers the right and wrong version for "choose", and never pre-orders the words', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      for (const t of buildPracticeTasks(BODY, ERRORS, LABELS, seed)) {
        if (t.kind === 'choose') {
          expect(t.options).toHaveLength(2);
          expect(t.options[t.answer]).not.toContain(
            ERRORS.find((e) => t.id.endsWith(e.id))!.excerpt,
          );
        }
        if (t.kind === 'order') expect(t.words.join(' ')).not.toBe(t.answer);
        if (t.kind === 'category') {
          expect(new Set(t.options).size).toBe(t.options.length);
          expect(t.options[t.answer]).toBe(t.category);
        }
        if (t.kind === 'match') {
          t.answer.forEach((a, i) => {
            const e = ERRORS.find((x) => x.excerpt === t.items[i])!;
            expect(t.options[a]).toBe(e.correction);
          });
        }
      }
    }
  });

  it('uses "name the mistake" when there is no correction to practise', () => {
    const noFix = { ...ERRORS[0], correction: '' };
    const [task] = buildPracticeTasks(BODY, [noFix], LABELS, 'z');
    expect(task.kind).toBe('category');
    expect(task.kind === 'category' && task.correction).toBe('');
  });
});

describe('answer checking and sentence context', () => {
  it('ignores case, spaces, curly quotes and final punctuation', () => {
    expect(normalizeAnswer('  It’s   FINE.  ')).toBe("it's fine");
    expect(answerMatches('people think', 'People think.')).toBe(true);
    expect(answerMatches('people thinks', 'people think')).toBe(false);
    expect(answerMatches('', '')).toBe(false);
  });

  it('shortens long sentences and copes with errors that have no position', () => {
    const long = `${'word '.repeat(80)}the error here ${'more '.repeat(80)}.`;
    const e = {
      ...ERRORS[0],
      excerpt: 'the error',
      start: long.indexOf('the error'),
      end: long.indexOf('the error') + 9,
    };
    const { before, after } = sentenceAround(long, e);
    expect(before.startsWith('…')).toBe(true);
    expect(after.endsWith('…')).toBe(true);
    expect(before.length).toBeLessThanOrEqual(142);
    expect(sentenceAround(BODY, { ...ERRORS[0], start: null, end: null })).toEqual({
      before: '',
      after: '',
    });
  });
});
