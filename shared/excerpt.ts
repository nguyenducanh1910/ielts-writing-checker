// Map an error excerpt to character offsets in the essay.

export interface Span {
  start: number;
  end: number;
}

/** Same letter for curly/straight quotes and dashes, lower case. */
function foldChar(ch: string): string {
  if (ch === '’' || ch === '‘' || ch === 'ʼ' || ch === '`') return "'";
  if (ch === '“' || ch === '”' || ch === '„') return '"';
  if (ch === '‚') return ',';
  if (ch === '–' || ch === '—') return '-';
  if (ch === '…') return '...';
  return ch.toLowerCase();
}

/**
 * The text with every run of whitespace turned into one space and quotes, dashes and case
 * folded, plus for each character of the folded text the offset it came from (and one extra
 * entry for the end). Essays pasted from Word/PDF often have line breaks inside sentences,
 * while the AI copies the sentence with spaces.
 */
function fold(text: string): { s: string; at: number[] } {
  let s = '';
  const at: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      const from = i;
      while (i < text.length && /\s/.test(text[i]!)) i++;
      s += ' ';
      at.push(from);
      continue;
    }
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) {
      s += f[k];
      at.push(i);
    }
    i++;
  }
  at.push(text.length);
  return { s, at };
}

/** Offsets in the essay of a match [a, b) in the folded text. */
function unfold(f: { at: number[] }, a: number, b: number): Span {
  return { start: f.at[a]!, end: f.at[b - 1]! + 1 };
}

function allIndexes(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) return out;
    out.push(idx);
    from = idx + 1;
  }
}

function pick(spans: Span[], taken: Span[]): Span | null {
  if (!spans.length) return null;
  return spans.find((s) => !taken.some((t) => t.start === s.start && t.end === s.end)) ?? spans[0]!;
}

/**
 * Edit distance between `a` and the best prefix of `w` (length within a.length ± max).
 * Returns the distance and the prefix length, or null when it is more than max.
 */
function prefixDistance(a: string, w: string, max: number): { d: number; len: number } | null {
  let prev = Array.from({ length: w.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowBest = i;
    for (let j = 1; j <= w.length; j++) {
      const v = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === w[j - 1] ? 0 : 1),
      );
      cur.push(v);
      if (v < rowBest) rowBest = v;
    }
    if (rowBest > max) return null;
    prev = cur;
  }
  let best: { d: number; len: number } | null = null;
  for (let len = Math.max(1, a.length - max); len <= Math.min(w.length, a.length + max); len++) {
    const d = prev[len]!;
    if (d <= max && (!best || d < best.d)) best = { d, len };
  }
  return best;
}

/**
 * Find the excerpt in the essay. Tried in order:
 *  1. exactly (after trimming the excerpt's outer whitespace);
 *  2. ignoring line breaks / repeated spaces, curly vs straight quotes and upper/lower case;
 *  3. "first words ... last words": from the first part to the last one (within 400 characters;
 *     only the first part when that is longer than 160 characters);
 *  4. almost the same text (at most about 1 character in 12 different, excerpts of 12–160
 *     characters), e.g. when the AI fixed a typo while copying.
 * When the excerpt occurs several times, the first occurrence not already used by an identical
 * error is chosen. Returns null when the excerpt cannot be placed.
 */
export function findExcerpt(body: string, excerpt: string, taken: Span[] = []): Span | null {
  const needle = excerpt.trim();
  if (!needle) return null;
  // 1. Exact
  const exact = allIndexes(body, needle).map((i) => ({ start: i, end: i + needle.length }));
  if (exact.length) return pick(exact, taken);

  const fb = fold(body);
  const fn = fold(needle).s.trim();
  if (!fn) return null;
  // 2. Whitespace, quotes and case
  const loose = allIndexes(fb.s, fn).map((i) => unfold(fb, i, i + fn.length));
  if (loose.length) return pick(loose, taken);

  // 3. "A ... B": from the first part to the last part
  const parts = fn
    .split(/\s*(?:\.\.\.+|\[\.\.\.\])\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  if (parts.length >= 2) {
    const spans: Span[] = [];
    for (const a of allIndexes(fb.s, parts[0]!)) {
      let pos = a + parts[0]!.length;
      let ok = true;
      for (const p of parts.slice(1)) {
        const idx = fb.s.indexOf(p, pos);
        if (idx === -1 || idx - a > 400) {
          ok = false;
          break;
        }
        pos = idx + p.length;
      }
      // A long gap: mark only the first part (a huge highlight is not useful to the student)
      if (ok) spans.push(unfold(fb, a, pos - a <= 160 ? pos : a + parts[0]!.length));
    }
    if (spans.length) return pick(spans, taken);
  }

  // 4. Almost the same text, starting at a word
  if (fn.length >= 12 && fn.length <= 160 && !/\.\.\./.test(fn)) {
    const max = Math.max(1, Math.floor(fn.length / 12));
    let best: { d: number; a: number; b: number } | null = null;
    for (let a = 0; a < fb.s.length; a++) {
      if (fb.s[a] === ' ') continue;
      if (a > 0 && /[\p{L}\p{N}']/u.test(fb.s[a - 1]!)) continue; // start at a word
      const m = prefixDistance(fn, fb.s.slice(a, a + fn.length + max), max);
      if (m && (!best || m.d < best.d)) best = { d: m.d, a, b: a + m.len };
      if (best && best.d === 0) break;
    }
    if (best) {
      // Do not end the span inside a word
      let b = best.b;
      while (
        b < fb.s.length &&
        /[\p{L}\p{N}]/u.test(fb.s[b]!) &&
        /[\p{L}\p{N}]/u.test(fb.s[b - 1]!)
      )
        b++;
      return unfold(fb, best.a, b);
    }
  }
  return null;
}

/** Place several excerpts in order, avoiding reuse of the same occurrence. */
export function placeExcerpts(body: string, excerpts: string[]): Array<Span | null> {
  const taken: Span[] = [];
  return excerpts.map((x) => {
    const span = findExcerpt(body, x, taken);
    if (span) taken.push(span);
    return span;
  });
}
