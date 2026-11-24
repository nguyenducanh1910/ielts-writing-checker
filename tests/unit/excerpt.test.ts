import { describe, expect, it } from 'vitest';
import { findExcerpt, placeExcerpts } from '../../shared/excerpt';

describe('excerpt to offset matching', () => {
  const body = 'He go to school. He go to work. They goes home.';

  it('finds an exact excerpt', () => {
    expect(findExcerpt(body, 'They goes')).toEqual({ start: 32, end: 41 });
  });

  it('trims outer whitespace; ignores case and repeated spaces when there is no exact match', () => {
    expect(findExcerpt(body, '  They goes ')).toEqual({ start: 32, end: 41 });
    expect(findExcerpt(body, 'they goes')).toEqual({ start: 32, end: 41 });
    expect(findExcerpt(body, 'They  goes')).toEqual({ start: 32, end: 41 });
    expect(findExcerpt(body, '')).toBeNull();
  });

  it('finds excerpts across line breaks and curly quotes (essays pasted from Word/PDF)', () => {
    const text =
      'Overall, the figure of Train\u2019s\nusers underwent a\r\ndownward trend, dropped dramatically.';
    const a = findExcerpt(text, "the figure of Train's users")!;
    expect(text.slice(a.start, a.end)).toBe('the figure of Train\u2019s\nusers');
    const b = findExcerpt(text, 'underwent a downward trend, dropped dramatically')!;
    expect(text.slice(b.start, b.end)).toBe('underwent a\r\ndownward trend, dropped dramatically');
  });

  it('places "first words ... last words" from the first to the last part', () => {
    const text = 'In 1990 this figure witnesses a rise, and car users rise sharply.';
    const s = findExcerpt(text, 'this figure witnesses... car users rise')!;
    expect(text.slice(s.start, s.end)).toBe('this figure witnesses a rise, and car users rise');
  });

  it('accepts a copy with one small difference, but not different text', () => {
    const text = 'Many children prefer to stay their hometowns after school.';
    const s = findExcerpt(text, 'prefer to stay there hometowns')!;
    expect(text.slice(s.start, s.end)).toBe('prefer to stay their hometowns');
    expect(findExcerpt(text, 'completely different words here')).toBeNull();
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
