import { describe, expect, it } from 'vitest';
import { Db, fromCell, toCell } from '../../apps-script/src/db';
import { runSetup } from '../../apps-script/src/setup';
import { createMemoryServices } from '../../apps-script/testing/memory';
import { createTestApp } from '../helpers';

describe('formula-safe cells', () => {
  it('prefixes values Sheets would run as formulas', () => {
    expect(toCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(toCell('+1')).toBe("'+1");
    expect(toCell('-cmd')).toBe("'-cmd");
    expect(toCell('@me')).toBe("'@me");
    expect(toCell('Normal text')).toBe('Normal text');
    expect(toCell(6.5)).toBe('6.5');
    expect(toCell(null)).toBe('');
  });

  it('reads values back unchanged', () => {
    expect(fromCell("'=1+1")).toBe('=1+1');
    expect(fromCell("'quoted")).toBe("'quoted");
    expect(fromCell(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
  });

  it('stores an essay starting with "=" as text, not a formula', () => {
    const svc = createMemoryServices();
    runSetup(svc, { demo: false });
    const db = new Db(svc.spreadsheet);
    db.insert('Drafts', { id: 'd1', essay_id: 'e1', kind: 'initial', raw_text: '=IMPORTXML("x")' });
    expect(svc.spreadsheet.formulaCount()).toBe(0);
    const fresh = new Db(svc.spreadsheet);
    expect(fresh.byId('Drafts', 'd1')?.raw_text).toBe('=IMPORTXML("x")');
    fresh.update('Drafts', (r) => r.id === 'd1', { raw_text: '@SUM(1)' });
    expect(svc.spreadsheet.formulaCount()).toBe(0);
    expect(new Db(svc.spreadsheet).byId('Drafts', 'd1')?.raw_text).toBe('@SUM(1)');
  });

  it('updates and removes rows', () => {
    const svc = createMemoryServices();
    runSetup(svc, { demo: false });
    const db = new Db(svc.spreadsheet);
    db.insert('Topics', { id: 'a', label: 'A', active: true });
    db.insert('Topics', { id: 'b', label: 'B', active: true });
    expect(db.update('Topics', (r) => r.id === 'a', { label: 'A2' })).toBe(1);
    expect(db.remove('Topics', (r) => r.id === 'b')).toBe(1);
    const fresh = new Db(svc.spreadsheet);
    expect(fresh.byId('Topics', 'a')?.label).toBe('A2');
    expect(fresh.byId('Topics', 'b')).toBeUndefined();
  });
});

describe('values survive a Vietnamese-locale Sheet', () => {
  it('the mock really converts unformatted "6.5" into a date (so the test below means something)', () => {
    const svc = createMemoryServices();
    const sheet = svc.spreadsheet.insertSheet('Raw');
    sheet.getRange(1, 1, 1, 2).setValues([['6.5', '2026-10-15']]);
    const [band, date] = sheet.getRange(1, 1, 1, 2).getValues()[0];
    expect(band).toBeInstanceOf(Date);
    expect(date).toBeInstanceOf(Date);
  });

  it('stores decimals, dates and booleans as text, even past the formatted rows', () => {
    const svc = createMemoryServices();
    runSetup(svc, { demo: false });
    const users = svc.spreadsheet.getSheetByName('Users')!;
    // Pretend the tab is small and unformatted below the header, like a hand-made tab.
    users.maxRows = 3;
    users.textFormat = [users.textFormat[0]];
    const db = new Db(svc.spreadsheet);
    for (let i = 0; i < 5; i++) {
      db.insert('Users', {
        id: `u${i}`,
        name: 'N',
        email: `u${i}@x.com`,
        target_band: '6.5',
        exam_date: '2026-10-15',
        consent_at: '2026-10-10T03:00:00.000Z',
      });
    }
    db.update('Users', (u) => u.id === 'u1', { target_band: '7.5' });
    const fresh = new Db(svc.spreadsheet);
    expect(fresh.byId('Users', 'u0')).toMatchObject({
      target_band: '6.5',
      exam_date: '2026-10-15',
      consent_at: '2026-10-10T03:00:00.000Z',
    });
    expect(fresh.byId('Users', 'u1')!.target_band).toBe('7.5');
    expect(fresh.byId('Users', 'u4')!.target_band).toBe('6.5');
    expect(users.getMaxRows()).toBeGreaterThan(3);
  });

  it('demo scores read back with their decimals', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const students = app.call('admin.students', {}, admin);
    const an = students.find((s: any) => s.name === 'Nguyen Van An');
    const binh = students.find((s: any) => s.name === 'Tran Thi Binh');
    expect(an).toMatchObject({ averageBand: 5.8, targetBand: 6.5 });
    expect(binh).toMatchObject({ averageBand: 6.5, targetBand: 7 });
  });
});
