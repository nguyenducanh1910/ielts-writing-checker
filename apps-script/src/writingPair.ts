// Writing Task 1 and Task 2 handed in together on Google Classroom arrive from the class system as
// two essays whose source is "portal:cr-<submission>#Writing Task <n>-<time>". They are marked as
// a pair: the first result email waits for the second, then one email carries both tasks and the
// overall Writing band (Task 2 counts double).
import { writingOverall } from '../../shared/band';
import type { Ctx, EssayRow } from './context';

const PAIR_RE = /^portal:(cr-.+)#Writing Task ([12])-\d+$/;

/** The other task of the same Classroom submission (latest copy, not withdrawn), if any. */
export function writingPartner(ctx: Ctx, essay: EssayRow): EssayRow | undefined {
  const m = PAIR_RE.exec(String(essay.source || ''));
  if (!m) return undefined;
  const prefix = `portal:${m[1]}#Writing Task ${m[2] === '1' ? '2' : '1'}-`;
  return ctx.db
    .find(
      'Essays',
      (e) =>
        e.id !== essay.id &&
        e.student_id === essay.student_id &&
        String(e.source || '').startsWith(prefix) &&
        !e.withdrawn_at,
    )
    .sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)))[0];
}

/** Whether this essay's result email went out (on its own or together with its pair). */
export function resultSent(ctx: Ctx, essayId: string): boolean {
  return Boolean(
    ctx.db.findOne(
      'EmailEvents',
      (e) =>
        e.essay_id === essayId &&
        (e.type === 'result' || e.type === 'result_resent') &&
        e.status === 'sent',
    ),
  );
}

/** Overall Writing band from the two tasks, whichever of them `a` is. */
export function pairOverall(a: EssayRow, aBand: number, bBand: number): number {
  return a.task_type === 'task2' ? writingOverall(bBand, aBand) : writingOverall(aBand, bBand);
}
