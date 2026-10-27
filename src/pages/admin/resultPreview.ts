// Preview of what the student will receive, shown before a score is sent:
// the essay page (scores, feedback, highlighted errors) and the result email.
import { CRITERIA, criterionLabel, type Criterion, type TaskType } from '../../../shared/constants';
import { h } from '../../dom';
import type { ScoreView } from '../../types';
import { badge, notice } from '../../ui/components';
import { essayText, highlightLegend } from '../../ui/essayText';
import { formatBand, formatDateTime } from '../../ui/format';
import { markdown } from '../../ui/markdown';
import { tabs } from '../../ui/tabs';
import { scoreTable } from '../student/essayDetail';

export interface ServerPreview {
  to: string;
  studentName: string;
  overall: number;
  rewriteDueAt: string | null;
  delivery: 'send' | 'no_email' | 'none';
  subject: string;
  html: string;
  text: string;
}

export interface PreviewContent {
  taskType: TaskType;
  body: string;
  criteria: Record<Criterion, number>;
  feedback: Record<Criterion, string>;
  generalComment: string;
  errors: Array<{
    key: string;
    category: string;
    criterion: Criterion | null;
    excerpt: string;
    start: number | null;
    end: number | null;
    correction: string;
    note: string;
  }>;
  rewriteNote: string;
}

function studentView(p: PreviewContent, server: ServerPreview): HTMLElement {
  const score: ScoreView = {
    criteria: p.criteria,
    overall: server.overall,
    feedback: p.feedback,
    generalComment: p.generalComment,
    updatedAt: '',
  };
  const sorted = [...p.errors].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  return h(
    'div',
    { class: 'preview-student' },
    h(
      'div',
      { class: 'score-summary' },
      h(
        'div',
        { class: 'band-hero' },
        h('span', null, 'Overall band'),
        h('strong', null, formatBand(server.overall)),
      ),
      scoreTable(score, p.taskType),
    ),
    server.rewriteDueAt
      ? notice(
          'warning',
          h('h3', null, 'Rewrite required'),
          p.rewriteNote ? h('p', null, p.rewriteNote) : null,
          h('p', null, `Due ${formatDateTime(server.rewriteDueAt)}`),
        )
      : null,
    h('h3', null, 'Feedback'),
    p.generalComment.trim()
      ? h('div', { class: 'card' }, markdown(p.generalComment))
      : notice('warning', 'There is no general comment.'),
    ...CRITERIA.map((c) =>
      h(
        'div',
        { class: `card criterion-card crit-${c}` },
        h('h4', null, criterionLabel(c, p.taskType)),
        p.feedback[c].trim()
          ? markdown(p.feedback[c])
          : h('p', { class: 'hint' }, 'No feedback for this criterion.'),
      ),
    ),
    h('h3', null, `Essay with highlighted errors (${sorted.length})`),
    highlightLegend(),
    essayText(
      p.body,
      sorted.map((e) => ({
        id: e.key,
        start: e.start,
        end: e.end,
        label: e.category,
        correction: e.correction,
        criterion: e.criterion,
      })),
    ),
    sorted.length
      ? h(
          'ol',
          { class: 'error-list' },
          ...sorted.map((e) =>
            h(
              'li',
              null,
              h('strong', null, e.category),
              h(
                'div',
                null,
                h('span', { class: 'excerpt' }, `“${e.excerpt}”`),
                ' → ',
                h('span', { class: 'correction' }, e.correction),
              ),
              e.note ? h('div', { class: 'hint' }, e.note) : null,
            ),
          ),
        )
      : null,
  );
}

function emailView(server: ServerPreview): HTMLElement {
  const frame = h('iframe', {
    class: 'email-frame',
    title: 'Result email preview',
    // No scripts, forms or navigation inside the preview.
    sandbox: '',
    referrerpolicy: 'no-referrer',
  });
  frame.srcdoc = server.html;
  return h(
    'div',
    null,
    h(
      'dl',
      { class: 'email-meta' },
      h('dt', null, 'To'),
      h('dd', null, server.to || '(no email address)'),
      h('dt', null, 'Subject'),
      h('dd', null, server.subject),
    ),
    frame,
    h(
      'details',
      null,
      h('summary', null, 'Plain-text version'),
      h('pre', { class: 'plain-text', tabindex: '0' }, server.text),
    ),
  );
}

/**
 * Show the preview. Resolves true when the admin chooses to send/save,
 * false when they go back to editing.
 */
export function openResultPreview(
  content: PreviewContent,
  server: ServerPreview,
  options: { alreadyScored: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    const delivery =
      server.delivery === 'send'
        ? notice(
            'info',
            `When you send, ${server.studentName} sees this on the website and receives the email at ${server.to}.`,
          )
        : server.delivery === 'no_email'
          ? notice(
              'warning',
              `${server.studentName} has no email address. The score is saved, but no email is sent.`,
            )
          : notice(
              'info',
              'The updated score and feedback appear on the website. No email is sent (tick “Notify student again” to send one).',
            );
    const sendLabel =
      server.delivery === 'send'
        ? options.alreadyScored
          ? 'Send updated result'
          : 'Send to student'
        : 'Save final score';
    const returnFocus = document.activeElement as HTMLElement | null;
    const dialog = h(
      'dialog',
      { class: 'dialog preview-dialog', 'aria-labelledby': 'preview-title' },
      h('h2', { id: 'preview-title', tabindex: '-1' }, 'Preview: what the student will receive'),
      h(
        'p',
        { class: 'hint' },
        'Nothing has been saved or sent yet. Go back to edit anything, then preview again.',
      ),
      delivery,
      tabs(
        [
          { id: 'page', label: 'Essay page', panel: studentView(content, server) },
          {
            id: 'email',
            label: server.delivery === 'send' ? 'Email' : 'Email (not sent)',
            panel: emailView(server),
          },
        ],
        'Preview',
      ).element,
      h(
        'div',
        { class: 'actions preview-actions' },
        h('button', { type: 'button', class: 'btn', 'data-back': '' }, 'Back to editing'),
        h('button', { type: 'button', class: 'btn btn-primary', 'data-send': '' }, sendLabel),
        server.delivery === 'send' ? badge(`To: ${server.to}`) : null,
      ),
    );
    const close = (value: boolean) => {
      dialog.close();
      dialog.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(value);
    };
    dialog.querySelector('[data-back]')!.addEventListener('click', () => close(false));
    dialog.querySelector('[data-send]')!.addEventListener('click', () => close(true));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(false);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector<HTMLElement>('#preview-title')?.focus();
  });
}
