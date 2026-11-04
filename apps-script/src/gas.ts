// Apps Script entry points and the real Google service adapters.
// Everything else in the back end is plain TypeScript that receives `Services`.
import { callApi } from './api';
import { adminTimezone, createCtx } from './context';
import { recordEmailOpen } from './email';
import { runSetup } from './setup';
import { runAiJobs } from './aiScoring';
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
    SEED_DEMO: p.getProperty('SEED_DEMO') ?? undefined,
    GEMINI_API_KEY: p.getProperty('GEMINI_API_KEY') ?? undefined,
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
    GmailApp.sendEmail(m.to, m.subject, m.text, {
      htmlBody: m.html,
      name: 'IELTS Classroom Portal',
    });
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
    setSecret: (name, value) => {
      const p = PropertiesService.getScriptProperties();
      if (value) p.setProperty(name, value);
      else p.deleteProperty(name);
      props[name] = value || undefined;
    },
    http: {
      fetchAll: (requests) =>
        UrlFetchApp.fetchAll(
          requests.map((r) => ({
            url: r.url,
            method: 'post' as const,
            contentType: 'application/json',
            headers: r.headers,
            payload: r.body,
            muteHttpExceptions: true,
          })),
        ).map((res) => ({ status: res.getResponseCode(), text: res.getContentText() })),
    },
    jobs: {
      runSoon: (handler) => {
        const waiting = ScriptApp.getProjectTriggers().some(
          (t) => t.getHandlerFunction() === handler,
        );
        if (!waiting)
          ScriptApp.newTrigger(handler)
            .timeBased()
            .after(60 * 1000)
            .create();
      },
    },
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
    webAppUrl: () => {
      try {
        return ScriptApp.getService().getUrl() || '';
      } catch {
        return '';
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

/** Health check, and the tracking image in result emails (?o=<token>). */
export function doGet(e?: GoogleAppsScript.Events.DoGet) {
  const token = e?.parameter?.o;
  if (token) {
    try {
      const svc = realServices();
      if (svc.lock.tryLock(5000)) {
        try {
          recordEmailOpen(createCtx(svc), token);
        } finally {
          svc.lock.releaseLock();
        }
      }
    } catch (err) {
      console.error(err);
    }
    // Apps Script cannot return an image; an empty reply is enough to record the open.
    return ContentService.createTextOutput('');
  }
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
/**
 * Google lets the owner untick single permissions on the consent screen. Ask again for any
 * that are missing (Gemini needs script.external_request) before setup runs.
 */
function requireAllScopes() {
  const app = ScriptApp as unknown as {
    requireScopes?: (mode: GoogleAppsScript.Script.AuthMode, scopes: string[]) => void;
  };
  app.requireScopes?.(ScriptApp.AuthMode.FULL, [
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/script.scriptapp',
  ]);
}

export function setup() {
  requireAllScopes();
  const svc = realServices();
  const lock = svc.lock;
  lock.waitLock(30000);
  try {
    const result = runSetup(svc, { demo: svc.props.SEED_DEMO === 'true' });
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

/** Background automatic scoring (one-off trigger set by "Score all with AI"). */
export function aiJob() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'aiJob') ScriptApp.deleteTrigger(t);
  }
  const result = runAiJobs(realServices());
  console.log(JSON.stringify(result));
  return result;
}

/** Hourly: send queued email when quota returns; auto-submit abandoned timed tests. */
export function hourlyJob() {
  const result = runHourlyJob(realServices());
  console.log(JSON.stringify(result));
  return result;
}
