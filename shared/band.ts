// IELTS band score helpers. Pure functions, unit tested.

/** True when value is a number from 0 to 9 in 0.5 steps. */
export function isValidBand(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 9 &&
    Number.isInteger(value * 2)
  );
}

/**
 * Round an average to the nearest IELTS half band.
 * Fractions below .25 round down to .0, from .25 up to (not including) .75
 * round to .5, and .75 or more round up to the next whole band:
 * .125 → .0, .25 → .5, .375 → .5, .625 → .5, .75 → +1, .875 → +1.
 */
export function roundBand(average: number): number {
  if (!Number.isFinite(average)) throw new Error('Average must be a finite number');
  // Work in eighths to avoid floating point drift (averages of 4 half bands are multiples of 1/8).
  const eighths = Math.round(average * 8);
  const whole = Math.floor(eighths / 8);
  const rest = eighths - whole * 8; // 0..7 eighths
  let result: number;
  if (rest < 2) result = whole;
  else if (rest < 6) result = whole + 0.5;
  else result = whole + 1;
  return Math.min(9, Math.max(0, result));
}

/** Overall band from the four criterion scores. */
export function overallBand(scores: readonly number[]): number {
  if (scores.length !== 4 || !scores.every(isValidBand)) {
    throw new Error('Four criterion scores from 0 to 9 in 0.5 steps are required');
  }
  return roundBand((scores[0] + scores[1] + scores[2] + scores[3]) / 4);
}

export function formatBand(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return value.toFixed(1);
}
