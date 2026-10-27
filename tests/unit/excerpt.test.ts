import { describe, expect, it } from 'vitest';
import { findExcerpt, placeExcerpts } from '../../shared/excerpt';

describe('excerpt to offset matching', () => {
  const body = 'He go to school. He go to work. They goes home.';

  it('finds an exact excerpt', () => {
    expect(findExcerpt(body, 'They goes')).toEqual({ start: 32, end: 41 });
  });

  it('trims outer whitespace but is otherwise exact', () => {
    expect(findExcerpt(body, '  They goes ')).toEqual({ start: 32, end: 41 });
    expect(findExcerpt(body, 'they goes')).toBeNull();
    expect(findExcerpt(body, 'They  goes')).toBeNull();
    expect(findExcerpt(body, '')).toBeNull();
  });

  it('uses the next occurrence for repeated excerpts', () => {
    const spans = placeExcerpts(body, ['He go', 'He go', 'He go']);
    expect(spans[0]).toEqual({ start: 0, end: 5 });
    expect(spans[1]).toEqual({ start: 17, end: 22 });
    // Only two occurrences exist; the third falls back to the first.
    expect(spans[2]).toEqual({ start: 0, end: 5 });
  });

  it('allows overlapping errors on different text', () => {
    const spans = placeExcerpts(body, ['He go to school', 'go']);
    expect(spans[0]).toEqual({ start: 0, end: 15 });
    expect(spans[1]).toEqual({ start: 3, end: 5 });
  });

  it('returns null for missing excerpts', () => {
    expect(placeExcerpts(body, ['missing'])).toEqual([null]);
  });
});
