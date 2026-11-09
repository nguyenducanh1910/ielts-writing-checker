// Tests for the class system (classroom/Code.gs). The file is plain Apps Script, so it is
// loaded into a sandbox with small stand-ins for the Google services each test needs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CLASSROOM_VERSION } from '../../src/versions';

const SOURCE = readFileSync(new URL('../../classroom/Code.gs', import.meta.url), 'utf8');

type Sandbox = Record<string, any>;

/** Script Properties kept in memory. */
function memoryProps(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    service: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (k in data ? data[k] : null),
        setProperty: (k: string, v: string) => {
          data[k] = v;
        },
        deleteProperty: (k: string) => {
          delete data[k];
        },
        getProperties: () => ({ ...data }),
      }),
    },
  };
}

function load(globals: Sandbox = {}): Sandbox {
  const ctx: Sandbox = {
    console: { log: () => undefined },
    Session: { getScriptTimeZone: () => 'Asia/Ho_Chi_Minh' },
    PropertiesService: memoryProps().service,
    ...globals,
  };
  vm.createContext(ctx);
  // Top-level `const`/`let` are not properties of the sandbox: expose what the tests use.
  vm.runInContext(
    `${SOURCE}
;this.__ = { STATUS, CLASSROOM_VERSION, QUICK_SYNC_MINUTES, RUNTIME_WARN_MIN, S,
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

  it('adds up the time automatic runs take and warns the teacher once', () => {
    const props = memoryProps();
    const mails: string[] = [];
    const logs: string[] = [];
    const gs = load({
      PropertiesService: props.service,
      Utilities: { formatDate: () => '20261107' },
      MailApp: { sendEmail: (m: { subject: string }) => mails.push(m.subject) },
    });
    gs.getConfig_ = () => ({ reportEmail: 'teacher@example.com' });
    gs.log_ = (title: string) => logs.push(title);
    gs.addRuntime_(30 * 60000);
    expect(gs.runtimeTodayMs_()).toBe(30 * 60000);
    expect(mails).toHaveLength(0);
    gs.addRuntime_(45 * 60000);
    gs.addRuntime_(60000);
    expect(mails).toHaveLength(1);
    expect(logs).toEqual(['Sắp hết thời gian chạy']);
  });

  it('stops the quick update when the day is almost used up', () => {
    const props = memoryProps({ RT_10: String(80 * 60000) });
    let synced = false;
    const gs = load({
      PropertiesService: props.service,
      Utilities: { formatDate: () => '10' },
    });
    gs.syncAll_ = () => {
      synced = true;
      return '';
    };
    gs.quickSyncJob();
    expect(synced).toBe(false);
  });

  it('reads the per-option analysis of a Listening teacher file (no "Giải thích" heading)', () => {
    const gs = load();
    // Paragraphs as read from "L Teacher.docx" (L21): every table cell is its own paragraph.
    const row = (...cells: string[]) => cells;
    const paras = [
      '2. LISTENING',
      '2.1. Đáp án',
      ...row('Câu', 'Đáp án', 'Mức độ', 'Ghi chú'),
      ...row('1', 'A', 'Dễ', 'Câu 1–2: A, C – theo thứ tự bất kỳ'),
      '2.2. Transcript',
      ...row('— Questions 1 and 2 —'),
      ...row('TOM', 'In the city, rent is so high (A).'),
      '2.3. Phân tích từng phương án',
      'Đáp án đúng = phương án mà CẢ HAI người cùng đồng ý (handout L21).',
      'Questions 1–2: Which TWO reasons for moving to the countryside do both students think are the most important? → A, C',
      ...row('Phương án', 'KQ', 'Phân tích', 'Signpost'),
      ...row(
        'A',
        'lower housing costs',
        '✓',
        'Tom: “rent is so high” – Hannah: “I agree with that”.',
        'I agree with that',
      ),
      ...row(
        'B',
        'a healthier environment',
        '✗',
        'Hannah: “I’m not really convinced”.',
        'I’m not really convinced',
      ),
      'Questions 3–4: Which TWO problems of rural life do the students agree to mention? → B, D',
      ...row('Phương án', 'KQ', 'Phân tích', 'Signpost'),
      ...row(
        'B',
        'poor public transport',
        '✓',
        'Tom: “only two or three buses a day”.',
        'Yes, I agree',
      ),
      ...row(
        'D',
        'a lack of job opportunities',
        '✓',
        'Tom đổi ý: “But actually, you’re right”.',
        'But actually…',
      ),
      '2.4. Cụm Agree / Disagree của handout L21 xuất hiện trong bài',
      ...row('Loại', 'Cụm từ xuất hiện trong audio'),
      '2.5. Độ khó và độ phân hoá',
      ...row('Câu', 'Đáp án', 'Mức độ', 'p', 'D', 'Phân hoá', 'Lỗi dự kiến'),
      ...row('1', 'A', 'Dễ', '0.70', '0.30', 'Tốt', 'Không nhận ra paraphrase'),
      ...row('2', 'C', 'Trung bình', '0.58', '0.40', 'Rất tốt', 'Không nhận ra paraphrase'),
    ];
    const ex = gs.parseExplanations_(paras);
    expect(Object.keys(ex).sort()).toEqual(['1', '2', '3', '4']);
    expect(ex[1].text).toContain('Cặp câu 1–2: đáp án A, C (thứ tự bất kỳ)');
    expect(ex[1].text).toContain('A. lower housing costs ✓ — Tom: “rent is so high”');
    expect(ex[2].text).toContain('B. a healthier environment ✗');
    expect(ex[4].text).toContain('D. a lack of job opportunities ✓');
    expect(ex[4].text).not.toContain('Cụm từ xuất hiện'); // stops at the next numbered section
    expect(ex[1]).toMatchObject({ level: 'Dễ', p: '0.70', d: '0.30' });
  });

  it('still prefers a "Giải thích chi tiết" section when there is one', () => {
    const gs = load();
    const ex = gs.parseExplanations_([
      '3. Phân tích từng phương án',
      'Câu 1. Ignored question',
      '4. GIẢI THÍCH CHI TIẾT',
      'Câu 2. Where is the library?',
      'Giải thích: next to the bank.',
    ]);
    expect(Object.keys(ex)).toEqual(['2']);
    expect(ex[2].text).toContain('Giải thích: next to the bank.');
  });

  it("finds Teacher's Book sections under different headings", () => {
    const gs = load();
    const find = (kind: string, ...paras: string[]) => gs.tbSection_(paras, kind);
    expect(find('expl', 'Intro', '3. GIẢI THÍCH CHI TIẾT')).toBe(1);
    expect(find('expl', 'III. Lời giải chi tiết')).toBe(0);
    expect(find('expl', 'Phần 4: Đáp án và giải thích')).toBe(0);
    expect(find('expl', '2.3. Phân tích từng phương án')).toBe(0);
    expect(find('expl', '4.Answer explanations')).toBe(0);
    expect(find('expl', 'Phân tích', 'Đáp án đúng = phương án mà cả hai đồng ý')).toBe(-1);
    // "Giải thích chi tiết" wins over "Phân tích từng phương án" wherever they are.
    expect(find('expl', '2. Phân tích từng phương án', '3. Giải thích chi tiết')).toBe(1);
    expect(find('diff', '2.5. Độ khó và độ phân hoá')).toBe(0);
    expect(find('diff', '5. Mức độ khó')).toBe(0);
    expect(find('scale', '2.6. Thang đánh giá và phân loại lỗi')).toBe(0);
    expect(find('scale', '6. Thang điểm')).toBe(0);
    // A long sentence that only mentions the word is not a heading.
    expect(
      find(
        'expl',
        'Giải thích chi tiết cho từng câu nằm ở cuối tài liệu này, giáo viên xem trước khi chữa bài.',
      ),
    ).toBe(-1);
  });

  it("lists which Teacher's Book sections were found", () => {
    const gs = load();
    const report = gs.teacherBookReport_(
      'L Teacher.docx',
      ['2.1. Đáp án', '2.3. Phân tích từng phương án', '2.6. Thang đánh giá'],
      { 1: 'A' },
    );
    expect(report).toContain('đáp án ✓');
    expect(report).toContain('giải thích ✓ ("2.3. Phân tích từng phương án")');
    expect(report).toContain('độ khó ✗ (cần mục "Độ khó và độ phân hoá")');
    expect(report).toContain('thang đánh giá ✓');
  });

  it('counts only browser errors from the web version that is live now', () => {
    const gs = load();
    const built = '2026-11-07T03:00:00.000Z';
    const E = 'Lỗi trình duyệt';
    const rows = [
      [new Date('2026-11-06T08:05:00Z'), E, 'render #/essays/x: e.errors.map'], // before the fix, no tag
      [new Date('2026-11-07T04:00:00Z'), E, 'render #/a: boom\nBản web: 2026-11-06T14:46:40.004Z'], // old tab
      [new Date('2026-11-07T05:00:00Z'), E, 'render #/b: boom\nBản web: ' + built], // current
      [new Date('2026-11-07T05:30:00Z'), E, 'render #/c: boom'], // after the release, no tag
      [new Date('2026-11-07T05:40:00Z'), 'Chạy tự động', 'ok'],
    ];
    const r = gs.currentClientErrors_(rows, built);
    expect(r.current.map((x: any[]) => x[2].split(':')[0])).toEqual(['render #/b', 'render #/c']);
    expect(r.old).toBe(2);
    // Without version.json every error counts.
    expect(gs.currentClientErrors_(rows, undefined).current).toHaveLength(4);
  });

  it('takes only the letter from answers like "B (climate change)"', () => {
    const gs = load();
    expect(gs.normalizeKeyText_('B (climate change)')).toBe('B');
    expect(gs.normalizeKeyText_('iv (Paragraph C)')).toBe('iv');
    expect(gs.normalizeKeyText_('Hartley (chấp nhận: HARTLEY)')).toBe('Hartley|HARTLEY');
    expect(gs.normalizeKeyText_('(the) river')).toBe('(the) river');
    expect(gs.normalizeKeyText_('two hours / 2 hours')).toBe('two hours|2 hours');
    expect(gs.normalizeKeyText_('week')).toBe('week');
    expect(gs.matchAnswer_('B', gs.normalizeKeyText_('B (climate change)'))).toBe(true);
  });

  it('reads the essay under "TASK 2 Answer" even without the dash (Phong, K230)', () => {
    const gs = load();
    // Paragraphs of "Phong Chu - Writing.docx": the student's line has no dash, the template's
    // "(continued)" line further down still has it.
    const essay = [
      'Nowadays, more and more people choose to work from home and communicate with their',
      'colleagues online instead of going to the office . Although this trend has some disadvantages',
      'I believe that the advantages are greater',
      'In conclusion , although working from home can lead to distractions but i believe its',
      'advantages outweigh its disadvantages because it save time and money and provides greats',
      'flexibility',
    ];
    const w = gs.parseWriting_([
      'WRITING TASK 2',
      'You should spend about 40 minutes on this task.',
      'Nowadays, more and more people work from home. Do the advantages outweigh the disadvantages?',
      'Write at least 250 words.',
      'TASK 2 Answer',
      ...essay,
      'TASK 2 – Answer (continued)',
      'Word count: ............',
    ]);
    expect(w.hasMarkers).toBe(true);
    expect(w.task2Answer).toBe(essay.join('\n'));
    expect(w.task2Prompt).toContain('Do the advantages outweigh');
    for (const mark of ['TASK 2 – Answer', 'Task 2: Answer', 'TASK 2 - Answer', 'TASK2 Answer']) {
      expect(gs.parseWriting_([mark, 'My essay text.']).task2Answer).toBe('My essay text.');
    }
    // Task 1 and Task 2 in one file stay apart.
    const both = gs.parseWriting_([
      'TASK 1 Answer',
      'Chart text.',
      'TASK 2 – Answer',
      'Essay text.',
    ]);
    expect([both.task1Answer, both.task2Answer]).toEqual(['Chart text.', 'Essay text.']);
  });

  it('takes the essay written above the answer line when the answer part is empty (Nhi Thảo, K232)', () => {
    const gs = load();
    const essay =
      'Nowadays, some people think that modern lifestyles are more beneficial for future generations than traditional ways of life. ' +
      'From my point of view, I agree with this statement because new trends help young people develop themselves and build better social connections.';
    const paras = [
      'WRITING TASK 2',
      'You should spend about 40 minutes on this task.',
      'Write about the following topic:',
      'Following new trends, rather than preserving old traditions, will benefit future generations more.To what extent do you agree or disagree?',
      'Give reasons for your answer and include any relevant examples from your own knowledge or experience.',
      'Write at least 250 words.',
      essay,
      'In conclusion, I strongly believe that following new trends is more benefit for future generations.',
      'TASK 2 – Answer',
      'TASK 2 – Answer (continued)',
      'Word count: ............',
    ];
    const w = gs.parseWriting_(paras);
    expect(w.task2Answer).toBe('');
    expect(w.task2Above).toContain('modern lifestyles');
    expect(w.task2Above).toContain('In conclusion');
    // The prompt sent to the AI no longer carries the student's essay.
    expect(w.task2Prompt).toContain('To what extent do you agree or disagree?');
    expect(w.task2Prompt).not.toContain('modern lifestyles');
    // Usual case: nothing between the instructions and the answer line.
    const usual = gs.parseWriting_([
      'WRITING TASK 2',
      'Topic?',
      'Write at least 250 words.',
      'TASK 2 – Answer',
      'Essay.',
    ]);
    expect([usual.task2Prompt, usual.task2Above, usual.task2Answer]).toEqual([
      'Topic?',
      '',
      'Essay.',
    ]);
  });

  it('re-checks Writing skipped as empty once per new version', () => {
    const props = memoryProps();
    const cells: Array<[number, unknown[]]> = [];
    const gs = load({ PropertiesService: props.service });
    const S = gs.__.S;
    const row = (status: string, sent = '') => {
      const r: unknown[] = new Array(40).fill('');
      r[S['Trạng thái chấm']] = status;
      r[S['Đã gửi lúc']] = sent;
      return r;
    };
    const rows = [
      row('Bỏ qua: HS chưa viết Task 2 (phần dưới dòng "TASK 2 – Answer" trống)'),
      row(
        'Lỗi: không thấy dòng "TASK 2 – Answer" trong file Word của HS (có thể đã bị xoá) — cần kiểm tra tay',
      ),
      row('Bỏ qua: HS chưa viết Task 2 (phần dưới dòng "TASK 2 – Answer" trống)', 'sent'),
      row('Đã chấm'),
    ];
    gs.readTable_ = () => ({
      rows,
      sh: { getRange: (i: number) => ({ setValues: (v: unknown[][]) => cells.push([i, v[0]]) }) },
    });
    expect(gs.recheckWritingSkips_()).toBe(
      'Chấm lại 2 bài Writing trước đó không đọc được phần bài làm',
    );
    expect(cells).toEqual([
      [2, ['Chờ chấm', '']],
      [3, ['Chờ chấm', '']],
    ]);
    expect(gs.recheckWritingSkips_()).toBe(''); // once per version
  });

  it('keeps the 8 newest backups of each kind', () => {
    const trashed: string[] = [];
    const file = (name: string, day: number) => ({
      getName: () => name,
      getDateCreated: () => new Date(2026, 0, day),
      setTrashed: () => trashed.push(name),
    });
    const files = [
      ...Array.from({ length: 10 }, (_, i) => file(`Sao lưu ${i} · Lớp học · Sheet`, i + 1)),
      ...Array.from({ length: 9 }, (_, i) => file(`Sao lưu ${i} · Dữ liệu web Writing`, i + 1)),
      file('Ghi chú của thầy', 1),
    ];
    const folder = {
      getFiles: () => {
        let i = 0;
        return { hasNext: () => i < files.length, next: () => files[i++] };
      },
    };
    const gs = load();
    expect(gs.pruneBackups_(folder)).toBe(3);
    expect(trashed.sort()).toEqual([
      'Sao lưu 0 · Dữ liệu web Writing',
      'Sao lưu 0 · Lớp học · Sheet',
      'Sao lưu 1 · Lớp học · Sheet',
    ]);
  });
});
