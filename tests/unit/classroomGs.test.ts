// Tests for the class system (classroom/Code.gs). The file is plain Apps Script, so it is
// loaded into a sandbox with small stand-ins for the Google services each test needs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CLASSROOM_VERSION } from '../../src/versions';

const SOURCE = readFileSync(new URL('../../classroom/Code.gs', import.meta.url), 'utf8');

type Sandbox = Record<string, any>;

function load(globals: Sandbox = {}): Sandbox {
  const ctx: Sandbox = {
    console: { log: () => undefined },
    Session: { getScriptTimeZone: () => 'Asia/Ho_Chi_Minh' },
    ...globals,
  };
  vm.createContext(ctx);
  // Top-level `const`/`let` are not properties of the sandbox: expose what the tests use.
  vm.runInContext(
    `${SOURCE}
;this.__ = { STATUS, CLASSROOM_VERSION, QUICK_SYNC_MINUTES,
  setProvider: (p) => { AI_PROVIDER_ = p; }, provider: () => AI_PROVIDER_ };`,
    ctx,
  );
  return ctx;
}

describe('class system code (classroom/Code.gs)', () => {
  it('declares the same version the web site expects', () => {
    expect(load().__.CLASSROOM_VERSION).toBe(CLASSROOM_VERSION);
  });

  it('reads AI answers with extra text around the JSON', () => {
    const gs = load();
    expect(gs.tryParseJson_('{"a":1}')).toEqual({ a: 1 });
    expect(gs.tryParseJson_('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(gs.tryParseJson_('{"a":1}\n\nSome notes after the JSON.')).toEqual({ a: 1 });
    expect(gs.tryParseJson_('not json at all')).toBeUndefined();
  });

  it('tells Vietnamese feedback from English feedback', () => {
    const gs = load();
    const vi = {
      summary: 'Bài nói khá trôi chảy, em cần mở rộng ý và dùng thêm từ nối.',
      criteria: { FC: { comment: 'Em nói tự nhiên nhưng còn ngập ngừng ở phần 3.' } },
    };
    const en = {
      summary: 'The answer is fluent but the ideas need more development.',
      criteria: { FC: { comment: 'Natural delivery with some hesitation in part 3.' } },
    };
    expect(gs.looksVietnamese_(vi)).toBe(true);
    expect(gs.looksVietnamese_(en)).toBe(false);
  });

  it('works out the hand-in status from Classroom data', () => {
    const gs = load();
    const S = gs.__.STATUS;
    const due = new Date('2026-11-06T11:00:00Z');
    const before = new Date('2026-11-06T10:00:00Z');
    const after = new Date('2026-11-06T12:00:00Z');
    expect(gs.statusOf_({ state: 'TURNED_IN' }, before, due, after)).toBe(S.ON_TIME);
    expect(gs.statusOf_({ state: 'TURNED_IN' }, after, due, after)).toBe(S.LATE);
    expect(gs.statusOf_({ state: 'RETURNED' }, before, due, after)).toBe(S.RETURNED);
    expect(gs.statusOf_({ state: 'CREATED' }, null, due, before)).toBe(S.NOT_YET);
    expect(gs.statusOf_({ state: 'CREATED' }, null, due, after)).toBe(S.MISSING);
  });

  it('uses 23:59 Vietnam time when an assignment has a due date but no time', () => {
    const gs = load();
    const d = gs.dueDate_({ dueDate: { year: 2026, month: 11, day: 6 } });
    expect(d.toISOString()).toBe('2026-11-06T16:59:00.000Z');
  });

  it('rounds the average band like IELTS', () => {
    const gs = load();
    expect(gs.roundIelts_(6.125)).toBe(6);
    expect(gs.roundIelts_(6.25)).toBe(6.5);
    expect(gs.roundIelts_(6.75)).toBe(7);
  });

  it('logs a quick update only when something changed', () => {
    const logs: string[] = [];
    const gs = load({
      Utilities: { formatDate: () => '10' },
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    });
    let a = 'Cập nhật nhanh 4 lớp, 9 bài tập, 120 lượt nộp (0 mới).';
    let b = 'Chấm: 0 bài R/L, 0 lượt AI';
    gs.syncAll_ = () => a;
    gs.gradeAll_ = () => b;
    gs.log_ = (title: string, text: string) => logs.push(`${title}: ${text}`);
    gs.quickSyncJob();
    expect(logs).toHaveLength(0);
    a = 'Cập nhật nhanh 4 lớp, 9 bài tập, 120 lượt nộp (0 mới, 3 đổi trạng thái).';
    gs.quickSyncJob();
    a = 'Cập nhật nhanh 4 lớp, 9 bài tập, 120 lượt nộp (0 mới).';
    b = 'Chấm: 2 bài R/L, 0 lượt AI';
    gs.quickSyncJob();
    expect(logs).toHaveLength(2);
  });

  it('skips the quick update at night', () => {
    let synced = false;
    const gs = load({ Utilities: { formatDate: () => '3' } });
    gs.syncAll_ = () => {
      synced = true;
      return '';
    };
    gs.quickSyncJob();
    expect(synced).toBe(false);
  });

  it('scores with Groq from a Whisper transcript, trying the second model when the first is busy', () => {
    const calls: string[] = [];
    const gs = load({
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k: string) => (k === 'GROQ_API_KEY' ? 'k' : null),
        }),
      },
      Utilities: { newBlob: () => ({}), base64Decode: (x: string) => x },
      UrlFetchApp: {
        fetch: (url: string, opts: any) => {
          if (url.includes('transcriptions')) {
            calls.push('whisper');
            return { getResponseCode: () => 200, getContentText: () => 'I like reading books.' };
          }
          const body = JSON.parse(opts.payload);
          calls.push(body.model);
          if (body.model === 'openai/gpt-oss-120b') {
            return { getResponseCode: () => 503, getContentText: () => 'busy' };
          }
          expect(body.messages[0].content).toContain('I like reading books.');
          return {
            getResponseCode: () => 200,
            getContentText: () =>
              JSON.stringify({ choices: [{ message: { content: '{"overall_band":6}' } }] }),
          };
        },
      },
    });
    const res = gs.callGroq_([
      { text: 'Grade this.' },
      { inline_data: { mime_type: 'audio/mp4', data: 'AAA' } },
    ]);
    expect(res).toEqual({ overall_band: 6 });
    expect(gs.__.provider()).toBe('groq');
    expect(calls).toEqual(['whisper', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile']);
    // Images and PDFs are left for Gemini.
    expect(
      gs.callGroq_([{ text: 'a' }, { inline_data: { mime_type: 'application/pdf', data: 'x' } }]),
    ).toBeUndefined();
  });
});
