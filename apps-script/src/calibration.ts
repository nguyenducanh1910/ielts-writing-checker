// Joins source feedback with final scores for bias tracking.
import { overallBand } from '../../shared/band';
import { type SourceScoreRow, sourceCalibration } from '../../shared/stats';
import { bool, type Ctx, num } from './context';
import { cached } from './dashboardCache';

export function sourceScoreRows(ctx: Ctx, filter: { taskType?: string } = {}): SourceScoreRow[] {
  const essays = new Map(
    ctx.db
      .find(
        'Essays',
        (e) => e.status === 'scored' && (!filter.taskType || e.task_type === filter.taskType),
      )
      .map((e) => [e.id, e]),
  );
  const finals = new Map(ctx.db.all('Scores').map((s) => [s.essay_id, s]));
  const sources = new Map(ctx.db.all('FeedbackSources').map((s) => [s.id, s]));
  const rows: SourceScoreRow[] = [];
  for (const sf of ctx.db.all('SourceFeedback')) {
    const essay = essays.get(sf.essay_id);
    const final = finals.get(sf.essay_id);
    if (!essay || !final) continue;
    const c = [sf.criterion_1, sf.criterion_2, sf.criterion_3, sf.criterion_4].map(num);
    let overall = num(sf.overall);
    if (overall === null && c.every((x) => x !== null)) overall = overallBand(c as number[]);
    rows.push({
      sourceId: sf.source_id,
      sourceName: sources.get(sf.source_id)?.name ?? '',
      essayId: sf.essay_id,
      taskType: essay.task_type,
      scoredAt: essay.scored_at,
      source: { task: c[0], coherence: c[1], lexical: c[2], grammar: c[3], overall },
      final: {
        task: num(final.criterion_1) ?? 0,
        coherence: num(final.criterion_2) ?? 0,
        lexical: num(final.criterion_3) ?? 0,
        grammar: num(final.criterion_4) ?? 0,
        overall: num(final.overall) ?? 0,
      },
    });
  }
  return rows;
}

export function calibrationFor(ctx: Ctx, taskType = '', includeInactive = false) {
  return cached(ctx, 'admin', `calibration:${taskType}:${includeInactive}`, () => {
    const rows = sourceScoreRows(ctx, { taskType: taskType || undefined });
    const withData = new Set(rows.map((r) => r.sourceId));
    // Switched-off tools are shown only when they already have results (history stays visible).
    const sources = ctx.db
      .find('FeedbackSources', (s) => bool(s.active) || (includeInactive && withData.has(s.id)))
      .map((s) => ({ id: s.id, name: s.name }));
    return sourceCalibration(rows, sources);
  });
}

/** A calibration sample row that is in use (unticked rows stay as 'excluded'). */
export function activeSampleIds(ctx: Ctx): Set<string> {
  return new Set(
    ctx.db
      .all('CalibrationSamples')
      .filter((s) => s.source !== 'excluded')
      .map((s) => s.essay_id),
  );
}

export function isSample(ctx: Ctx, essayId: string): boolean {
  return ctx.db
    .find('CalibrationSamples', (s) => s.essay_id === essayId)
    .some((s) => s.source !== 'excluded');
}

/**
 * Mark an essay as a sample ('manual' ticked, 'auto' added when its result was sent) or
 * unticked ('excluded': remembered, so sending the result again does not add it back).
 * Before setup() has added the "source" column, unticking simply removes the row.
 */
export function setSample(ctx: Ctx, essayId: string, source: 'manual' | 'auto' | 'excluded') {
  const tracked = ctx.db.hasColumn('CalibrationSamples', 'source');
  const existing = ctx.db.find('CalibrationSamples', (s) => s.essay_id === essayId);
  if (source === 'auto') {
    if (existing.length || !tracked) return false; // already decided by the teacher (or no column yet)
  }
  ctx.db.remove('CalibrationSamples', (s) => s.essay_id === essayId);
  if (source === 'excluded' && !tracked) return false;
  ctx.db.insert('CalibrationSamples', {
    id: ctx.svc.uuid(),
    essay_id: essayId,
    created_at: ctx.nowIso,
    source,
  });
  return true;
}
