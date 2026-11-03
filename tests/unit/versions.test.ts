import { describe, expect, it } from 'vitest';
import { backendVersion } from '../../scripts/backend-version.mjs';
import { versionMismatch } from '../../src/versions';

describe('versions', () => {
  it('back-end version is a stable 10-character hash', () => {
    const v = backendVersion();
    expect(v).toMatch(/^[0-9a-f]{10}$/);
    expect(backendVersion()).toBe(v);
  });
  it('warns only when both sides are known and differ', () => {
    expect(versionMismatch('abc', 'abc')).toBe(false);
    expect(versionMismatch('abc', 'old')).toBe(true);
    expect(versionMismatch('dev', 'old')).toBe(false);
    expect(versionMismatch('abc', 'dev')).toBe(false);
    expect(versionMismatch('abc', undefined)).toBe(true);
  });
});
