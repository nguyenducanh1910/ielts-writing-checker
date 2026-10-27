// Email content: table-based HTML that renders in Gmail and Outlook, plus a
// plain-text version. All dynamic text goes through escapeHtml.
import { formatBand } from '../../shared/band';
import { escapeHtml as e } from '../../shared/escape';
import type { MailMessage } from './services';

interface Layout {
  to: string;
  subject: string;
  preheader: string;
  heading: string;
  /** Pre-escaped HTML blocks. */
  blocks: string[];
  button?: { label: string; url: string };
  text: string[];
}

function layout(l: Layout): MailMessage {
  const button = l.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr>
<td bgcolor="#c2410c" style="border-radius:6px">
<a href="${e(l.button.url)}" style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#ffffff;text-decoration:none;font-weight:bold">${e(l.button.label)}</a>
</td></tr></table>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(l.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6"><tr><td align="center" style="padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px" bgcolor="#ffffff">
<tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111827">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827">${e(l.heading)}</h1>
${l.blocks.join('\n')}
${button}
<p style="margin:24px 0 0;font-size:13px;color:#4b5563">IELTS Harper · This email was sent by your teacher's account.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [...l.text, ...(l.button ? ['', `${l.button.label}: ${l.button.url}`] : [])].join(
    '\n',
  );
  return { to: l.to, subject: l.subject, html, text };
}

const p = (text: string) => `<p style="margin:0 0 12px">${e(text)}</p>`;

export function loginEmail(to: string, name: string, url: string): MailMessage {
  return layout({
    to,
    subject: 'Your login link for IELTS Harper',
    preheader: 'This link works once and expires in 15 minutes.',
    heading: `Hi ${name}`,
    blocks: [
      p('Use the button below to log in. The link works once and expires in 15 minutes.'),
      p('If you did not ask for this email, you can ignore it.'),
    ],
    button: { label: 'Log in', url },
    text: [
      `Hi ${name},`,
      '',
      'Use this link to log in. It works once and expires in 15 minutes.',
      'If you did not ask for this email, you can ignore it.',
    ],
  });
}

export interface ResultEmailData {
  to: string;
  name: string;
  taskTypeLabel: string;
  topic: string;
  modeLabel: string;
  overall: number;
  criteria: Array<{ label: string; score: number }>;
  summary: string;
  topErrors: Array<{ category: string; excerpt: string; correction: string }>;
  rewriteDue: string | null;
  url: string;
  resent: boolean;
}

export function resultEmail(d: ResultEmailData): MailMessage {
  const rows = d.criteria
    .map(
      (c) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${e(c.label)}</td><td align="right" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-weight:bold">${e(formatBand(c.score))}</td></tr>`,
    )
    .join('');
  const errors = d.topErrors.length
    ? `<h2 style="font-size:18px;margin:20px 0 8px">Top errors to fix</h2><ol style="margin:0 0 12px;padding-left:20px">${d.topErrors
        .map(
          (x) =>
            `<li style="margin-bottom:8px"><strong>${e(x.category)}</strong><br>“${e(x.excerpt)}” → <span style="color:#065f46">${e(x.correction)}</span></li>`,
        )
        .join('')}</ol>`
    : '';
  const rewrite = d.rewriteDue
    ? `<p style="margin:12px 0;padding:12px;background:#fef3c7;color:#78350f">Rewrite required by <strong>${e(d.rewriteDue)}</strong>.</p>`
    : '';
  return layout({
    to: d.to,
    subject: `${d.resent ? 'Updated score' : 'Your score'}: ${d.taskTypeLabel} – Band ${formatBand(d.overall)}`,
    preheader: `Overall band ${formatBand(d.overall)} for your ${d.taskTypeLabel} essay on ${d.topic}.`,
    heading: d.resent ? 'Your essay score was updated' : 'Your essay has been scored',
    blocks: [
      p(`Hi ${d.name},`),
      p(`${d.taskTypeLabel} · ${d.topic} · ${d.modeLabel}`),
      `<p style="margin:0 0 12px;font-size:28px;font-weight:bold;color:#c2410c">Overall band ${e(formatBand(d.overall))}</p>`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 12px">${rows}</table>`,
      d.summary ? p(d.summary) : '',
      errors,
      rewrite,
      p('Your full feedback and highlighted essay are on the website.'),
    ],
    button: { label: 'View full feedback', url: d.url },
    text: [
      `Hi ${d.name},`,
      '',
      `${d.taskTypeLabel} · ${d.topic} · ${d.modeLabel}`,
      `Overall band: ${formatBand(d.overall)}`,
      ...d.criteria.map((c) => `${c.label}: ${formatBand(c.score)}`),
      '',
      d.summary,
      ...(d.topErrors.length
        ? [
            '',
            'Top errors to fix:',
            ...d.topErrors.map(
              (x, i) => `${i + 1}. ${x.category}: "${x.excerpt}" -> ${x.correction}`,
            ),
          ]
        : []),
      ...(d.rewriteDue ? ['', `Rewrite required by ${d.rewriteDue}.`] : []),
    ],
  });
}

export function rewriteReminderEmail(d: {
  to: string;
  name: string;
  topic: string;
  due: string;
  overdue: boolean;
  url: string;
}): MailMessage {
  const subject = d.overdue ? 'Your rewrite is overdue' : 'Reminder: your rewrite is due soon';
  const line = d.overdue
    ? `Your rewrite for the essay on ${d.topic} was due ${d.due}. You can still submit it; it will be marked late.`
    : `Your rewrite for the essay on ${d.topic} is due ${d.due}.`;
  return layout({
    to: d.to,
    subject,
    preheader: line,
    heading: subject,
    blocks: [p(`Hi ${d.name},`), p(line)],
    button: { label: 'Open the essay', url: d.url },
    text: [`Hi ${d.name},`, '', line],
  });
}

export function assignmentEmail(d: {
  to: string;
  name: string;
  title: string;
  taskTypeLabel: string;
  minutes: number;
  closes: string;
  url: string;
}): MailMessage {
  const line = `${d.title} (${d.taskTypeLabel}, ${d.minutes} minutes) is open until ${d.closes}. The prompt appears when you press "Start test", and the timer starts straight away.`;
  return layout({
    to: d.to,
    subject: `New writing test: ${d.title}`,
    preheader: line,
    heading: 'You have a new writing test',
    blocks: [p(`Hi ${d.name},`), p(line)],
    button: { label: 'Go to Assigned to me', url: d.url },
    text: [`Hi ${d.name},`, '', line],
  });
}
