// Gmail pipeline: idempotency keys, daily quota with a queue, attempt log.
// Callers already hold the script lock (every write request and every
// trigger runs inside LockService.getScriptLock()).
import { getNumberSetting, type Ctx } from './context';
import type { Row } from './schema';
import type { MailMessage } from './services';

export const EMAIL_TYPES = [
  'login',
  'result',
  'result_resent',
  'rewrite_reminder',
  'rewrite_overdue',
  'assignment_notice',
] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

/** 'no_email': the student has no email address (added by the teacher), so nothing is sent. */
export type SendOutcome = 'sent' | 'duplicate' | 'queued' | 'failed' | 'no_email';

export interface EmailJob {
  type: EmailType;
  /** ID the email is about: essay, rewrite request, assignment or user. */
  refId: string;
  /** Send version: makes the key unique per intended send. */
  version: string;
  userId: string;
  essayId?: string;
  /** Recipient address; empty for students the teacher added without an email. */
  to: string;
  build: () => MailMessage;
}

export function emailKey(type: EmailType, refId: string, version: string): string {
  return `${type}:${refId}:${version}`;
}

export function parseEmailKey(key: string): { type: EmailType; refId: string; version: string } {
  const [type, refId, ...rest] = key.split(':');
  return { type: type as EmailType, refId, version: rest.join(':') };
}

/** Login links always go first; other email keeps a reserve of quota for them. */
export function hasQuotaFor(ctx: Ctx, type: EmailType): boolean {
  const remaining = ctx.svc.mail.remainingQuota();
  if (type === 'login') return remaining > 0;
  return remaining > getNumberSetting(ctx, 'email_quota_reserve');
}

function record(
  ctx: Ctx,
  job: EmailJob,
  status: 'sent' | 'failed' | 'queued',
  error = '',
  openToken = '',
): Row<'EmailEvents'> {
  return ctx.db.insert('EmailEvents', {
    id: ctx.svc.uuid(),
    essay_id: job.essayId ?? '',
    user_id: job.userId,
    type: job.type,
    idempotency_key: emailKey(job.type, job.refId, job.version),
    status,
    error: error.slice(0, 500),
    created_at: ctx.nowIso,
    open_token: openToken,
  });
}

/**
 * Result emails get a 1×1 image from this web app, so the teacher can see when the email was
 * opened. It is a hint only: some mail apps block images, and some load them automatically.
 * Returns the message to send and the random token the image URL carries.
 */
export function withOpenTracking(
  ctx: Ctx,
  type: EmailType,
  message: MailMessage,
): { message: MailMessage; token: string } {
  const url = ctx.svc.webAppUrl();
  if (!url || (type !== 'result' && type !== 'result_resent')) return { message, token: '' };
  const token = ctx.svc.uuid().replace(/-/g, '');
  const img = `<img src="${url}?o=${token}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`;
  const html = message.html.includes('</body>')
    ? message.html.replace('</body>', `${img}</body>`)
    : message.html + img;
  return { message: { ...message, html }, token };
}

/** The tracking image of a result email was loaded: remember the first time. */
export function recordEmailOpen(ctx: Ctx, token: string): boolean {
  if (!/^[a-f0-9]{16,64}$/i.test(token)) return false;
  return (
    ctx.db.update('EmailEvents', (e) => e.open_token === token && !e.opened_at, {
      opened_at: ctx.nowIso,
    }) > 0
  );
}

export function sendEmail(ctx: Ctx, job: EmailJob): SendOutcome {
  if (!job.to) return 'no_email';
  const key = emailKey(job.type, job.refId, job.version);
  const previous = ctx.db.find('EmailEvents', (e) => e.idempotency_key === key);
  if (previous.some((e) => e.status === 'sent')) return 'duplicate';
  if (previous.some((e) => e.status === 'queued')) return 'queued';
  if (!hasQuotaFor(ctx, job.type)) {
    record(ctx, job, 'queued');
    return 'queued';
  }
  try {
    const { message, token } = withOpenTracking(ctx, job.type, job.build());
    ctx.svc.mail.send(message);
    record(ctx, job, 'sent', '', token);
    return 'sent';
  } catch (err) {
    record(ctx, job, 'failed', (err as Error).message);
    return 'failed';
  }
}

/**
 * Send queued email while quota allows, login links first, oldest first.
 * `rebuild` recreates the job from the stored event (content is never stored).
 */
export function processEmailQueue(
  ctx: Ctx,
  rebuild: (event: Row<'EmailEvents'>) => EmailJob | null,
): { sent: number; failed: number; remaining: number } {
  const queued = ctx.db
    .find('EmailEvents', (e) => e.status === 'queued')
    .sort((a, b) => {
      const pa = a.type === 'login' ? 0 : 1;
      const pb = b.type === 'login' ? 0 : 1;
      return pa - pb || a.created_at.localeCompare(b.created_at);
    });
  let sent = 0;
  let failed = 0;
  for (const event of queued) {
    if (!hasQuotaFor(ctx, event.type as EmailType)) continue;
    const alreadySent = ctx.db.findOne(
      'EmailEvents',
      (e) => e.idempotency_key === event.idempotency_key && e.status === 'sent',
    );
    if (alreadySent) {
      ctx.db.update('EmailEvents', (e) => e.id === event.id, {
        status: 'sent',
        error: 'duplicate',
      });
      continue;
    }
    let status: 'sent' | 'failed' = 'sent';
    let error = '';
    let openToken = '';
    try {
      const job = rebuild(event);
      if (!job) throw new Error('Nothing to send any more');
      if (!job.to) throw new Error('The student has no email address');
      const { message, token } = withOpenTracking(ctx, job.type, job.build());
      ctx.svc.mail.send(message);
      openToken = token;
      sent++;
    } catch (err) {
      status = 'failed';
      error = (err as Error).message.slice(0, 500);
      failed++;
    }
    ctx.db.update('EmailEvents', (e) => e.id === event.id, {
      status,
      error,
      open_token: openToken,
    });
  }
  const remaining = ctx.db.find('EmailEvents', (e) => e.status === 'queued').length;
  return { sent, failed, remaining };
}
