// Version of the Apps Script back end: a short hash of its source (apps-script/src and shared).
// The back-end bundle and the front end both compute it at build time, so the site can tell
// when the deployed web app is older than the code on GitHub (a deployment left on an old version).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

function files(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(name) ? [p] : [];
    })
    .sort();
}

/** 10 hex characters, the same on every machine (paths are relative, line endings normalized). */
export function backendVersion() {
  const hash = createHash('sha256');
  for (const dir of ['apps-script/src', 'shared']) {
    for (const f of files(join(root, dir))) {
      hash.update(relative(root, f).replace(/\\/g, '/'));
      hash.update('\0');
      hash.update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
      hash.update('\0');
    }
  }
  return hash.digest('hex').slice(0, 10);
}
