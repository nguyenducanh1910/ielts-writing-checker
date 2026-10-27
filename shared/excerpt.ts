// Map an error excerpt to character offsets in the essay.

export interface Span {
  start: number;
  end: number;
}

/**
 * Find the excerpt in the essay. Exact matches only (after trimming the
 * excerpt's outer whitespace). When the excerpt occurs several times, the
 * first occurrence not already used by an identical error is chosen.
 * Returns null when the excerpt cannot be placed.
 */
export function findExcerpt(body: string, excerpt: string, taken: Span[] = []): Span | null {
  const needle = excerpt.trim();
  if (!needle) return null;
  let first: Span | null = null;
  let from = 0;
  for (;;) {
    const idx = body.indexOf(needle, from);
    if (idx === -1) break;
    const span = { start: idx, end: idx + needle.length };
    first ??= span;
    if (!taken.some((t) => t.start === span.start && t.end === span.end)) return span;
    from = idx + 1;
  }
  return first;
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
