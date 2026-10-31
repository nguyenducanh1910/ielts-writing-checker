// Groups essays that answer the same question, however they were submitted. Two prompts match when
// they are the same apart from capitals, spaces, line breaks and punctuation (including straight
// or curly quotes). Different wording, even one changed word, is a different prompt.

/** The prompt reduced to lower-case words and numbers separated by single spaces. */
export function normalizePrompt(text: string): string {
  return (text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** 32-bit FNV-1a hash as 8 hex digits, with a choice of starting value. */
function fnv(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** A short key (16 hex digits) for a prompt, the same for matching prompts; '' when empty. */
export function promptKey(text: string): string {
  const normal = normalizePrompt(text);
  if (!normal) return '';
  return fnv(normal, 0x811c9dc5) + fnv(normal, 0x01000193);
}

export const PROMPT_KEY_RE = /^[0-9a-f]{16}$/;

/** The start of a prompt on one line, for a dropdown. */
export function promptLabel(text: string, max = 90): string {
  const line = (text || '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
