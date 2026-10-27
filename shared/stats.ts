// Pure statistics used by the dashboards and the source calibration page.
import { CRITERIA, type Criterion } from './constants';

export type ScoreKey = Criterion | 'overall';
export const SCORE_KEYS: ScoreKey[] = [...CRITERIA, 'overall'];

export interface SourceScoreRow {
  sourceId: string;
  sourceName: string;
  essayId: string;
  taskType: string;
  scoredAt: string;
  source: Partial<Record<ScoreKey, number | null>>;
  final: Record<ScoreKey, number>;
}

export interface SourceCalibration {
  sourceId: string;
  name: string;
  samples: number;
  /** Average (source − final). Positive means the source is generous. */
  bias: Record<ScoreKey, number | null>;
  /** Share of essays where the source is within 0.5 band of the final score. */
  within: Record<ScoreKey, number | null>;
  counts: Record<ScoreKey, number>;
  /** Overall bias per month, oldest first. */
  trend: Array<{ period: string; bias: number; samples: number }>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function sourceCalibration(
  rows: SourceScoreRow[],
  sources: Array<{ id: string; name: string }>,
): SourceCalibration[] {
  return sources.map((s) => {
    const mine = rows.filter((r) => r.sourceId === s.id);
    const bias = {} as Record<ScoreKey, number | null>;
    const within = {} as Record<ScoreKey, number | null>;
    const counts = {} as Record<ScoreKey, number>;
    for (const k of SCORE_KEYS) {
      const diffs = mine
        .filter((r) => typeof r.source[k] === 'number')
        .map((r) => (r.source[k] as number) - r.final[k]);
      counts[k] = diffs.length;
      const m = mean(diffs);
      bias[k] = m === null ? null : Math.round(m * 100) / 100;
      within[k] = diffs.length
        ? diffs.filter((d) => Math.abs(d) <= 0.5).length / diffs.length
        : null;
    }
    const byPeriod = new Map<string, number[]>();
    for (const r of mine) {
      if (typeof r.source.overall !== 'number') continue;
      const period = r.scoredAt.slice(0, 7);
      const list = byPeriod.get(period) ?? [];
      list.push(r.source.overall - r.final.overall);
      byPeriod.set(period, list);
    }
    const trend = [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, diffs]) => ({
        period,
        bias: Math.round((mean(diffs) ?? 0) * 100) / 100,
        samples: diffs.length,
      }));
    return {
      sourceId: s.id,
      name: s.name,
      samples: new Set(mine.map((r) => r.essayId)).size,
      bias,
      within,
      counts,
      trend,
    };
  });
}
