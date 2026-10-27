// Pure dashboard computations (band over time, criterion averages, top errors,
// progress highlights, essays per week, topics covered). Unit tested.
import { CRITERIA, type Criterion, DIAGRAM_TYPES, ESSAY_TYPES } from './constants';
import { weekStart } from './dates';

export interface DashError {
  categoryId: string;
  category: string;
  criterion: Criterion;
  excerpt: string;
  correction: string;
}

export interface DashEssay {
  id: string;
  taskType: string;
  mode: string;
  topicId: string;
  /** Display label: diagram type (Task 1) or "Topic · Essay type" (Task 2). */
  topic: string;
  diagramType?: string;
  essayType?: string;
  submittedAt: string;
  scoredAt: string;
  wordCount: number;
  /** null when not scored yet */
  overall: number | null;
  criteria: Record<Criterion, number> | null;
  errors: DashError[];
  isRewrite: boolean;
  /** Original essay ID when this essay is a rewrite. */
  parentId?: string | null;
}

export interface RewriteImprovement {
  originalId: string;
  rewriteId: string;
  topic: string;
  original: Record<Criterion | 'overall', number>;
  rewrite: Record<Criterion | 'overall', number>;
  change: Record<Criterion | 'overall', number>;
}

/** Original → rewrite change per criterion and overall, for scored pairs. */
export function rewriteImprovements(essays: DashEssay[]): RewriteImprovement[] {
  const byId = new Map(essays.map((e) => [e.id, e]));
  const keys = [...CRITERIA, 'overall'] as const;
  const scores = (e: DashEssay) =>
    Object.fromEntries(
      keys.map((k) => [k, k === 'overall' ? e.overall! : e.criteria![k]]),
    ) as Record<Criterion | 'overall', number>;
  return essays
    .filter((e) => e.parentId && e.overall !== null && e.criteria)
    .map((rw) => ({ rw, orig: byId.get(rw.parentId!) }))
    .filter((x): x is { rw: DashEssay; orig: DashEssay } =>
      Boolean(x.orig && x.orig.overall !== null && x.orig.criteria),
    )
    .sort((a, b) => b.rw.submittedAt.localeCompare(a.rw.submittedAt))
    .map(({ rw, orig }) => {
      const original = scores(orig);
      const rewrite = scores(rw);
      return {
        originalId: orig.id,
        rewriteId: rw.id,
        topic: orig.topic,
        original,
        rewrite,
        change: Object.fromEntries(
          keys.map((k) => [k, Math.round((rewrite[k] - original[k]) * 10) / 10]),
        ) as Record<Criterion | 'overall', number>,
      };
    });
}

export interface Filters {
  taskType?: string;
  mode?: string;
}

export function applyFilters(essays: DashEssay[], f: Filters): DashEssay[] {
  return essays.filter(
    (e) => (!f.taskType || e.taskType === f.taskType) && (!f.mode || e.mode === f.mode),
  );
}

const byDate = (a: DashEssay, b: DashEssay) => a.submittedAt.localeCompare(b.submittedAt);
const scoredOnly = (essays: DashEssay[]) =>
  essays.filter((e) => e.overall !== null && e.criteria !== null).sort(byDate);

export function bandOverTime(essays: DashEssay[]) {
  return scoredOnly(essays).map((e) => ({
    essayId: e.id,
    date: e.submittedAt,
    overall: e.overall as number,
    mode: e.mode,
    taskType: e.taskType,
    topic: e.topic,
  }));
}

export function criterionAverages(essays: DashEssay[]): Record<Criterion, number | null> {
  const scored = scoredOnly(essays);
  return Object.fromEntries(
    CRITERIA.map((c) => [
      c,
      scored.length
        ? Math.round((scored.reduce((s, e) => s + e.criteria![c], 0) / scored.length) * 100) / 100
        : null,
    ]),
  ) as Record<Criterion, number | null>;
}

export interface TopError {
  category: string;
  count: number;
  example: { excerpt: string; correction: string } | null;
}

/** Top 2 error categories for each criterion within the last `days` days. */
export function topErrorsByCriterion(
  essays: DashEssay[],
  now: Date,
  days: number,
  perCriterion = 2,
): Record<Criterion, TopError[]> {
  const since = now.getTime() - days * 86400000;
  const recent = scoredOnly(essays).filter((e) => Date.parse(e.scoredAt || e.submittedAt) >= since);
  const result = {} as Record<Criterion, TopError[]>;
  for (const c of CRITERIA) {
    const groups = new Map<string, { count: number; latest: DashError; at: string }>();
    for (const e of recent) {
      for (const err of e.errors.filter((x) => x.criterion === c)) {
        const g = groups.get(err.category);
        if (!g) groups.set(err.category, { count: 1, latest: err, at: e.submittedAt });
        else {
          g.count++;
          if (e.submittedAt >= g.at) {
            g.latest = err;
            g.at = e.submittedAt;
          }
        }
      }
    }
    result[c] = [...groups.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, perCriterion)
      .map(([category, g]) => ({
        category,
        count: g.count,
        example: { excerpt: g.latest.excerpt, correction: g.latest.correction },
      }));
  }
  return result;
}

export type HighlightKind = 'improving' | 'avoided' | 'attention';

export interface Highlight {
  kind: HighlightKind;
  category: string;
  criterion: Criterion;
  /** Errors per 100 words in the 3 essays before the last 3. */
  previousRate: number;
  /** Errors per 100 words in the last 3 scored essays. */
  recentRate: number;
  previousCount: number;
  recentCount: number;
  message: string;
}

function ratePer100(count: number, words: number): number {
  return words > 0 ? Math.round((count / words) * 10000) / 100 : 0;
}

/**
 * Compare each error category's rate (errors per 100 words) in the last 3
 * scored essays against the 3 before. Needs at least 4 scored essays.
 */
export function progressHighlights(essays: DashEssay[]): Highlight[] {
  const scored = scoredOnly(essays);
  const recent = scored.slice(-3);
  const previous = scored.slice(-6, -3);
  if (previous.length === 0) return [];
  const words = (list: DashEssay[]) => list.reduce((s, e) => s + Math.max(e.wordCount, 0), 0);
  const recentWords = words(recent);
  const previousWords = words(previous);
  const tally = (list: DashEssay[]) => {
    const m = new Map<string, { count: number; criterion: Criterion }>();
    for (const e of list) {
      for (const err of e.errors) {
        const t = m.get(err.category) ?? { count: 0, criterion: err.criterion };
        t.count++;
        m.set(err.category, t);
      }
    }
    return m;
  };
  const recentTally = tally(recent);
  const previousTally = tally(previous);
  const categories = new Set([...recentTally.keys(), ...previousTally.keys()]);
  const out: Highlight[] = [];
  for (const category of categories) {
    const r = recentTally.get(category);
    const p = previousTally.get(category);
    const recentCount = r?.count ?? 0;
    const previousCount = p?.count ?? 0;
    const recentRate = ratePer100(recentCount, recentWords);
    const previousRate = ratePer100(previousCount, previousWords);
    const criterion = (r ?? p)!.criterion;
    const base = { category, criterion, recentRate, previousRate, recentCount, previousCount };
    if (previousCount >= 2 && recentCount === 0) {
      out.push({
        ...base,
        kind: 'avoided',
        message: `Well done! No “${category}” mistakes in your last ${recent.length} essays.`,
      });
    } else if (recentRate < previousRate) {
      out.push({
        ...base,
        kind: 'improving',
        message: `“${category}” is improving: ${previousRate} → ${recentRate} per 100 words.`,
      });
    } else if (recentRate > previousRate) {
      out.push({
        ...base,
        kind: 'attention',
        message: `“${category}” needs attention: ${previousRate} → ${recentRate} per 100 words.`,
      });
    }
  }
  const order: Record<HighlightKind, number> = { avoided: 0, improving: 1, attention: 2 };
  return out.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      Math.abs(b.recentRate - b.previousRate) - Math.abs(a.recentRate - a.previousRate) ||
      a.category.localeCompare(b.category),
  );
}

/** Essays submitted per ISO week (Monday start), for the last `weeks` weeks including this one. */
export function essaysPerWeek(essays: DashEssay[], now: Date, weeks = 12) {
  const counts = new Map<string, number>();
  for (const e of essays) {
    if (!e.submittedAt) continue;
    const w = weekStart(e.submittedAt);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const out: Array<{ week: string; count: number }> = [];
  const thisWeek = weekStart(now.toISOString());
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${thisWeek}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    out.push({ week: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

export function topicsCovered(
  essays: DashEssay[],
  topics: Array<{ id: string; label: string; seeded: boolean }>,
) {
  const rows = [...essays]
    .filter((e) => e.submittedAt)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((e) => ({
      essayId: e.id,
      topicId: e.topicId,
      topic: e.topic,
      taskType: e.taskType,
      mode: e.mode,
      date: e.submittedAt,
      overall: e.overall,
    }));
  const attempted = new Set(rows.map((r) => r.topicId));
  const notAttempted = topics.filter((t) => t.seeded && !attempted.has(t.id)).map((t) => t.label);
  const diagrams = new Set(essays.filter((e) => e.submittedAt).map((e) => e.diagramType));
  const essayTypes = new Set(essays.filter((e) => e.submittedAt).map((e) => e.essayType));
  return {
    rows,
    notAttempted,
    diagramTypesNotAttempted: DIAGRAM_TYPES.filter((d) => !diagrams.has(d.id)).map((d) => d.label),
    essayTypesNotAttempted: ESSAY_TYPES.filter((d) => !essayTypes.has(d.id)).map((d) => d.label),
  };
}
