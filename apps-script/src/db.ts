// Table access over a Google Sheet: one tab per table, header row first,
// every cell stored as text. Rows are read once per request and cached.
import { SCHEMA, type Row, type TableName } from './schema';
import type { SheetLike, SpreadsheetLike } from './services';

const FORMULA_PREFIX = /^[=+\-@]/;

/**
 * Convert a value to the text stored in a cell. Values that Sheets would treat
 * as a formula (leading =, +, - or @) get a leading apostrophe so they are
 * always stored as plain text.
 */
export function toCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  // Requests are validated well below this; this guards against a silent Sheets failure.
  if (safe.length > MAX_CELL) throw new Error('Value is too long for a Sheet cell');
  return safe;
}

/** Google Sheets limit per cell. */
export const MAX_CELL = 50000;

/** Convert a cell value read from Sheets back to the stored text. */
export function fromCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  // Sheets normally hides the apostrophe prefix; strip it defensively if it shows up.
  if (text.length > 1 && text[0] === "'" && FORMULA_PREFIX.test(text.slice(1)))
    return text.slice(1);
  return text;
}

interface TableCache {
  sheet: SheetLike;
  header: string[];
  rows: Record<string, string>[];
}

export class Db {
  private tables = new Map<TableName, TableCache>();

  constructor(private readonly spreadsheet: SpreadsheetLike) {}

  private load(table: TableName): TableCache {
    const cached = this.tables.get(table);
    if (cached) return cached;
    const sheet = this.spreadsheet.getSheetByName(table);
    if (!sheet) throw new Error(`Missing sheet tab "${table}". Run setup() first.`);
    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(sheet.getLastColumn(), SCHEMA[table].length);
    const values = lastRow > 0 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
    const header = (values[0] ?? SCHEMA[table]).map((h) => fromCell(h)).filter((h) => h !== '');
    const rows = values.slice(1).map((raw) => {
      const row: Record<string, string> = {};
      header.forEach((col, i) => (row[col] = fromCell(raw[i])));
      for (const col of SCHEMA[table]) if (!(col in row)) row[col] = '';
      return row;
    });
    const entry = { sheet, header, rows };
    this.tables.set(table, entry);
    return entry;
  }

  /**
   * Write one row as plain text. The range is formatted as text first, so
   * Sheets never converts values (in a Vietnamese-locale Sheet "6.5" would
   * otherwise become a date). appendRow is not used: it parses values like
   * typed input and ignores the cell format.
   */
  private writeRow(entry: TableCache, rowNumber: number, row: Record<string, string>) {
    const range = entry.sheet.getRange(rowNumber, 1, 1, entry.header.length);
    range.setNumberFormat('@');
    range.setValues([this.toValues(entry.header, row)]);
  }

  private toValues(header: string[], row: Record<string, string>): string[] {
    return header.map((col) => toCell(row[col]));
  }

  all<T extends TableName>(table: T): Row<T>[] {
    return this.load(table).rows.map((r) => ({ ...r }) as Row<T>);
  }

  find<T extends TableName>(table: T, pred: (row: Row<T>) => boolean): Row<T>[] {
    return this.all(table).filter(pred);
  }

  findOne<T extends TableName>(table: T, pred: (row: Row<T>) => boolean): Row<T> | undefined {
    return this.all(table).find(pred);
  }

  byId<T extends TableName>(table: T, id: string): Row<T> | undefined {
    if (!id) return undefined;
    return this.findOne(table, (r) => (r as Record<string, string>).id === id);
  }

  insert<T extends TableName>(table: T, values: Partial<Record<keyof Row<T>, unknown>>): Row<T> {
    const entry = this.load(table);
    const row: Record<string, string> = {};
    for (const col of SCHEMA[table]) {
      const v = (values as Record<string, unknown>)[col];
      row[col] = v === null || v === undefined ? '' : String(v);
    }
    // Rows are cached in order, so the next free sheet row is right after them.
    const rowNumber = entry.rows.length + 2;
    const maxRows = entry.sheet.getMaxRows();
    if (rowNumber > maxRows) entry.sheet.insertRowsAfter(maxRows, 500);
    this.writeRow(entry, rowNumber, row);
    entry.rows.push(row);
    return { ...row } as Row<T>;
  }

  update<T extends TableName>(
    table: T,
    pred: (row: Row<T>) => boolean,
    patch: Partial<Record<keyof Row<T>, unknown>>,
  ): number {
    const entry = this.load(table);
    let count = 0;
    entry.rows.forEach((row, i) => {
      if (!pred({ ...row } as Row<T>)) return;
      for (const [k, v] of Object.entries(patch)) {
        row[k] = v === null || v === undefined ? '' : String(v);
      }
      this.writeRow(entry, i + 2, row);
      count++;
    });
    return count;
  }

  remove<T extends TableName>(table: T, pred: (row: Row<T>) => boolean): number {
    const entry = this.load(table);
    let count = 0;
    for (let i = entry.rows.length - 1; i >= 0; i--) {
      if (!pred({ ...entry.rows[i] } as Row<T>)) continue;
      entry.sheet.deleteRow(i + 2);
      entry.rows.splice(i, 1);
      count++;
    }
    return count;
  }
}
