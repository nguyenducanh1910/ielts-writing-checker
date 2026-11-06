// Pure helpers for scripts/deploy-gas.mjs (kept separate so the unit tests can import them
// without running a deployment).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendVersion } from './backend-version.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');

/**
 * The two Apps Script projects. The deployment ID is the part of the public web-app URL between
 * /s/ and /exec, so the URL the site uses never changes: each deploy moves that same deployment
 * to a new version.
 */
export const TARGETS = {
  writing: {
    label: 'Writing (IELTS Writing Checker)',
    scriptId: '1WwkKkVMPkn6cltPxm0aQYpgcDFZSR23YaV8LE1d7-v5T6zocABwsM752',
    deploymentId: 'AKfycbzqAmX3yzhlRbtwwAjB9C-JUCRha1ZpEiO0ACOFFVg7i4S-ZsbcWKDeDytbgpU_Evw6',
    /** Files pushed, relative to the repo root (run `npm run gas:build` first). */
    files: ['apps-script/dist/Code.js', 'apps-script/dist/appsscript.json'],
    expectedVersion: () => backendVersion(),
  },
  classroom: {
    label: 'Lớp học (Google Sheet)',
    scriptId: '1z2R4R3ahPW1DxyOcQQdtsG3Goo8ilXG7vhR4aJatzaaBKbmjRvlggf9T',
    deploymentId: 'AKfycbwdOQ4KVzLyksvM6-e5UxUWR_tThL4Jl8l36jx0GjYnRzGdeMFyzX6CdNJOOnn1QaRC',
    files: ['classroom/Code.gs', 'classroom/appsscript.json'],
    expectedVersion: () => classroomVersion(readFileSync(join(root, 'classroom/Code.gs'), 'utf8')),
  },
};

export function webAppUrl(deploymentId) {
  return `https://script.google.com/macros/s/${deploymentId}/exec`;
}

/** The version string declared in classroom/Code.gs (`const CLASSROOM_VERSION = '…';`). */
export function classroomVersion(source) {
  const m = /const CLASSROOM_VERSION = '([^']+)'/.exec(source);
  if (!m) throw new Error('CLASSROOM_VERSION not found in classroom/Code.gs');
  return m[1];
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

/**
 * Whether two appsscript.json manifests mean the same thing (key order and spacing ignored,
 * the order of OAuth scopes ignored). A different manifest can change the permissions the
 * project asks for, which stops the triggers until the owner approves again, so the deploy
 * refuses to change it unless asked to.
 */
export function sameManifest(a, b) {
  const norm = (text) => {
    const m = sortKeys(JSON.parse(text));
    if (Array.isArray(m.oauthScopes)) m.oauthScopes = [...m.oauthScopes].sort();
    return JSON.stringify(m);
  };
  return norm(a) === norm(b);
}

/** Code files compared by content only: file names may differ (the editor's "Mã" vs "Code"). */
export function sameCode(localSources, remoteSources) {
  const norm = (list) => list.map((s) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '')).sort();
  const a = norm(localSources);
  const b = norm(remoteSources);
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Pulls the version a web app reports out of its JSON answer. */
export function reportedVersion(target, body) {
  const data = body && typeof body === 'object' ? body.data : undefined;
  if (!data) return undefined;
  return target === 'writing' ? data.serverVersion : data.version;
}
