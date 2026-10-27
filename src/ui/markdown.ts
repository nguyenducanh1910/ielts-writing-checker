// Feedback is written in Markdown. It is rendered with marked and then
// sanitized with DOMPurify, so raw HTML in feedback can never run.
import DOMPurify from 'dompurify';
import { marked } from 'marked';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'a',
  'del',
];

export function markdown(text: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'markdown';
  if (!text.trim()) return container;
  const html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'title'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    RETURN_DOM_FRAGMENT: true,
  });
  container.appendChild(fragment);
  container.querySelectorAll('a').forEach((a) => {
    a.setAttribute('rel', 'noopener noreferrer nofollow');
    a.setAttribute('target', '_blank');
  });
  return container;
}

/** Pasted tool output and reconcile notes: plain text only, line breaks kept. */
export function plainText(text: string): HTMLElement {
  const pre = document.createElement('div');
  pre.className = 'plain-text';
  pre.textContent = text;
  return pre;
}
