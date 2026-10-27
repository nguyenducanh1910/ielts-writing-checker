import { describe, expect, it } from 'vitest';
import { createCtx } from '../../apps-script/src/context';
import { SCHEMA, TABLE_NAMES } from '../../apps-script/src/schema';
import { runSetup } from '../../apps-script/src/setup';
import { createMemoryServices } from '../../apps-script/testing/memory';

describe('setup()', () => {
  it('creates every tab with headers and seeds data', () => {
    const svc = createMemoryServices();
    const result = runSetup(svc);
    expect(result.createdTabs).toEqual(TABLE_NAMES);
    for (const name of TABLE_NAMES) {
      const sheet = svc.spreadsheet.getSheetByName(name)!;
      expect(sheet.getRange(1, 1, 1, SCHEMA[name].length).getValues()[0]).toEqual([
        ...SCHEMA[name],
      ]);
    }
    const { db } = createCtx(svc);
    expect(db.all('Classes').map((c) => c.label)).toEqual([
      'IELTS 4',
      'IELTS 5',
      'IELTS 7',
      'IELTS 8',
      'IELTS Buddy',
    ]);
    expect(db.all('Topics').length).toBeGreaterThanOrEqual(15);
    expect(db.all('ErrorCategories').length).toBeGreaterThanOrEqual(40);
    expect(db.all('FeedbackSources').map((s) => s.name)).toEqual([
      'Claude',
      'AI4IELTS',
      'Wispace',
      'Perplexity',
    ]);
    const users = db.all('Users');
    expect(users.find((u) => u.email === 'admin@example.com')?.role).toBe('admin');
    expect(users.filter((u) => u.role === 'student')).toHaveLength(2);
    expect(db.all('Scores').length).toBeGreaterThan(0);
    expect(db.all('RewriteRequests')).toHaveLength(1);
    // Submitted demo essays were archived to Drive.
    const submitted = db.all('Essays').filter((e) => e.status !== 'draft');
    expect(submitted.every((e) => e.drive_sync_status === 'ok')).toBe(true);
  });

  it('is idempotent', () => {
    const svc = createMemoryServices();
    runSetup(svc);
    const again = runSetup(svc);
    expect(again.createdTabs).toEqual([]);
    expect(again.seeded).toEqual([]);
    expect(createCtx(svc).db.all('Users')).toHaveLength(3);
  });
});
