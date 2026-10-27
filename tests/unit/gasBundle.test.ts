// Loads the real Apps Script bundle (apps-script/dist/Code.js) in a VM with
// fake Google globals, to check the adapters in gas.ts end to end:
// setup(), doPost() login + essay + scoring, installTriggers(), jobs.
import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  intlTzOffsetMinutes,
  MemoryCache,
  MemoryLock,
  MemorySpreadsheet,
} from '../../apps-script/testing/memory';

interface FakeFile {
  id: string;
  name: string;
  mime: string;
  bytes: number[];
  parent: string;
  trashed: boolean;
}
interface FakeFolder {
  id: string;
  name: string;
  parent: string;
  trashed: boolean;
}

function fakeGoogle() {
  const folders = new Map<string, FakeFolder>([
    ['ROOT', { id: 'ROOT', name: 'Root', parent: '', trashed: false }],
  ]);
  const files = new Map<string, FakeFile>();
  const outbox: Array<{ to: string; subject: string; text: string; html: string }> = [];
  const triggers: Array<{ handler: string }> = [];
  let seq = 0;
  const spreadsheet = new MemorySpreadsheet();
  const cache = new MemoryCache(() => new Date());
  const lock = new MemoryLock();
  const iter = <T>(list: T[]) => {
    let i = 0;
    return { hasNext: () => i < list.length, next: () => list[i++] };
  };
  const fileApi = (f: FakeFile) => ({
    getId: () => f.id,
    getName: () => f.name,
    getBlob: () => ({ getContentType: () => f.mime, getBytes: () => f.bytes }),
    moveTo: (folder: { getId(): string }) => {
      f.parent = folder.getId();
    },
    makeCopy: (name: string, folder: { getId(): string }) => {
      const id = `file-${++seq}`;
      const copy = { ...f, id, name, parent: folder.getId() };
      files.set(id, copy);
      return fileApi(copy);
    },
    setTrashed: (t: boolean) => {
      f.trashed = t;
    },
  });
  const folderApi = (f: FakeFolder): any => ({
    getId: () => f.id,
    getName: () => f.name,
    setName: (n: string) => {
      f.name = n;
    },
    setTrashed: (t: boolean) => {
      f.trashed = t;
    },
    createFolder: (name: string) => {
      const id = `folder-${++seq}`;
      const nf = { id, name, parent: f.id, trashed: false };
      folders.set(id, nf);
      return folderApi(nf);
    },
    getFolders: () =>
      iter([...folders.values()].filter((x) => x.parent === f.id && !x.trashed).map(folderApi)),
    getFoldersByName: (name: string) =>
      iter(
        [...folders.values()]
          .filter((x) => x.parent === f.id && x.name === name && !x.trashed)
          .map(folderApi),
      ),
    createFile: (blob: { bytes: number[]; mime: string; name: string }) => {
      const id = `file-${++seq}`;
      const nf = {
        id,
        name: blob.name,
        mime: blob.mime,
        bytes: blob.bytes,
        parent: f.id,
        trashed: false,
      };
      files.set(id, nf);
      return fileApi(nf);
    },
  });
  const props: Record<string, string> = {
    ADMIN_EMAIL: 'teacher@example.com',
    SHEET_ID: 'SHEET',
    DRIVE_ROOT_FOLDER_ID: 'ROOT',
    APP_URL: 'https://example.github.io/app/',
  };
  const globals = {
    console: { log: () => undefined, error: () => undefined },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null }),
    },
    SpreadsheetApp: { openById: (id: string) => (id === 'SHEET' ? spreadsheet : null) },
    DriveApp: {
      getFolderById: (id: string) => {
        const f = folders.get(id);
        if (!f) throw new Error('No folder');
        return folderApi(f);
      },
      getFileById: (id: string) => {
        const f = files.get(id);
        if (!f) throw new Error('No file');
        return fileApi(f);
      },
    },
    DocumentApp: {
      create: (title: string) => {
        const id = `file-${++seq}`;
        files.set(id, {
          id,
          name: title,
          mime: 'application/vnd.google-apps.document',
          bytes: [],
          parent: 'ROOT',
          trashed: false,
        });
        return {
          getId: () => id,
          getBody: () => ({ clear: () => undefined, appendParagraph: () => undefined }),
          saveAndClose: () => undefined,
        };
      },
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Apps Script returns signed bytes (-128..127).
      computeDigest: (_alg: string, text: string) =>
        [...createHash('sha256').update(text, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Decode: (s: string) =>
        [...Buffer.from(s, 'base64')].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes: number[]) =>
        Buffer.from(bytes.map((b) => (b + 256) % 256)).toString('base64'),
      newBlob: (bytes: number[], mime: string, name: string) => ({ bytes, mime, name }),
      formatDate: (date: Date, tz: string) => {
        const m = intlTzOffsetMinutes(date, tz);
        const sign = m < 0 ? '-' : '+';
        const a = Math.abs(m);
        return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
      },
    },
    MailApp: { getRemainingDailyQuota: () => 100 },
    GmailApp: {
      sendEmail: (to: string, subject: string, text: string, opts: { htmlBody: string }) => {
        outbox.push({ to, subject, text, html: opts.htmlBody });
      },
    },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => lock },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s: string) => ({
        content: s,
        setMimeType() {
          return this;
        },
      }),
    },
    ScriptApp: {
      getProjectTriggers: () =>
        triggers.map((t) => ({ getHandlerFunction: () => t.handler, ...t })),
      deleteTrigger: (t: { handler: string }) => {
        triggers.splice(
          triggers.findIndex((x) => x.handler === t.handler),
          1,
        );
      },
      newTrigger: (handler: string) => {
        const chain: any = {
          timeBased: () => chain,
          everyDays: () => chain,
          everyHours: () => chain,
          atHour: () => chain,
          inTimezone: () => chain,
          create: () => triggers.push({ handler }),
        };
        return chain;
      },
    },
  };
  return { globals, outbox, triggers, folders, files, lock };
}

let code = '';
beforeAll(() => {
  execSync('node apps-script/build.mjs', { stdio: 'ignore' });
  code = readFileSync('apps-script/dist/Code.js', 'utf8');
}, 60_000);

describe('Apps Script bundle with fake Google services', () => {
  it('runs setup, the JSON API, triggers and jobs', () => {
    const g = fakeGoogle();
    const sandbox: Record<string, any> = { ...g.globals };
    runInNewContext(code, sandbox);
    const post = (action: string, payload: unknown, token?: string) =>
      JSON.parse(
        sandbox.doPost({ postData: { contents: JSON.stringify({ action, payload, token }) } })
          .content,
      );

    const result = sandbox.setup();
    expect(result.createdTabs).toContain('Essays');
    expect(g.lock.held).toBe(false);

    expect(post('config.get', {}).data.classes).toHaveLength(5);
    expect(post('auth.requestLink', { email: 'teacher@example.com' }).ok).toBe(true);
    const mail = g.outbox.at(-1)!;
    expect(mail.to).toBe('teacher@example.com');
    const token = /token=([a-f0-9]+)/.exec(mail.text)![1];
    expect(mail.text).toContain('https://example.github.io/app/#/auth?token=');
    const session = post('auth.exchange', { token });
    expect(session.data.user.role).toBe('admin');
    const admin = session.data.sessionToken;
    const queue = post('admin.queue', {}, admin);
    expect(queue.ok).toBe(true);
    expect(queue.data.items.length).toBeGreaterThan(0);

    // Task 1 image is stored in Drive and returned as base64 after an access check.
    const essayId = queue.data.items[0].id;
    const img = post('admin.essayImage', { essayId }, admin);
    expect(img.data.base64).toMatch(/^iVBORw0KGgo/);
    // Demo folders were created with the expected names.
    expect(
      [...g.folders.values()].some((f) =>
        f.name.startsWith('Nguyen Van An - Task 1 Academic - Dynamic - '),
      ),
    ).toBe(true);

    expect(post('nope', {})).toMatchObject({ ok: false, error: { code: 'bad_request' } });

    sandbox.installTriggers();
    sandbox.installTriggers();
    expect(g.triggers.map((t) => t.handler).sort()).toEqual(['dailyJob', 'hourlyJob']);
    expect(sandbox.dailyJob()).toHaveProperty('reminders');
    expect(sandbox.hourlyJob()).toHaveProperty('emailsSent');
    expect(g.lock.held).toBe(false);
  });

  it('answers with a clear error when Script Properties are missing', () => {
    const g = fakeGoogle();
    const sandbox: Record<string, any> = {
      ...g.globals,
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    };
    runInNewContext(code, sandbox);
    const res = JSON.parse(
      sandbox.doPost({ postData: { contents: '{"action":"config.get"}' } }).content,
    );
    expect(res).toMatchObject({ ok: false, error: { code: 'server_error' } });
  });
});
