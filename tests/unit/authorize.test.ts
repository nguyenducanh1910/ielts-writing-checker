import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../../apps-script/src/auth';
import { authorize, can, type Resource } from '../../apps-script/src/authorize';
import type { Row } from '../../apps-script/src/schema';
import { createTestApp } from '../helpers';

function user(id: string, role: 'student' | 'admin'): AuthUser {
  return { id, name: id, email: `${id}@example.com`, role, row: { id } as Row<'Users'> };
}

function essay(studentId: string, status: string): Row<'Essays'> {
  return { id: `essay-${studentId}-${status}`, student_id: studentId, status } as Row<'Essays'>;
}

const alice = user('alice', 'student');
const bob = user('bob', 'student');
const admin = user('admin', 'admin');
const bobScored = essay('bob', 'scored');
const aliceScored = essay('alice', 'scored');
const alicePending = essay('alice', 'pending');
const aliceDraft = essay('alice', 'draft');

describe('authorize(): students', () => {
  it("cannot read another student's essays, scores or errors", () => {
    expect(can('essays.get', alice, { type: 'essay', essay: bobScored })).toBe(false);
    expect(can('essays.get', alice, { type: 'score', essay: bobScored })).toBe(false);
    expect(can('essays.get', alice, { type: 'errors', essay: bobScored })).toBe(false);
    expect(can('essays.get', alice, { type: 'rewrite', essay: bobScored })).toBe(false);
    expect(can('essays.image', alice, { type: 'image', essay: bobScored })).toBe(false);
    expect(can('dashboard.get', alice, { type: 'score', essay: bobScored })).toBe(false);
  });

  it('can read their own essays, and their scores only once scored', () => {
    expect(can('essays.get', alice, { type: 'essay', essay: aliceScored })).toBe(true);
    expect(can('essays.get', alice, { type: 'score', essay: aliceScored })).toBe(true);
    expect(can('essays.get', alice, { type: 'errors', essay: aliceScored })).toBe(true);
    expect(can('essays.get', alice, { type: 'score', essay: alicePending })).toBe(false);
    expect(can('essays.get', alice, { type: 'errors', essay: alicePending })).toBe(false);
  });

  it('cannot read any Claude drafts or source feedback, including their own', () => {
    for (const type of ['draft', 'source_feedback', 'calibration_sample', 'email_event'] as const) {
      const r: Resource = { type };
      expect(can('essays.get', alice, r)).toBe(false);
      expect(can('admin.essay', alice, r)).toBe(false);
    }
    expect(can('admin.saveClaudeDraft', alice)).toBe(false);
    expect(can('admin.saveSourceFeedback', alice)).toBe(false);
    expect(can('admin.essay', alice)).toBe(false);
  });

  it('cannot score anything', () => {
    expect(can('admin.saveScore', alice)).toBe(false);
    expect(can('admin.saveScore', alice, { type: 'score', essay: aliceScored })).toBe(false);
    expect(can('admin.resendEmail', alice)).toBe(false);
    expect(can('admin.queue', alice)).toBe(false);
  });

  it('can edit or delete only their own drafts', () => {
    expect(can('essays.saveDraft', alice, { type: 'essay', essay: aliceDraft })).toBe(true);
    expect(can('essays.deleteDraft', alice, { type: 'essay', essay: aliceDraft })).toBe(true);
    expect(can('essays.saveDraft', alice, { type: 'essay', essay: alicePending })).toBe(false);
    expect(can('essays.deleteDraft', alice, { type: 'essay', essay: aliceScored })).toBe(false);
    expect(can('essays.saveDraft', alice, { type: 'essay', essay: essay('bob', 'draft') })).toBe(
      false,
    );
  });

  it('can only change their own account', () => {
    expect(can('me.update', alice, { type: 'user', userId: 'alice' })).toBe(true);
    expect(can('me.update', alice, { type: 'user', userId: 'bob' })).toBe(false);
  });

  it('cannot call unknown or admin actions', () => {
    expect(can('admin.students', bob)).toBe(false);
    expect(can('something.else', bob)).toBe(false);
  });

  it('requires a session for non-public actions', () => {
    expect(() => authorize('essays.listMine', null)).toThrow(/log in/);
    expect(can('auth.requestLink', null)).toBe(true);
    expect(can('config.get', null)).toBe(true);
  });
});

describe('authorize(): admin', () => {
  it('can do everything', () => {
    expect(can('admin.saveScore', admin)).toBe(true);
    expect(can('admin.essay', admin, { type: 'draft' })).toBe(true);
    expect(can('essays.get', admin, { type: 'essay', essay: bobScored })).toBe(true);
    expect(can('essays.get', admin, { type: 'score', essay: alicePending })).toBe(true);
  });
});

describe('access control through the API with a real student session', () => {
  it('blocks every admin action and other students data', () => {
    const app = createTestApp();
    const an = app.login('demo.an@example.com');
    const binh = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    const binhEssays = app.db().find('Essays', (e) => e.student_id === binh.id);
    const binhScored = binhEssays.find((e) => e.status === 'scored')!;

    for (const e of binhEssays) {
      expect(app.raw('essays.get', { id: e.id }, an)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
      expect(app.raw('essays.image', { essayId: e.id }, an).ok).toBe(false);
    }
    const adminActions = [
      ['admin.queue', {}],
      ['admin.essay', { id: binhScored.id }],
      ['admin.essayImage', { essayId: binhScored.id }],
      [
        'admin.saveScore',
        {
          essayId: binhScored.id,
          scores: { task: 9, coherence: 9, lexical: 9, grammar: 9 },
          topicId: binhScored.topic_id,
          submit: true,
        },
      ],
      ['admin.saveClaudeDraft', { essayId: binhScored.id, rawText: '{}' }],
      ['admin.saveSourceFeedback', { essayId: binhScored.id, sourceId: 'x' }],
      ['admin.studentOverview', { studentId: binh.id }],
      ['admin.students', {}],
      ['admin.calibration', {}],
      ['admin.claudeSetup', {}],
      ['admin.emails', {}],
      ['admin.lists', {}],
      ['admin.assignments.list', {}],
    ] as const;
    for (const [action, payload] of adminActions) {
      expect(app.raw(action, payload, an)).toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }

    // Their own essay view never contains drafts or source feedback.
    const mine = app.call('essays.listMine', {}, an);
    for (const e of mine) {
      const text = JSON.stringify(app.call('essays.get', { id: e.id }, an));
      expect(text).not.toMatch(
        /AI4IELTS|Wispace|Demo feedback|claudeDraft|sourceFeedback|raw_text/,
      );
    }
    // Their dashboard only contains their own essays.
    const dash = app.call('dashboard.get', {}, an);
    const anId = app.db().findOne('Users', (u) => u.email === 'demo.an@example.com')!.id;
    for (const p of dash.bandOverTime)
      expect(app.db().byId('Essays', p.essayId)!.student_id).toBe(anId);
  });

  it('a forged or expired session token gets nothing', () => {
    const app = createTestApp();
    expect(app.raw('essays.listMine', {}, 'f'.repeat(64))).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated' },
    });
    const token = app.login('demo.an@example.com');
    app.svc.advance(31 * 86400000);
    expect(app.raw('essays.listMine', {}, token)).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated' },
    });
  });

  it('delete my account removes rows from every tab and trashes Drive folders', () => {
    const app = createTestApp();
    const an = app.login('demo.an@example.com');
    const anId = app.db().findOne('Users', (u) => u.email === 'demo.an@example.com')!.id;
    const folders = app
      .db()
      .find('Essays', (e) => e.student_id === anId)
      .map((e) => e.drive_folder_id)
      .filter(Boolean);
    expect(folders.length).toBeGreaterThan(0);
    app.call('me.delete', { confirm: 'DELETE' }, an);
    const db = app.db();
    expect(db.byId('Users', anId)).toBeUndefined();
    expect(db.find('Essays', (e) => e.student_id === anId)).toHaveLength(0);
    expect(db.find('ErrorLog', (e) => e.student_id === anId)).toHaveLength(0);
    expect(db.find('Sessions', (s) => s.user_id === anId)).toHaveLength(0);
    expect(db.all('RewriteRequests')).toHaveLength(0);
    for (const f of folders) expect(app.svc.drive.folders.get(f)!.trashed).toBe(true);
    expect(app.raw('me.get', {}, an).ok).toBe(false);
  });
});
