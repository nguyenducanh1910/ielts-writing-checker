import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { runSetup } from '../../apps-script/src/setup';
import { createMemoryServices } from '../../apps-script/testing/memory';
import { docxToText, documentXmlToText } from '../../src/ui/docx';
import { createTestApp } from '../helpers';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const BODY = 'Paper essay about cities. '.repeat(60);

function setup() {
  const app = createTestApp();
  const admin = app.login('admin@example.com');
  const config = app.call('config.get');
  const topic = (label: string) => config.topics.find((t: any) => t.label === label).id;
  return { app, admin, config, topic };
}

describe('admin adds an essay', () => {
  it('adds an essay for an existing student into the normal queue and Drive', () => {
    const { app, admin, topic } = setup();
    const binh = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    const res = app.call(
      'admin.essays.create',
      {
        studentId: binh.id,
        taskType: 'task2',
        topicId: topic('Transport'),
        essayType: 'discussion',
        prompt: 'Discuss public transport.',
        body: BODY,
        testDate: '2026-10-01',
      },
      admin,
    );
    expect(res.driveStatus).toBe('ok');
    const essay = app.db().byId('Essays', res.essayId)!;
    expect(essay).toMatchObject({
      student_id: binh.id,
      status: 'pending',
      source: 'admin',
      test_date: '2026-10-01',
      word_count: '240',
    });
    expect(app.svc.drive.folders.get(essay.drive_folder_id)!.name).toBe(
      'Tran Thi Binh - Task 2 - Transport - 2026-10-10',
    );
    const item = app.call('admin.queue', {}, admin).items.find((i: any) => i.id === res.essayId);
    expect(item).toMatchObject({ uploadedByAdmin: true, studentName: 'Tran Thi Binh' });
    // The student sees it in their own list.
    const student = app.login('demo.binh@example.com');
    expect(app.call('essays.listMine', {}, student).some((e: any) => e.id === res.essayId)).toBe(
      true,
    );
  });

  it('does not count toward the student’s daily cap', () => {
    const { app, admin, topic } = setup();
    const binh = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    for (let i = 0; i < 4; i++) {
      app.call(
        'admin.essays.create',
        {
          studentId: binh.id,
          taskType: 'task2',
          topicId: topic('Media'),
          essayType: 'discussion',
          prompt: 'Discuss the media.',
          body: BODY,
        },
        admin,
      );
    }
    const student = app.login('demo.binh@example.com');
    const base = {
      taskType: 'task2',
      topicId: topic('Media'),
      essayType: 'discussion',
      prompt: 'Discuss.',
      body: BODY,
    };
    const d = app.call('essays.saveDraft', base, student);
    expect(app.call('essays.submit', { id: d.id, ...base }, student).essay.status).toBe('pending');
  });

  it('creates a new student without an email and scores without sending email', () => {
    const { app, admin, config } = setup();
    const res = app.call(
      'admin.essays.create',
      {
        newStudent: { name: 'Le Van Paper', classId: config.classes[0].id },
        taskType: 'task1_academic',
        diagramType: 'static',
        prompt: 'The chart shows recycling rates.',
        body: BODY,
        image: { base64: PNG, mimeType: 'image/png', name: 'chart.png' },
      },
      admin,
    );
    const user = app.db().byId('Users', res.studentId)!;
    expect(user).toMatchObject({
      name: 'Le Van Paper',
      email: '',
      role: 'student',
      consent_at: '',
    });
    const essay = app.db().byId('Essays', res.essayId)!;
    expect(
      app.svc.drive.filesIn(essay.drive_folder_id).some((f) => f.mimeType === 'image/png'),
    ).toBe(true);

    const before = app.svc.mail.outbox.length;
    const scored = app.call(
      'admin.saveScore',
      {
        essayId: res.essayId,
        scores: { task: 6, coherence: 6, lexical: 6, grammar: 6 },
        topicId: essay.topic_id,
        errors: [],
        submit: true,
      },
      admin,
    );
    expect(scored.email).toBe('no_email');
    expect(app.svc.mail.outbox.length).toBe(before);
    expect(app.db().find('EmailEvents', (e) => e.essay_id === res.essayId)).toHaveLength(0);
    // Requesting a login link with an empty email never matches this student.
    expect(app.raw('auth.requestLink', { email: '' }).ok).toBe(false);
  });

  it('validates the request and stays admin-only', () => {
    const { app, admin, topic } = setup();
    const res = app.raw(
      'admin.essays.create',
      { taskType: 'task1_academic', diagramType: 'static', prompt: 'short', body: '' },
      admin,
    );
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(Object.keys(res.error.fields!)).toEqual(
        expect.arrayContaining(['studentId', 'prompt', 'body', 'image']),
      );
    const dup = app.raw(
      'admin.essays.create',
      {
        newStudent: { name: 'Copy', email: 'demo.an@example.com' },
        taskType: 'task2',
        topicId: topic('Health'),
        essayType: 'discussion',
        prompt: 'Discuss health.',
        body: BODY,
      },
      admin,
    );
    expect(dup).toMatchObject({
      ok: false,
      error: { fields: { 'newStudent.email': expect.stringContaining('already exists') } },
    });
    const student = app.login('demo.an@example.com');
    const anId = app.db().findOne('Users', (u) => u.email === 'demo.an@example.com')!.id;
    expect(
      app.raw(
        'admin.essays.create',
        {
          studentId: anId,
          taskType: 'task2',
          topicId: topic('Health'),
          essayType: 'discussion',
          prompt: 'Discuss health.',
          body: BODY,
        },
        student,
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('setup() upgrades an existing Sheet', () => {
  it('adds new columns to existing tabs without touching the data', () => {
    const svc = createMemoryServices();
    runSetup(svc);
    const sheet = svc.spreadsheet.getSheetByName('Essays')!;
    // Simulate a Sheet created before the "source" column existed.
    const width = sheet.getLastColumn();
    const header = sheet.getRange(1, 1, 1, width).getValues()[0] as string[];
    const col = header.indexOf('source');
    for (const row of sheet.cells) row.splice(col, 1);
    const result = runSetup(svc);
    expect(result.addedColumns).toEqual(['Essays.source']);
    expect(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]).toContain('source');
    expect(runSetup(svc).addedColumns).toEqual([]);
  });
});

/** Minimal ZIP writer (deflate) to build a .docx fixture. */
function zip(files: Record<string, string>): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, cdBuf, end]));
}

describe('.docx essay import', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
    <w:p><w:r><w:t>Nowadays, many people </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>believe</w:t></w:r><w:r><w:t xml:space="preserve"> that cities &amp; towns…</w:t></w:r></w:p>
    <w:p/>
    <w:p><w:r><w:t>Second paragraph.</w:t><w:br/><w:t>Same paragraph, new line.</w:t></w:r></w:p>
    <w:p><w:r><w:del><w:t>deleted</w:t></w:del><w:t>Café “quotes”</w:t></w:r></w:p>
  </w:body></w:document>`;

  it('turns paragraphs into text separated by blank lines', () => {
    expect(documentXmlToText(xml)).toBe(
      'Nowadays, many people believe that cities & towns…\n\nSecond paragraph.\nSame paragraph, new line.\n\nCafé “quotes”',
    );
  });

  it('reads word/document.xml out of a .docx archive', async () => {
    const file = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': xml });
    const text = await docxToText(file);
    expect(text.startsWith('Nowadays, many people believe')).toBe(true);
  });

  it('rejects files that are not .docx', async () => {
    await expect(docxToText(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/not a valid .docx/);
  });
});
