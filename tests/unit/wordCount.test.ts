import { describe, expect, it } from 'vitest';
import { countWords } from '../../shared/wordCount';

describe('word count', () => {
  it('counts words separated by any whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('One two  three\nfour\tfive')).toBe(5);
  });

  it('counts hyphenated words and contractions once', () => {
    expect(countWords("well-known people don't agree")).toBe(4);
  });

  it('counts numbers but not stray punctuation', () => {
    expect(countWords('In 2020 , 45% of people - roughly half - agreed .')).toBe(8);
  });

  it('handles non-Latin letters', () => {
    expect(countWords('Hà Nội là thủ đô')).toBe(5);
  });
});
