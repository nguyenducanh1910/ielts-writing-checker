import { describe, expect, it } from 'vitest';
import { isValidBand, overallBand, roundBand } from '../../shared/band';

describe('band rounding (acceptance check)', () => {
  it.each([
    [6.125, 6.0],
    [6.25, 6.5],
    [6.375, 6.5],
    [6.5, 6.5],
    [6.625, 6.5],
    [6.75, 7.0],
    [6.875, 7.0],
    [6.0, 6.0],
    [0, 0],
    [8.875, 9],
    [9, 9],
  ])('%s → %s', (avg, expected) => {
    expect(roundBand(avg)).toBe(expected);
  });

  it('computes the overall band from four criteria', () => {
    expect(overallBand([6, 6, 6, 6.5])).toBe(6.0); // 6.125
    expect(overallBand([6, 6, 6.5, 6.5])).toBe(6.5); // 6.25
    expect(overallBand([6.5, 6.5, 6.5, 7])).toBe(6.5); // 6.625
    expect(overallBand([6.5, 7, 7, 6.5])).toBe(7.0); // 6.75
    expect(overallBand([7, 7, 7, 6.5])).toBe(7.0); // 6.875
  });

  it('rejects invalid criterion scores', () => {
    expect(() => overallBand([6, 6, 6])).toThrow();
    expect(() => overallBand([6, 6, 6, 6.3])).toThrow();
    expect(() => overallBand([6, 6, 6, 9.5])).toThrow();
  });

  it('validates bands', () => {
    expect(isValidBand(0)).toBe(true);
    expect(isValidBand(9)).toBe(true);
    expect(isValidBand(5.5)).toBe(true);
    expect(isValidBand(5.25)).toBe(false);
    expect(isValidBand(-0.5)).toBe(false);
    expect(isValidBand('6')).toBe(false);
    expect(isValidBand(NaN)).toBe(false);
  });
});
