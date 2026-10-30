import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers';

function prepare() {
  const app = createTestApp();
  const admin = app.login('admin@example.com');
  const classId = (label: string) => app.db().findOne('Classes', (c) => c.label === label)!.id;
  const binh = () => app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
  return { app, admin, classId, binh };
}

describe('the teacher changes a student’s class', () => {
  it('moves the student to another class and shows it on the student page', () => {
    const { app, admin, classId, binh } = prepare();
    expect(binh().class).toBe(classId('IELTS 7'));
    const res = app.call(
      'admin.students.setClass',
      { studentId: binh().id, classId: classId('IELTS 8') },
      admin,
    );
    expect(res).toEqual({ classId: classId('IELTS 8'), className: 'IELTS 8' });
    expect(binh().class).toBe(classId('IELTS 8'));
    const overview = app.call('admin.studentOverview', { studentId: binh().id }, admin);
    expect(overview.student).toMatchObject({ classId: classId('IELTS 8'), className: 'IELTS 8' });
    expect(overview.classes.map((c: any) => c.label)).toContain('IELTS 4');
  });

  it('can remove the student from their class', () => {
    const { app, admin, binh } = prepare();
    const res = app.call('admin.students.setClass', { studentId: binh().id, classId: '' }, admin);
    expect(res).toEqual({ classId: '', className: '' });
    expect(binh().class).toBe('');
  });

  it('keeps an inactive current class but does not move anyone new into one', () => {
    const { app, admin, classId, binh } = prepare();
    const deactivate = (label: string) =>
      app.call('admin.classes.save', { id: classId(label), label, active: false }, admin);
    deactivate('IELTS 7');
    deactivate('IELTS 4');
    // The student's current, now inactive class is still listed and can be saved again.
    const overview = app.call('admin.studentOverview', { studentId: binh().id }, admin);
    expect(overview.classes.find((c: any) => c.label === 'IELTS 7')).toMatchObject({
      active: false,
    });
    expect(overview.classes.map((c: any) => c.label)).not.toContain('IELTS 4');
    expect(
      app.raw(
        'admin.students.setClass',
        { studentId: binh().id, classId: classId('IELTS 7') },
        admin,
      ).ok,
    ).toBe(true);
    const moveToInactive = app.raw(
      'admin.students.setClass',
      { studentId: binh().id, classId: classId('IELTS 4') },
      admin,
    );
    expect(moveToInactive).toMatchObject({ ok: false, error: { code: 'bad_request' } });
  });

  it('refuses unknown classes, admins and students', () => {
    const { app, admin, classId, binh } = prepare();
    const unknown = app.raw(
      'admin.students.setClass',
      { studentId: binh().id, classId: '00000000-0000-4000-8000-000000000000' },
      admin,
    );
    expect(unknown).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    const adminRow = app.db().findOne('Users', (u) => u.role === 'admin')!;
    expect(
      app.raw('admin.students.setClass', { studentId: adminRow.id, classId: '' }, admin),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const student = app.login('demo.an@example.com');
    expect(
      app.raw(
        'admin.students.setClass',
        { studentId: binh().id, classId: classId('IELTS 8') },
        student,
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
