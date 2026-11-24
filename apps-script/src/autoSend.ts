// Results the teacher has not sent within the set time (24 h by default) are sent by the system:
//  - the form the teacher saved, when it has all four scores (the teacher's own work);
//  - otherwise the newest AI result: Gemini's reconciled result, Gemini's own draft, or Claude's
//    pasted draft. Errors the app cannot place in the essay are left out.
// An essay with no AI result yet gets a Gemini job; it is sent once that job is done.
// Only essays submitted after the rule was first switched on (setting auto_send_since).
// Automatically sent results are marked (calibration.ts) so they are not used as samples or to
// measure Gemini's bias; when the teacher later edits and sends one again, it counts as theirs.
import {
  matchClaudeErrors,
  parseClaudeReply,
  parseReconcileReply,
  type ClaudeDraft,
} from '../../shared/claude';
import { CRITERIA, LIMITS } from '../../shared/constants';
import { bool, type Ctx, type EssayRow, num, parseJson } from './context';
import { queueAutoDraft } from './aiScoring';
import { saveScore } from './handlers/scoring';

export const DEFAULT_AUTO_SEND_HOURS = 24;
/** At most this many results per hourly run (Gmail quota and the 6-minute limit). */
const PER_RUN = 15;

export function autoSendHours(ctx: Ctx): number {
  const v = ctx.db.findOne('Settings', (s) => s.key === 'auto_send_hours')?.value ?? '';
  if (!String(v).trim()) return DEFAULT_AUTO_SEND_HOURS;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 24 * 30) : DEFAULT_AUTO_SEND_HOURS;
}

type DraftSource = 'reconciled' | 'ai' | 'claude';

/** The newest usable AI result of an essay, or null. */
export function bestDraft(
  ctx: Ctx,
  essayId: string,
): { draft: ClaudeDraft; source: DraftSource } | null {
  const drafts = ctx.db
    .find('Drafts', (d) => d.essay_id === essayId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const kind of ['reconcile', 'ai', 'initial'] as const) {
    for (const d of drafts.filter((x) => x.kind === kind)) {
      let draft: ClaudeDraft | null = null;
      if (kind === 'reconcile') {
        // "[Gemini API · model]\n<notes and ```json …```>"
        const res = parseReconcileReply(d.raw_text.replace(/^\[[^\]\n]*\]\s*/, ''));
        if (res.ok) draft = res.value;
      } else {
        const parsed = parseJson<ClaudeDraft | null>(d.parsed_json, null);
        if (
          parsed &&
          parsed.scores &&
          CRITERIA.every((c) => typeof parsed.scores[c] === 'number')
        ) {
          draft = parsed;
        } else if (d.raw_text) {
          const res = parseClaudeReply(d.raw_text);
          if (res.ok) draft = res.value;
        }
      }
      if (draft)
        return {
          draft,
          source: kind === 'reconcile' ? 'reconciled' : kind === 'ai' ? 'ai' : 'claude',
        };
    }
  }
  return null;
}

/** The form the teacher saved (status in_review), when all four scores are filled in. */
function teacherForm(ctx: Ctx, essay: EssayRow) {
  const s = ctx.db.findOne('Scores', (x) => x.essay_id === essay.id);
  if (!s) return null;
  const scores = [s.criterion_1, s.criterion_2, s.criterion_3, s.criterion_4].map(num);
  if (scores.some((x) => x === null)) return null;
  const feedback = parseJson<Record<string, string>>(s.feedback_json, {});
  const errors = ctx.db
    .find('ErrorLog', (e) => e.essay_id === essay.id)
    .map((e) => ({
      categoryId: e.category_id,
      excerpt: e.excerpt,
      start: num(e.start_offset),
      end: num(e.end_offset),
      correction: e.correction,
      note: e.note,
    }))
    .filter((e) => e.categoryId && e.start !== null && e.end !== null);
  return {
    scores: Object.fromEntries(CRITERIA.map((c, i) => [c, scores[i]])),
    feedback: Object.fromEntries(CRITERIA.map((c) => [c, String(feedback[c] ?? '')])),
    generalComment: s.general_comment,
    errors,
  };
}

/** The score form payload built from an AI result. */
function formFromDraft(ctx: Ctx, essay: EssayRow, draft: ClaudeDraft) {
  const cats = ctx.db
    .find('ErrorCategories', (c) => bool(c.active))
    .map((c) => ({ id: c.id, label: c.label, criterion: c.criterion }));
  const errors = matchClaudeErrors(draft.errors ?? [], cats, essay.body)
    .filter((e) => e.categoryId && !e.unplaced && e.start !== null && e.end !== null)
    .slice(0, LIMITS.errorsPerEssay)
    .map((e) => ({
      categoryId: e.categoryId!,
      excerpt: essay.body.slice(e.start!, e.end!),
      start: e.start,
      end: e.end,
      correction: String(e.correction ?? '').slice(0, LIMITS.correction),
      note: String(e.note ?? '').slice(0, LIMITS.note),
    }));
  return {
    scores: Object.fromEntries(CRITERIA.map((c) => [c, draft.scores[c]])),
    feedback: Object.fromEntries(
      CRITERIA.map((c) => [c, String(draft.feedback?.[c] ?? '').slice(0, LIMITS.feedback)]),
    ),
    generalComment: String(draft.generalComment ?? '').slice(0, LIMITS.feedback),
    errors,
  };
}

/**
 * Hourly: send the results of essays waiting longer than the set time. Returns what was done.
 * Each essay is saved on its own: one bad essay does not stop the others.
 */
export function autoSendOverdue(ctx: Ctx) {
  const hours = autoSendHours(ctx);
  const out = { sent: 0, queuedAi: 0, failed: 0, hours };
  if (hours <= 0) return out;
  const cutoff = ctx.now.getTime() - hours * 3600000;
  // Only essays submitted after the rule was first switched on: an old backlog is not sent at once.
  let since = ctx.db.findOne('Settings', (s) => s.key === 'auto_send_since')?.value ?? '';
  if (!since) {
    since = ctx.nowIso;
    ctx.db.insert('Settings', { key: 'auto_send_since', value: since });
  }
  const sinceMs = Date.parse(since) || 0;
  const waiting = ctx.db
    .find(
      'Essays',
      (e) =>
        (e.status === 'pending' || e.status === 'in_review') &&
        !e.withdrawn_at &&
        Boolean(e.submitted_at) &&
        Date.parse(e.submitted_at) <= cutoff &&
        Date.parse(e.submitted_at) >= sinceMs,
    )
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  const hasJobs = Boolean(ctx.svc.spreadsheet.getSheetByName('AiJobs'));
  for (const essay of waiting) {
    if (out.sent >= PER_RUN) break;
    const saved = essay.status === 'in_review' ? teacherForm(ctx, essay) : null;
    const best = saved ? null : bestDraft(ctx, essay.id);
    const form = saved ?? (best ? formFromDraft(ctx, essay, best.draft) : null);
    if (!form) {
      // No AI result yet: ask Gemini (not while a job waits, failed in the last 6 h or just finished).
      if (!hasJobs) continue;
      const jobs = ctx.db.find('AiJobs', (j) => j.essay_id === essay.id);
      const busy = jobs.some(
        (j) =>
          j.status === 'queued' ||
          j.status === 'running' ||
          (j.status === 'failed' && ctx.now.getTime() - Date.parse(j.updated_at) < 6 * 3600000) ||
          (j.status === 'done' && ctx.now.getTime() - Date.parse(j.updated_at) < 24 * 3600000),
      );
      if (!busy && queueAutoDraftForce(ctx, essay.id)) out.queuedAi++;
      continue;
    }
    try {
      saveScore(
        ctx,
        {
          essayId: essay.id,
          submit: true,
          notifyAgain: false,
          scores: form.scores,
          feedback: form.feedback,
          generalComment: form.generalComment,
          errors: form.errors,
        },
        { auto: !saved, keepRewrite: true },
      );
      out.sent++;
    } catch (err) {
      out.failed++;
      ctx.svc.log(`Auto-send failed for ${essay.id}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Queue a Gemini job for an overdue essay (the key must be set; ignores the auto-draft switch). */
function queueAutoDraftForce(ctx: Ctx, essayId: string): boolean {
  if (!ctx.svc.props.GEMINI_API_KEY) return false;
  if (queueAutoDraft(ctx, essayId)) return true;
  ctx.db.insert('AiJobs', {
    id: ctx.svc.uuid(),
    essay_id: essayId,
    status: 'queued',
    step: '',
    error: '',
    warnings: '',
    usage_json: '',
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
  });
  ctx.svc.jobs.runSoon('aiJob');
  return true;
}
