// Tests for the automatic Apps Script deploy (scripts/deploy-gas.mjs and its helpers).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classroomVersion,
  reportedVersion,
  sameCode,
  sameManifest,
  TARGETS,
  webAppUrl,
} from '../../scripts/gas-deploy-lib.mjs';
import { CLASSROOM_VERSION } from '../../src/versions';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const env = read('.env.production');

describe('automatic Apps Script deploy', () => {
  it('updates the same web apps the site talks to', () => {
    expect(env).toContain(webAppUrl(TARGETS.writing.deploymentId));
    expect(env).toContain(webAppUrl(TARGETS.classroom.deploymentId));
  });

  it('reads the class system version from Code.gs', () => {
    expect(classroomVersion(read('classroom/Code.gs'))).toBe(CLASSROOM_VERSION);
    expect(() => classroomVersion('no version here')).toThrow();
  });

  it('keeps both projects published as public web apps run as the teacher', () => {
    for (const p of ['apps-script/appsscript.json', 'classroom/appsscript.json']) {
      expect(JSON.parse(read(p)).webapp).toEqual({
        executeAs: 'USER_DEPLOYING',
        access: 'ANYONE_ANONYMOUS',
      });
    }
  });

  it('treats manifests that differ only in layout as the same', () => {
    const a = '{"timeZone":"Asia/Ho_Chi_Minh","oauthScopes":["b","a"],"webapp":{"access":"X"}}';
    const b =
      '{\n  "webapp": { "access": "X" },\n  "oauthScopes": ["a", "b"],\n  "timeZone": "Asia/Ho_Chi_Minh"\n}';
    expect(sameManifest(a, b)).toBe(true);
    expect(sameManifest(a, a.replace('"a"]', '"a","c"]'))).toBe(false);
    expect(sameManifest(a, a.replace(',"webapp":{"access":"X"}', ''))).toBe(false);
  });

  it('compares code by content, not file name', () => {
    expect(sameCode(['function a() {}\n'], ['function a() {}'])).toBe(true);
    expect(sameCode(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameCode(['a'], ['a', 'b'])).toBe(false);
    expect(sameCode(['a'], ['A'])).toBe(false);
  });

  it('reads the version each web app reports', () => {
    expect(reportedVersion('writing', { ok: true, data: { serverVersion: 'abc' } })).toBe('abc');
    expect(reportedVersion('classroom', { ok: true, data: { version: '2026-11-07.1' } })).toBe(
      '2026-11-07.1',
    );
    expect(reportedVersion('writing', { ok: false, error: 'x' })).toBeUndefined();
  });
});
