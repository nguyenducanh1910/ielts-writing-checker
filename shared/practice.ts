// Error practice: short tasks built from the errors the teacher tagged in an essay. A student
// completes them before the score and feedback unlock. Everything here is pure: the same essay
// always gets the same tasks (the essay ID seeds the shuffle), so a reload shows the same set.
import type { Criterion } from './constants';

/** At most this many tasks per essay. */
export const PRACTICE_MAX_TASKS = 5;
/** After this many wrong answers the task shows the answer and the teacher's note. */
export const PRACTICE_TRIES_BEFORE_ANSWER = 2;

export interface PracticeError {
  id: string;
  category: string;
  criterion: Criterion;
  excerpt: string;
  correction: string;
  note: string;
  start: number | null;
  end: number | null;
}

interface TaskBase {
  id: string;
  /** Category of the error and the teacher's note, shown once the task is answered. */
  category: string;
  note: string;
}

export type PracticeTask =
  /** Type the correct words for the gap in the student's own sentence. */
  | (TaskBase & { kind: 'gap'; before: string; after: string; original: string; answer: string })
  /** Choose the correct version of the student's sentence. */
  | (TaskBase & { kind: 'choose'; options: string[]; answer: number })
  /** Put the words of the correction in order. */
  | (TaskBase & { kind: 'order'; before: string; after: string; words: string[]; answer: string })
  /** Name the kind of mistake. */
  | (TaskBase & {
      kind: 'category';
      excerpt: string;
      correction: string;
      options: string[];
      answer: number;
    })
  /** Match each mistake with its correction. `answer[i]` is the index in `options` for item i. */
  | (TaskBase & { kind: 'match'; items: string[]; options: string[]; answer: number[] });

export type PracticeKind = PracticeTask['kind'];

// ---------- Small helpers ----------

/** Deterministic random numbers from a text seed (mulberry32 over a string hash). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Compare answers ignoring case, extra spaces, curly quotes and final punctuation. */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,!?;:]+$/, '')
    .toLowerCase();
}

export function answerMatches(given: string, expected: string): boolean {
  return normalizeAnswer(given) !== '' && normalizeAnswer(given) === normalizeAnswer(expected);
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

const MAX_CONTEXT = 140;

/**
 * The sentence around an error, split into the text before and after it. Long sentences are
 * shortened around the error. Without a position, the error stands alone.
 */
export function sentenceAround(body: string, e: PracticeError): { before: string; after: string } {
  if (e.start === null || e.end === null || body.slice(e.start, e.end) !== e.excerpt) {
    return { before: '', after: '' };
  }
  let from = e.start;
  while (from > 0 && !/[.!?\n]/.test(body[from - 1])) from--;
  let to = e.end;
  while (to < body.length && !/[.!?\n]/.test(body[to])) to++;
  if (to < body.length && body[to] !== '\n') to++; // keep the full stop
  let before = body.slice(from, e.start).replace(/^\s+/, '');
  let after = body.slice(e.end, to).replace(/\s+$/, '');
  if (before.length > MAX_CONTEXT) before = `…${before.slice(-MAX_CONTEXT).replace(/^\S*\s/, '')}`;
  if (after.length > MAX_CONTEXT) after = `${after.slice(0, MAX_CONTEXT).replace(/\s\S*$/, '')}…`;
  return { before, after };
}

// ---------- Which tasks suit an error ----------

function hasCorrection(e: PracticeError): boolean {
  return e.correction.trim() !== '' && normalizeAnswer(e.correction) !== normalizeAnswer(e.excerpt);
}

function suits(kind: Exclude<PracticeKind, 'match'>, e: PracticeError): boolean {
  if (kind === 'category') return true;
  if (!hasCorrection(e)) return false;
  const n = words(e.correction).length;
  if (kind === 'gap') return n <= 6;
  if (kind === 'order') {
    const shuffledDiffers = new Set(words(e.correction).map((w) => w.toLowerCase())).size > 1;
    return n >= 3 && n <= 10 && shuffledDiffers;
  }
  return true; // choose
}

function buildTask(
  kind: Exclude<PracticeKind, 'match'>,
  e: PracticeError,
  body: string,
  categoryLabels: string[],
  rand: () => number,
): PracticeTask {
  const base = { id: `${kind}-${e.id}`, category: e.category, note: e.note };
  const { before, after } = sentenceAround(body, e);
  switch (kind) {
    case 'gap':
      return { ...base, kind, before, after, original: e.excerpt, answer: e.correction.trim() };
    case 'order': {
      const answer = e.correction.trim();
      let shuffled = shuffle(words(answer), rand);
      // Never show the words already in the right order.
      for (let i = 0; i < 5 && shuffled.join(' ') === answer; i++)
        shuffled = shuffle(shuffled, rand);
      if (shuffled.join(' ') === answer) shuffled = [...shuffled.slice(1), shuffled[0]];
      return { ...base, kind, before, after, words: shuffled, answer };
    }
    case 'choose': {
      const right = `${before}${e.correction.trim()}${after}`.trim();
      const wrong = `${before}${e.excerpt}${after}`.trim();
      const options = shuffle([right, wrong], rand);
      return { ...base, kind, options, answer: options.indexOf(right) };
    }
    case 'category': {
      // The essay's other categories come first in categoryLabels: they make the best contrast.
      const others = [...new Set(categoryLabels)].filter((c) => c !== e.category).slice(0, 3);
      const options = shuffle([e.category, ...others], rand);
      return {
        ...base,
        kind,
        excerpt: e.excerpt,
        correction: hasCorrection(e) ? e.correction.trim() : '',
        options,
        answer: options.indexOf(e.category),
      };
    }
  }
}

const ROTATION: Array<Exclude<PracticeKind, 'match'>> = ['gap', 'choose', 'order', 'category'];

/**
 * Up to `max` tasks for an essay, mixing kinds. Essays with 4 or more corrected errors also get
 * one matching task. `categoryLabels` (all category names) supply wrong options for "name the
 * mistake" tasks; the essay's own categories are used first.
 */
export function buildPracticeTasks(
  body: string,
  errors: PracticeError[],
  categoryLabels: string[],
  seed: string,
  max = PRACTICE_MAX_TASKS,
): PracticeTask[] {
  if (errors.length === 0 || max <= 0) return [];
  const rand = seededRandom(seed);
  const order = shuffle(errors, rand);
  const corrected = order.filter(hasCorrection);
  const labels = [...errors.map((e) => e.category), ...shuffle(categoryLabels, rand)];
  const withMatch = corrected.length >= 4 && max >= 2;
  const singles = order.slice(0, withMatch ? max - 1 : max);
  const tasks: PracticeTask[] = singles.map((e, i) => {
    const start = i % ROTATION.length;
    const kind =
      [...ROTATION.slice(start), ...ROTATION.slice(0, start)].find((k) => suits(k, e)) ??
      'category';
    return buildTask(kind, e, body, labels, rand);
  });
  if (withMatch) {
    // Prefer errors not already practised, then fill up with the others.
    const used = new Set(singles.map((e) => e.id));
    const picked = [
      ...corrected.filter((e) => !used.has(e.id)),
      ...corrected.filter((e) => used.has(e.id)),
    ].slice(0, 4);
    const options = shuffle(
      picked.map((e) => e.correction.trim()),
      rand,
    );
    tasks.push({
      id: `match-${picked.map((e) => e.id).join('-')}`,
      kind: 'match',
      category: '',
      note: '',
      items: picked.map((e) => e.excerpt),
      options,
      answer: picked.map((e) => options.indexOf(e.correction.trim())),
    });
  }
  return tasks;
}
