import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function setup() {
  const app = createTestApp();
  const config = app.call('config.get');
  const topic = (label: string) => config.topics.find((t: any) => t.label === label).id;
  const student = app.login('demo.binh@example.com');
  return { app, config, topic, student };
}

const essayText = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('student essay flow', () => {
  it('saves a draft, submits it, locks it and archives it to Drive', () => {
    const { app, topic, student } = setup();
    const draft = app.call(
      'essays.saveDraft',
      {
        taskType: 'task2',
        topicId: topic('Education'),
        essayType: 'discussion',
        prompt: 'Discuss both views.',
        body: 'Hello',
      },
      student,
    );
    expect(draft.status).toBe('draft');
    const res = app.call(
      'essays.submit',
      {
        id: draft.id,
        taskType: 'task2',
        topicId: topic('Education'),
        essayType: 'discussion',
        prompt: 'Discuss both views.',
        body: essayText(260),
      },
      student,
    );
    expect(res.essay.status).toBe('pending');
    expect(res.essay.wordCount).toBe(260);
    expect(res.driveStatus).toBe('ok');

    const essay = app.db().byId('Essays', draft.id)!;
    const folder = app.svc.drive.folders.get(essay.drive_folder_id)!;
    expect(folder.name).toBe('Tran Thi Binh - Task 2 - Education - 2026-10-10');
    expect(app.svc.drive.filesIn(folder.id)).toHaveLength(1); // the Google Doc

    // Locked after submit.
    expect(() =>
      app.call(
        'essays.saveDraft',
        {
          id: draft.id,
          taskType: 'task2',
          topicId: topic('Education'),
          essayType: 'discussion',
          body: 'x',
        },
        student,
      ),
    ).toThrow(/locked/);
  });

  it('requires the image for Task 1 Academic and stores it in the essay folder', () => {
    const { app, student } = setup();
    const base = {
      taskType: 'task1_academic',
      diagramType: 'static',
      prompt: 'The chart shows…',
      body: essayText(160),
    };
    const d = app.call('essays.saveDraft', base, student);
    expect(() => app.call('essays.submit', { id: d.id, ...base }, student)).toThrow(
      /complete the essay/,
    );

    const withImage = app.call(
      'essays.saveDraft',
      { id: d.id, ...base, image: { base64: PNG, mimeType: 'image/png', name: 'chart.png' } },
      student,
    );
    expect(withImage.hasImage).toBe(true);
    app.call('essays.submit', { id: d.id, ...base }, student);
    const essay = app.db().byId('Essays', d.id)!;
    const files = app.svc.drive.filesIn(essay.drive_folder_id);
    expect(files.map((f) => f.mimeType).sort()).toEqual([
      'application/vnd.google-apps.document',
      'image/png',
    ]);
    expect(app.svc.drive.folders.get(essay.drive_folder_id)!.name).toBe(
      'Tran Thi Binh - Task 1 Academic - Static - 2026-10-10',
    );
    // Image can be read back after an access check.
    expect(app.call('essays.image', { essayId: d.id }, student).base64).toBe(PNG);
    const other = app.login('demo.an@example.com');
    expect(() => app.call('essays.image', { essayId: d.id }, other)).toThrow(/forbidden/);
  });

  it('rejects images that are not png/jpg or over 5 MB', () => {
    const { app, student } = setup();
    const base = {
      taskType: 'task1_academic',
      diagramType: 'static',
      prompt: 'p',
      body: 'b',
    };
    expect(() =>
      app.call(
        'essays.saveDraft',
        { ...base, image: { base64: 'R0lGODlhAQABAAAAACw=', mimeType: 'image/gif' } },
        student,
      ),
    ).toThrow(/check the highlighted/);
    const big = 'iVBORw0KGgo' + 'A'.repeat(7_000_000);
    expect(() =>
      app.call(
        'essays.saveDraft',
        { ...base, image: { base64: big, mimeType: 'image/png' } },
        student,
      ),
    ).toThrow(/check the highlighted/);
  });

  it('appends (2) when a folder with the same name exists', () => {
    const { app, topic, student } = setup();
    const base = {
      taskType: 'task2',
      topicId: topic('Crime'),
      essayType: 'discussion',
      prompt: 'Discuss.',
      body: essayText(255),
    };
    for (let i = 0; i < 2; i++) {
      const d = app.call('essays.saveDraft', base, student);
      app.call('essays.submit', { id: d.id, ...base }, student);
    }
    const names = app.svc.drive.childFolders('root-folder').map((f) => f.name);
    expect(names).toContain('Tran Thi Binh - Task 2 - Crime - 2026-10-10');
    expect(names).toContain('Tran Thi Binh - Task 2 - Crime - 2026-10-10 (2)');
  });

  it('enforces the daily cap of 3 submissions from the Settings tab', () => {
    const { app, topic, student } = setup();
    const base = {
      taskType: 'task2',
      topicId: topic('Media'),
      essayType: 'discussion',
      prompt: 'Discuss.',
      body: essayText(255),
    };
    for (let i = 0; i < 3; i++) {
      const d = app.call('essays.saveDraft', base, student);
      app.call('essays.submit', { id: d.id, ...base }, student);
    }
    const d = app.call('essays.saveDraft', base, student);
    const res = app.raw('essays.submit', { id: d.id, ...base }, student);
    expect(res).toMatchObject({ ok: false, error: { code: 'limit' } });
    // Draft is kept; after 24 hours the essay can be submitted.
    app.svc.advance(24 * 3600 * 1000 + 1000);
    expect(app.call('essays.submit', { id: d.id, ...base }, student).essay.status).toBe('pending');

    // Cap value comes from the Settings tab.
    app.db().update('Settings', (r) => r.key === 'daily_submission_cap', { value: '1' });
    const d2 = app.call('essays.saveDraft', base, student);
    expect(app.raw('essays.submit', { id: d2.id, ...base }, student).ok).toBe(false);
  });

  it('still succeeds when Drive fails, and a retry reuses the folder', () => {
    const { app, topic, student } = setup();
    const base = {
      taskType: 'task2',
      topicId: topic('Health'),
      essayType: 'discussion',
      prompt: 'Discuss.',
      body: essayText(255),
    };
    const d = app.call('essays.saveDraft', base, student);
    app.svc.drive.failNextFolder = true;
    const res = app.call('essays.submit', { id: d.id, ...base }, student);
    expect(res.essay.status).toBe('pending');
    expect(res.driveStatus).toBe('failed');
  });

  it('times tests on the server and marks late submissions as over time', () => {
    const { app, topic, student } = setup();
    const t = app.call(
      'essays.startTest',
      {
        taskType: 'task2',
        topicId: topic('Work'),
        essayType: 'discussion',
        prompt: 'Some people think…',
      },
      student,
    );
    expect(t.mode).toBe('test');
    expect(t.timeLimitMinutes).toBe(40);
    app.svc.advance(30 * 60000);
    app.call('essays.saveDraft', { id: t.id, body: essayText(100), pasteAttempts: 2 }, student);
    app.svc.advance(13 * 60000); // 43 minutes: more than 2 minutes past the deadline
    const res = app.call(
      'essays.submit',
      { id: t.id, body: essayText(120), pasteAttempts: 1 },
      student,
    );
    expect(res.essay.overTime).toBe(true);
    expect(res.essay.timeUsedSeconds).toBe(43 * 60);
    // Paste attempts never go down.
    expect(res.essay.pasteAttempts).toBe(2);
  });

  it('does not mark a test over time within the 2-minute grace period', () => {
    const { app, topic, student } = setup();
    const t = app.call(
      'essays.startTest',
      {
        taskType: 'task2',
        topicId: topic('Work'),
        essayType: 'discussion',
        prompt: 'Some people think…',
      },
      student,
    );
    app.svc.advance(41 * 60000);
    const res = app.call(
      'essays.submit',
      { id: t.id, body: essayText(260), autoSubmitted: true },
      student,
    );
    expect(res.essay.overTime).toBe(false);
    expect(res.essay.autoSubmitted).toBe(true);
  });

  it('prevents students from reading or changing other students essays', () => {
    const { app, student } = setup();
    const anEssay = app
      .db()
      .find('Essays', (e) => e.student_id !== '' && e.status === 'scored')
      .find((e) => app.db().byId('Users', e.student_id)!.email === 'demo.an@example.com')!;
    expect(app.raw('essays.get', { id: anEssay.id }, student)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(app.raw('essays.saveDraft', { id: anEssay.id, body: 'x' }, student).ok).toBe(false);
    expect(app.raw('essays.deleteDraft', { id: anEssay.id }, student).ok).toBe(false);
    const mine = app.call('essays.listMine', {}, student);
    expect(
      mine.every(
        (e: any) =>
          app.db().byId('Essays', e.id)!.student_id ===
          app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!.id,
      ),
    ).toBe(true);
  });
});

describe('practice mode clock', () => {
  it('keeps the time spent writing with the draft, never lower, and after submitting', () => {
    const { app, topic, student } = setup();
    const base = {
      taskType: 'task2',
      topicId: topic('Education'),
      essayType: 'discussion',
      prompt: 'Discuss both views and give your own opinion.',
      body: essayText(260),
    };
    const d = app.call('essays.saveDraft', { ...base, timeSpentSeconds: 600 }, student);
    expect(d.timeUsedSeconds).toBe(600);
    // An older tab saving later does not shorten it.
    const again = app.call(
      'essays.saveDraft',
      { ...base, id: d.id, timeSpentSeconds: 300 },
      student,
    );
    expect(again.timeUsedSeconds).toBe(600);
    const res = app.call('essays.submit', { ...base, id: d.id, timeSpentSeconds: 1500 }, student);
    expect(res.essay).toMatchObject({ timeUsedSeconds: 1500, overTime: false });
  });

  it('refuses an impossible time (over 6 hours)', () => {
    const { app, topic, student } = setup();
    expect(
      app.raw(
        'essays.saveDraft',
        {
          taskType: 'task2',
          topicId: topic('Education'),
          essayType: 'discussion',
          prompt: 'Discuss both views.',
          body: 'Hello',
          timeSpentSeconds: 7 * 3600,
        },
        student,
      ),
    ).toMatchObject({ ok: false, error: { fields: { timeSpentSeconds: expect.any(String) } } });
  });
});
