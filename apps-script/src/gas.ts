// Apps Script entry points and the real Google service adapters.
// Everything else in the back end is plain TypeScript that receives `Services`.
import { callApi } from './api';
import { adminTimezone, createCtx } from './context';
import { runSetup } from './setup';
import { runDailyJob, runHourlyJob } from './triggers';
import type { DriveService, MailService, ScriptProps, Services, StoredFile } from './services';

function scriptProps(): ScriptProps {
  const p = PropertiesService.getScriptProperties();
  return {
    ADMIN_EMAIL: p.getProperty('ADMIN_EMAIL') ?? undefined,
    SHEET_ID: p.getProperty('SHEET_ID') ?? undefined,
    DRIVE_ROOT_FOLDER_ID: p.getProperty('DRIVE_ROOT_FOLDER_ID') ?? undefined,
    APP_URL: p.getProperty('APP_URL') ?? undefined,
    PORTAL_SECRET: p.getProperty('PORTAL_SECRET') ?? undefined,
  };
}

const drive: DriveService = {
  createFolder: (parentId, name) => DriveApp.getFolderById(parentId).createFolder(name).getId(),
  listFolderNames: (parentId) => {
    const names: string[] = [];
    const it = DriveApp.getFolderById(parentId).getFolders();
    while (it.hasNext()) names.push(it.next().getName());
    return names;
  },
  getFolderName: (folderId) => DriveApp.getFolderById(folderId).getName(),
  renameFolder: (folderId, name) => {
    DriveApp.getFolderById(folderId).setName(name);
  },
  trashFolder: (folderId) => {
    DriveApp.getFolderById(folderId).setTrashed(true);
  },
  ensureFolder: (parentId, name) => {
    const parent = DriveApp.getFolderById(parentId);
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next().getId() : parent.createFolder(name).getId();
  },
  saveFile: (folderId, name, mimeType, base64) => {
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, name);
    return DriveApp.getFolderById(folderId).createFile(blob).getId();
  },
  readFile: (fileId): StoredFile => {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    return {
      mimeType: blob.getContentType() ?? 'application/octet-stream',
      base64: Utilities.base64Encode(blob.getBytes()),
      name: file.getName(),
    };
  },
  moveFile: (fileId, folderId) => {
    DriveApp.getFileById(fileId).moveTo(DriveApp.getFolderById(folderId));
  },
  copyFile: (fileId, folderId, name) =>
    DriveApp.getFileById(fileId).makeCopy(name, DriveApp.getFolderById(folderId)).getId(),
  trashFile: (fileId) => {
    DriveApp.getFileById(fileId).setTrashed(true);
  },
  createDoc: (folderId, title, paragraphs) => {
    const doc = DocumentApp.create(title);
    const body = doc.getBody();
    body.clear();
    paragraphs.forEach((p) => body.appendParagraph(p));
    doc.saveAndClose();
    DriveApp.getFileById(doc.getId()).moveTo(DriveApp.getFolderById(folderId));
    return doc.getId();
  },
};

const mail: MailService = {
  remainingQuota: () => MailApp.getRemainingDailyQuota(),
  send: (m) => {
    GmailApp.sendEmail(m.to, m.subject, m.text, { htmlBody: m.html, name: 'IELTS Harper' });
  },
};

function realServices(): Services {
  const props = scriptProps();
  if (!props.SHEET_ID) throw new Error('SHEET_ID Script Property is not set');
  return {
    spreadsheet: SpreadsheetApp.openById(props.SHEET_ID),
    drive,
    mail,
    cache: CacheService.getScriptCache(),
    lock: LockService.getScriptLock(),
    props,
    uuid: () => Utilities.getUuid(),
    sha256Hex: (text) =>
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
        .map((b) => ((b + 256) % 256).toString(16).padStart(2, '0'))
        .join(''),
    now: () => new Date(),
    tzOffsetMinutes: (date, timeZone) => {
      try {
        const z = Utilities.formatDate(date, timeZone, 'Z'); // e.g. +0700
        const sign = z.startsWith('-') ? -1 : 1;
        const minutes = sign * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
        return Number.isFinite(minutes) ? minutes : 0;
      } catch {
        return 0; // unknown time zone: fall back to UTC
      }
    },
    log: (message) => console.log(message),
  };
}

function json(data: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

export function doGet() {
  return json({ ok: true, data: { service: 'ielts-writing' } });
}

/**
 * The JSON API. The front end posts `Content-Type: text/plain` with a JSON
 * body, which avoids a CORS preflight.
 */
export function doPost(e: GoogleAppsScript.Events.DoPost) {
  let svc: Services;
  try {
    svc = realServices();
  } catch (err) {
    console.error(err);
    return json({
      ok: false,
      error: { code: 'server_error', message: 'The server is not configured yet.' },
    });
  }
  return json(callApi(svc, e?.postData?.contents ?? ''));
}

/** Run once from the Apps Script editor. */
export function setup() {
  const svc = realServices();
  const lock = svc.lock;
  lock.waitLock(30000);
  try {
    const result = runSetup(svc);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

const TRIGGER_HANDLERS = ['dailyJob', 'hourlyJob'];

/**
 * Run once from the Apps Script editor (after setup). Replaces any existing
 * triggers for these jobs, so running it again is safe.
 */
export function installTriggers() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (TRIGGER_HANDLERS.includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  }
  const svc = realServices();
  const tz = runSetupTimezone(svc);
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(7).inTimezone(tz).create();
  ScriptApp.newTrigger('hourlyJob').timeBased().everyHours(1).create();
  const message = `Installed dailyJob (07:00 ${tz}) and hourlyJob triggers.`;
  console.log(message);
  return message;
}

function runSetupTimezone(svc: Services): string {
  try {
    return adminTimezone(createCtx(svc));
  } catch {
    return 'Asia/Ho_Chi_Minh';
  }
}

/** Daily: rewrite reminders 2 days before, overdue status and email, housekeeping. */
export function dailyJob() {
  const result = runDailyJob(realServices());
  console.log(JSON.stringify(result));
  return result;
}

/** Hourly: send queued email when quota returns; auto-submit abandoned timed tests. */
export function hourlyJob() {
  const result = runHourlyJob(realServices());
  console.log(JSON.stringify(result));
  return result;
}
