// Request validation. Every handler reads its payload through a Reader, which
// collects field errors and throws one ApiError listing all of them.
import { isValidBand } from '../../shared/band';
import { isDateString } from '../../shared/dates';
import { ApiError } from './context';

type Obj = Record<string, unknown>;

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isEmail(v: string): boolean {
  return v.length <= 254 && EMAIL_RE.test(v);
}

export class Reader {
  readonly errors: Record<string, string> = {};
  private readonly data: Obj;

  constructor(payload: unknown) {
    this.data = isObject(payload) ? payload : {};
  }

  private fail(key: string, message: string) {
    if (!this.errors[key]) this.errors[key] = message;
  }

  has(key: string): boolean {
    const v = this.data[key];
    return v !== undefined && v !== null && v !== '';
  }

  raw(key: string): unknown {
    return this.data[key];
  }

  str(
    key: string,
    opts: { max: number; min?: number; optional?: boolean; trim?: boolean },
  ): string {
    const v = this.data[key];
    if (v === undefined || v === null || v === '') {
      if (!opts.optional) this.fail(key, 'Required');
      return '';
    }
    if (typeof v !== 'string') {
      this.fail(key, 'Must be text');
      return '';
    }
    const text = opts.trim === false ? v : v.trim();
    if (!opts.optional && text === '') this.fail(key, 'Required');
    if (opts.min !== undefined && text.length < opts.min)
      this.fail(key, `Must be at least ${opts.min} characters`);
    if (text.length > opts.max) this.fail(key, `Must be at most ${opts.max} characters`);
    return text;
  }

  id(key: string, optional = false): string {
    const v = this.str(key, { max: 64, optional });
    if (v && !ID_RE.test(v)) this.fail(key, 'Invalid ID');
    return v;
  }

  ids(key: string, max = 500): string[] {
    const v = this.data[key];
    if (v === undefined || v === null) return [];
    if (
      !Array.isArray(v) ||
      v.length > max ||
      !v.every((x) => typeof x === 'string' && ID_RE.test(x))
    ) {
      this.fail(key, 'Invalid list of IDs');
      return [];
    }
    return v as string[];
  }

  email(key: string): string {
    const v = this.str(key, { max: 254 }).toLowerCase();
    if (v && !isEmail(v)) this.fail(key, 'Enter a valid email address');
    return v;
  }

  oneOf<T extends string>(key: string, values: readonly T[], optional = false): T | '' {
    const v = this.data[key];
    if (v === undefined || v === null || v === '') {
      if (!optional) this.fail(key, 'Required');
      return '';
    }
    if (typeof v !== 'string' || !values.includes(v as T)) {
      this.fail(key, `Must be one of: ${values.join(', ')}`);
      return '';
    }
    return v as T;
  }

  bool(key: string): boolean {
    const v = this.data[key];
    if (v === undefined || v === null) return false;
    if (typeof v !== 'boolean') {
      this.fail(key, 'Must be true or false');
      return false;
    }
    return v;
  }

  int(key: string, opts: { min: number; max: number; optional?: boolean }): number | null {
    const v = this.data[key];
    if (v === undefined || v === null || v === '') {
      if (!opts.optional) this.fail(key, 'Required');
      return null;
    }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < opts.min || v > opts.max) {
      this.fail(key, `Must be a whole number from ${opts.min} to ${opts.max}`);
      return null;
    }
    return v;
  }

  band(key: string, optional = false): number | null {
    const v = this.data[key];
    if (v === undefined || v === null || v === '') {
      if (!optional) this.fail(key, 'Required');
      return null;
    }
    if (!isValidBand(v)) {
      this.fail(key, 'Must be 0 to 9 in 0.5 steps');
      return null;
    }
    return v;
  }

  date(key: string, optional = false): string {
    const v = this.str(key, { max: 10, optional });
    if (v && !isDateString(v)) this.fail(key, 'Use the format YYYY-MM-DD');
    return v;
  }

  isoTime(key: string, optional = false): string {
    const v = this.str(key, { max: 40, optional });
    if (v && (!ISO_RE.test(v) || Number.isNaN(Date.parse(v)))) this.fail(key, 'Invalid date-time');
    return v ? new Date(v).toISOString() : '';
  }

  timezone(key: string): string {
    const v = this.str(key, { max: 64, optional: true });
    if (v && !TZ_RE.test(v)) this.fail(key, 'Invalid time zone');
    return v;
  }

  object(key: string, optional = false): Reader | null {
    const v = this.data[key];
    if (v === undefined || v === null) {
      if (!optional) this.fail(key, 'Required');
      return null;
    }
    if (!isObject(v)) {
      this.fail(key, 'Must be an object');
      return null;
    }
    return new Reader(v);
  }

  array(key: string, max: number): unknown[] {
    const v = this.data[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      this.fail(key, 'Must be a list');
      return [];
    }
    if (v.length > max) this.fail(key, `At most ${max} items`);
    return v.slice(0, max);
  }

  /** Merge a nested reader's errors under a prefix. */
  absorb(prefix: string, child: Reader) {
    for (const [k, m] of Object.entries(child.errors)) this.fail(`${prefix}.${k}`, m);
  }

  addError(key: string, message: string) {
    this.fail(key, message);
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) {
      throw new ApiError('bad_request', 'Please check the highlighted fields.', this.errors);
    }
  }
}
