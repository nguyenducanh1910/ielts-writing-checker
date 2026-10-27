// Time zone helpers. The offset function is injected so the same code runs in
// Node (Intl) and Apps Script (Utilities.formatDate).

export type TzOffsetFn = (date: Date, timeZone: string) => number;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** The last millisecond of a calendar day in a time zone, as a UTC ISO string. */
export function endOfDayUtc(dateString: string, timeZone: string, offset: TzOffsetFn): string {
  const m = DATE_RE.exec(dateString);
  if (!m) throw new Error('Expected YYYY-MM-DD');
  const localAsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999);
  let guess = localAsUtc - offset(new Date(localAsUtc), timeZone) * 60000;
  // Re-check the offset at the guessed instant (handles DST boundaries).
  guess = localAsUtc - offset(new Date(guess), timeZone) * 60000;
  return new Date(guess).toISOString();
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDateString(date: Date, timeZone: string, offset: TzOffsetFn): string {
  return new Date(date.getTime() + offset(date, timeZone) * 60000).toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

/** Monday (UTC) of the ISO week containing the date, as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}
