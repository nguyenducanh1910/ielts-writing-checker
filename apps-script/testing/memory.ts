// In-memory stand-ins for Sheets, Drive, Gmail, CacheService and LockService.
// Used by the Vitest suites and by the mock API server for Playwright.
// They mimic the behaviour that matters to the app: Sheets treats a leading
// "=" as a formula and hides a leading apostrophe; Gmail has a daily quota.
import type {
  CacheLike,
  DriveService,
  LockLike,
  MailMessage,
  MailService,
  RangeLike,
  ScriptProps,
  Services,
  SheetLike,
  SpreadsheetLike,
  StoredFile,
} from '../src/services';

interface Cell {
  value: unknown;
  formula?: string;
}

/**
 * Mimics how Google Sheets turns input into values in a cell that is NOT
 * formatted as plain text, for a Vietnamese-locale spreadsheet (comma is the
 * decimal separator, so "6.5" is read as the date 6 May).
 */
export function sheetsAutoParse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/^-?\d+$/.test(value)) return Number(value);
  const dm = /^(\d{1,2})\.(\d{1,2})$/.exec(value);
  if (dm && +dm[2] >= 1 && +dm[2] <= 12) return new Date(Date.UTC(2026, +dm[2] - 1, +dm[1]));
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00+07:00`);
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return new Date(value);
  return value;
}

export class MemorySheet implements SheetLike {
  cells: Cell[][] = [];
  /** Per row, the columns formatted as plain text ("@"). Shifts with deleted rows. */
  textFormat: Array<Set<number>> = [];
  maxRows = 1000;
  frozenRows = 0;
  constructor(private name: string) {}

  getName() {
    return this.name;
  }
  getLastRow() {
    return this.cells.length;
  }
  getLastColumn() {
    return this.cells.reduce((m, r) => Math.max(m, r.length), 0);
  }
  getMaxRows() {
    return this.maxRows;
  }
  insertRowsAfter(afterPosition: number, howMany: number) {
    if (afterPosition > this.maxRows) throw new Error('Row out of bounds');
    this.maxRows += howMany;
    this.textFormat.splice(
      afterPosition,
      0,
      ...Array.from({ length: howMany }, () => new Set<number>()),
    );
  }
  private write(value: unknown, asText: boolean): Cell {
    if (typeof value === 'string' && value.startsWith("'")) return { value: value.slice(1) };
    if (typeof value === 'string' && value.startsWith('=')) {
      return { value: '#ERROR!', formula: value };
    }
    return { value: asText ? value : sheetsAutoParse(value) };
  }
  getRange(row: number, column: number, numRows: number, numColumns: number): RangeLike {
    if (row < 1 || row + numRows - 1 > this.maxRows) {
      throw new Error(`Range is out of bounds (row ${row + numRows - 1} > ${this.maxRows})`);
    }
    return {
      getValues: () => {
        const out: unknown[][] = [];
        for (let r = 0; r < numRows; r++) {
          const line: unknown[] = [];
          for (let c = 0; c < numColumns; c++) {
            line.push(this.cells[row - 1 + r]?.[column - 1 + c]?.value ?? '');
          }
          out.push(line);
        }
        return out;
      },
      setValues: (values: unknown[][]) => {
        values.forEach((line, r) => {
          const target = (this.cells[row - 1 + r] ??= []);
          const fmt = this.textFormat[row - 1 + r];
          line.forEach(
            (v, c) => (target[column - 1 + c] = this.write(v, Boolean(fmt?.has(column + c)))),
          );
        });
        // Rows written past existing data leave no gaps in this simple model.
        for (let i = 0; i < this.cells.length; i++) this.cells[i] ??= [];
      },
      setNumberFormat: (format: string) => {
        for (let r = row; r < row + numRows; r++) {
          const set = (this.textFormat[r - 1] ??= new Set<number>());
          for (let c = column; c < column + numColumns; c++) {
            if (format === '@') set.add(c);
            else set.delete(c);
          }
        }
      },
    };
  }
  deleteRow(rowPosition: number) {
    this.cells.splice(rowPosition - 1, 1);
    this.textFormat.splice(rowPosition - 1, 1);
    this.textFormat.push(new Set<number>());
  }
  setFrozenRows(rows: number) {
    this.frozenRows = rows;
  }
  /** Number of cells Sheets would have evaluated as formulas. */
  formulaCount() {
    return this.cells.flat().filter((c) => c?.formula).length;
  }
}

export class MemorySpreadsheet implements SpreadsheetLike {
  sheets = new Map<string, MemorySheet>();
  getSheetByName(name: string) {
    return this.sheets.get(name) ?? null;
  }
  insertSheet(name: string) {
    const sheet = new MemorySheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
  formulaCount() {
    return [...this.sheets.values()].reduce((n, s) => n + s.formulaCount(), 0);
  }
}

export interface MemoryFolder {
  id: string;
  name: string;
  parentId: string;
  trashed: boolean;
}
export interface MemoryFile {
  id: string;
  name: string;
  mimeType: string;
  base64: string;
  folderId: string;
  trashed: boolean;
  paragraphs?: string[];
}

export class MemoryDrive implements DriveService {
  folders = new Map<string, MemoryFolder>();
  files = new Map<string, MemoryFile>();
  /** When true, the next folder creation throws (simulates a Drive outage). */
  failNextFolder = false;
  private seq = 0;

  constructor(rootId = 'root-folder') {
    this.folders.set(rootId, { id: rootId, name: 'Root', parentId: '', trashed: false });
  }
  private nextId(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }
  private folder(id: string) {
    const f = this.folders.get(id);
    if (!f || f.trashed) throw new Error(`No folder ${id}`);
    return f;
  }
  createFolder(parentId: string, name: string) {
    if (this.failNextFolder) {
      this.failNextFolder = false;
      throw new Error('Drive is unavailable');
    }
    this.folder(parentId);
    const id = this.nextId('folder');
    this.folders.set(id, { id, name, parentId, trashed: false });
    return id;
  }
  listFolderNames(parentId: string) {
    return [...this.folders.values()]
      .filter((f) => f.parentId === parentId && !f.trashed)
      .map((f) => f.name);
  }
  getFolderName(folderId: string) {
    return this.folder(folderId).name;
  }
  renameFolder(folderId: string, name: string) {
    this.folder(folderId).name = name;
  }
  trashFolder(folderId: string) {
    this.folder(folderId).trashed = true;
    for (const file of this.files.values()) if (file.folderId === folderId) file.trashed = true;
  }
  ensureFolder(parentId: string, name: string) {
    const existing = [...this.folders.values()].find(
      (f) => f.parentId === parentId && f.name === name && !f.trashed,
    );
    return existing ? existing.id : this.createFolder(parentId, name);
  }
  saveFile(folderId: string, name: string, mimeType: string, base64: string) {
    this.folder(folderId);
    const id = this.nextId('file');
    this.files.set(id, { id, name, mimeType, base64, folderId, trashed: false });
    return id;
  }
  readFile(fileId: string): StoredFile {
    const f = this.files.get(fileId);
    if (!f || f.trashed) throw new Error(`No file ${fileId}`);
    return { mimeType: f.mimeType, base64: f.base64, name: f.name };
  }
  moveFile(fileId: string, folderId: string) {
    const f = this.files.get(fileId);
    if (!f) throw new Error(`No file ${fileId}`);
    this.folder(folderId);
    f.folderId = folderId;
  }
  copyFile(fileId: string, folderId: string, name: string) {
    const f = this.readFile(fileId);
    return this.saveFile(folderId, name, f.mimeType, f.base64);
  }
  trashFile(fileId: string) {
    const f = this.files.get(fileId);
    if (f) f.trashed = true;
  }
  createDoc(folderId: string, title: string, paragraphs: string[]) {
    const id = this.saveFile(folderId, title, 'application/vnd.google-apps.document', '');
    this.files.get(id)!.paragraphs = paragraphs;
    return id;
  }
  childFolders(parentId: string) {
    return [...this.folders.values()].filter((f) => f.parentId === parentId);
  }
  filesIn(folderId: string) {
    return [...this.files.values()].filter((f) => f.folderId === folderId && !f.trashed);
  }
}

export class MemoryMail implements MailService {
  outbox: MailMessage[] = [];
  quota = 100;
  /** Number of upcoming sends that should throw. */
  failNext = 0;
  remainingQuota() {
    return this.quota;
  }
  send(message: MailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Gmail send failed');
    }
    if (this.quota <= 0) throw new Error('Service invoked too many times for one day: email.');
    this.quota--;
    this.outbox.push(message);
  }
}

export class MemoryCache implements CacheLike {
  private store = new Map<string, { value: string; expires: number }>();
  constructor(private clock: () => Date) {}
  get(key: string) {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expires <= this.clock().getTime()) {
      this.store.delete(key);
      return null;
    }
    return e.value;
  }
  put(key: string, value: string, expirationInSeconds = 600) {
    this.store.set(key, { value, expires: this.clock().getTime() + expirationInSeconds * 1000 });
  }
  remove(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

export class MemoryLock implements LockLike {
  held = false;
  acquisitions = 0;
  waitLock() {
    if (this.held) throw new Error('Lock already held');
    this.held = true;
    this.acquisitions++;
  }
  releaseLock() {
    this.held = false;
  }
}

/** Offset of a time zone from UTC in minutes, using Intl (Node). */
export function intlTzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

export interface MemoryServices extends Services {
  spreadsheet: MemorySpreadsheet;
  drive: MemoryDrive;
  mail: MemoryMail;
  cache: MemoryCache;
  lock: MemoryLock;
  setNow(date: Date | string): void;
  advance(ms: number): void;
}

export function createMemoryServices(
  props: Partial<ScriptProps> = {},
  options: { realTime?: boolean } = {},
): MemoryServices {
  // Tests use a fixed clock; the mock API server follows real time (plus any advance()).
  let current = new Date('2026-10-10T03:00:00.000Z');
  let offset = 0;
  let uuidSeq = 0;
  const clock = () =>
    options.realTime ? new Date(Date.now() + offset) : new Date(current.getTime());
  const svc: MemoryServices = {
    spreadsheet: new MemorySpreadsheet(),
    drive: new MemoryDrive('root-folder'),
    mail: new MemoryMail(),
    cache: new MemoryCache(clock),
    lock: new MemoryLock(),
    props: {
      ADMIN_EMAIL: 'admin@example.com',
      SHEET_ID: 'sheet-id',
      DRIVE_ROOT_FOLDER_ID: 'root-folder',
      APP_URL: 'http://localhost:4173/',
      ...props,
    },
    uuid: () => {
      uuidSeq++;
      const hex = uuidSeq.toString(16).padStart(12, '0');
      const rand = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
      return `${rand}-0000-4000-8000-${hex}`;
    },
    sha256Hex: (text: string) => sha256(text),
    now: clock,
    tzOffsetMinutes: intlTzOffsetMinutes,
    log: () => undefined,
    setNow(date) {
      current = new Date(date);
      offset = new Date(date).getTime() - Date.now();
    },
    advance(ms) {
      current = new Date(current.getTime() + ms);
      offset += ms;
    },
  };
  return svc;
}

// Small dependency-free SHA-256 so this file has no Node-only imports.
function sha256(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, len * 8);
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] += a;
    H[1] += b;
    H[2] += c;
    H[3] += d;
    H[4] += e;
    H[5] += f;
    H[6] += g;
    H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}
