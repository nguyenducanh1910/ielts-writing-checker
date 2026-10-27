// Time-driven jobs, installed by installTriggers():
// - daily: rewrite reminders (2 days before), overdue status + overdue email, housekeeping
// - hourly: send queued emails when Gmail quota returns; auto-submit abandoned timed tests
import { createCtx, type Ctx } from './context';
import { clearDashboardCache } from './dashboardCache';
import { processEmailQueue, sendEmail } from './email';
import { jobFromEvent, rewriteJob } from './emailJobs';
import { finalizeSubmission } from './handlers/essays';
import type { Services } from './services';
import { deadlineAt } from './views';
import { OVER_TIME_GRACE_SECONDS } from '../../shared/constants';
import { countWords } from '../../shared/wordCount';

const REMINDER_DAYS = 2;

function withLock<T>(svc: Services, fn: (ctx: Ctx) => T): T {
  svc.lock.waitLock(30000);
  try {
    return fn(createCtx(svc));
  } finally {
    svc.lock.releaseLock();
  }
}

export function rewriteDeadlines(ctx: Ctx) {
  const nowMs = ctx.now.getTime();
  let reminders = 0;
  let overdue = 0;
  for (const rr of ctx.db.find(
    'RewriteRequests',
    (r) => r.status === 'requested' || r.status === 'overdue',
  )) {
    const due = Date.parse(rr.due_at);
    if (Number.isNaN(due)) continue;
    const essay = ctx.db.byId('Essays', rr.essay_id);
    if (!essay || essay.status !== 'scored') continue;
    if (due < nowMs) {
      if (rr.status === 'requested') {
        ctx.db.update('RewriteRequests', (x) => x.id === rr.id, { status: 'overdue' });
        clearDashboardCache(ctx, essay.student_id);
        overdue++;
      }
      // Sent at most once: the idempotency key is rewrite_overdue:<request>:1.
      sendEmail(ctx, rewriteJob(ctx, { ...rr, status: 'overdue' }, 'rewrite_overdue'));
    } else if (due - nowMs <= REMINDER_DAYS * 86400000) {
      if (sendEmail(ctx, rewriteJob(ctx, rr, 'rewrite_reminder')) !== 'duplicate') reminders++;
    }
  }
  return { reminders, overdue };
}

/** Submit timed tests whose deadline (plus grace) passed while the student was away. */
export function autoSubmitExpired(ctx: Ctx) {
  const nowMs = ctx.now.getTime();
  let submitted = 0;
  for (const essay of ctx.db.find(
    'Essays',
    (e) => e.status === 'draft' && e.mode !== 'practice' && Boolean(e.started_at),
  )) {
    const deadline = deadlineAt(ctx, essay);
    if (!deadline || nowMs <= Date.parse(deadline) + OVER_TIME_GRACE_SECONDS * 1000) continue;
    if (countWords(essay.body) === 0) continue; // nothing was written; stays unsubmitted
    try {
      finalizeSubmission(ctx, essay, { autoSubmitted: true, at: deadline });
      submitted++;
    } catch (err) {
      ctx.svc.log(`Auto-submit failed for ${essay.id}: ${(err as Error).message}`);
    }
  }
  return { submitted };
}

function housekeeping(ctx: Ctx) {
  const cutoff = ctx.now.getTime() - 86400000;
  const tokens = ctx.db.remove('LoginTokens', (t) => Date.parse(t.expires_at) < cutoff);
  const sessions = ctx.db.remove('Sessions', (s) => Date.parse(s.expires_at) < ctx.now.getTime());
  return { tokens, sessions };
}

export function runDailyJob(svc: Services) {
  return withLock(svc, (ctx) => {
    const deadlines = rewriteDeadlines(ctx);
    const cleaned = housekeeping(ctx);
    return {
      reminders: deadlines.reminders,
      overdue: deadlines.overdue,
      expiredTokens: cleaned.tokens,
      expiredSessions: cleaned.sessions,
    };
  });
}

export function runHourlyJob(svc: Services) {
  return withLock(svc, (ctx) => {
    const auto = autoSubmitExpired(ctx);
    const queue = processEmailQueue(ctx, (e) => jobFromEvent(ctx, e));
    return {
      autoSubmitted: auto.submitted,
      emailsSent: queue.sent,
      emailsFailed: queue.failed,
      emailsQueued: queue.remaining,
    };
  });
}
