// Narrow interfaces over the Google services the back end uses.
// The Apps Script entry point (gas.ts) passes the real services; tests and the
// mock API server pass in-memory implementations (apps-script/testing).

/** Subset of SpreadsheetApp.Range that the data layer uses. */
export interface RangeLike {
  getValues(): unknown[][];
  setValues(values: unknown[][]): unknown;
  setNumberFormat(format: string): unknown;
}

/** Subset of SpreadsheetApp.Sheet that the data layer uses. */
export interface SheetLike {
  getName(): string;
  getLastRow(): number;
  getLastColumn(): number;
  getMaxRows(): number;
  getRange(row: number, column: number, numRows: number, numColumns: number): RangeLike;
  insertRowsAfter(afterPosition: number, howMany: number): unknown;
  deleteRow(rowPosition: number): unknown;
  setFrozenRows(rows: number): unknown;
}

/** Subset of SpreadsheetApp.Spreadsheet that the data layer uses. */
export interface SpreadsheetLike {
  getSheetByName(name: string): SheetLike | null;
  insertSheet(name: string): SheetLike;
}

export interface StoredFile {
  mimeType: string;
  base64: string;
  name: string;
}

/** High-level Drive operations, implemented with DriveApp/DocumentApp in gas.ts. */
export interface DriveService {
  /** Create a folder inside the parent and return its ID. */
  createFolder(parentId: string, name: string): string;
  /** Names of the direct child folders of a folder. */
  listFolderNames(parentId: string): string[];
  getFolderName(folderId: string): string;
  renameFolder(folderId: string, name: string): void;
  trashFolder(folderId: string): void;
  /** Return the ID of a child folder with this name, creating it if needed. */
  ensureFolder(parentId: string, name: string): string;
  saveFile(folderId: string, name: string, mimeType: string, base64: string): string;
  readFile(fileId: string): StoredFile;
  moveFile(fileId: string, folderId: string): void;
  copyFile(fileId: string, folderId: string, name: string): string;
  trashFile(fileId: string): void;
  /** Create a Google Doc with plain paragraphs inside the folder. */
  createDoc(folderId: string, title: string, paragraphs: string[]): string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailService {
  remainingQuota(): number;
  send(message: MailMessage): void;
}

/** Subset of CacheService.Cache. */
export interface CacheLike {
  get(key: string): string | null;
  put(key: string, value: string, expirationInSeconds?: number): void;
  remove(key: string): void;
}

/** Subset of LockService.Lock. */
export interface LockLike {
  waitLock(timeoutInMillis: number): void;
  releaseLock(): void;
}

export interface ScriptProps {
  ADMIN_EMAIL?: string;
  SHEET_ID?: string;
  DRIVE_ROOT_FOLDER_ID?: string;
  APP_URL?: string;
  /** Shared with IELTS Harper Portal (its HARPER_SECRET) for portal.essays.import. */
  PORTAL_SECRET?: string;
}

export interface Services {
  spreadsheet: SpreadsheetLike;
  drive: DriveService;
  mail: MailService;
  cache: CacheLike;
  lock: LockLike;
  props: ScriptProps;
  uuid(): string;
  sha256Hex(text: string): string;
  now(): Date;
  /** Offset of the time zone from UTC at the given instant, in minutes (e.g. +420 for UTC+7). */
  tzOffsetMinutes(date: Date, timeZone: string): number;
  log(message: string): void;
}
