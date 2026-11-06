// Deploys the Apps Script back ends with clasp (used by .github/workflows/deploy-gas.yml).
//
//   node scripts/deploy-gas.mjs <writing|classroom|both> [--dry-run] [--allow-manifest-change] [--force]
//
// For each project it:
//   1. pulls what is live now into .gas-deploy/<target>/remote (kept as a backup artifact),
//   2. stops if the live appsscript.json differs from the repo's (a manifest change can ask for
//      new permissions and stop the triggers) unless --allow-manifest-change,
//   3. skips the project when the live code already matches the repo (no new version is made;
//      Apps Script keeps at most 200 versions) unless --force,
//   4. pushes, then moves the existing web-app deployment to a new version (the URL stays),
//   5. asks the web app for its version until it reports the new one.
// Needs `clasp` (@google/clasp 3) on PATH and ~/.clasprc.json from `clasp login`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportedVersion, sameCode, sameManifest, TARGETS, webAppUrl } from './gas-deploy-lib.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--')) ?? 'both';
const dryRun = args.includes('--dry-run');
const allowManifest = args.includes('--allow-manifest-change');
const force = args.includes('--force');

function clasp(cwd, ...cmd) {
  return execFileSync(process.env.CLASP_BIN || 'clasp', cmd, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function codeFiles(dir) {
  return readdirSync(dir)
    .filter((f) => /\.(gs|js)$/.test(f))
    .map((f) => readFileSync(join(dir, f), 'utf8'));
}

async function liveVersion(name, target) {
  const url = webAppUrl(target.deploymentId);
  const res =
    name === 'writing'
      ? await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'config.get', payload: {} }),
        })
      : await fetch(url);
  return reportedVersion(name, await res.json());
}

async function waitForVersion(name, target, expected) {
  let last;
  for (let i = 0; i < 12; i++) {
    try {
      last = await liveVersion(name, target);
      if (last === expected) return;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`${target.label}: web app reports ${last}, expected ${expected}`);
}

async function deploy(name) {
  const target = TARGETS[name];
  const expected = target.expectedVersion();
  const work = join(root, '.gas-deploy', name);
  rmSync(work, { recursive: true, force: true });

  // 1. What is live now (also the backup).
  const remote = join(work, 'remote');
  mkdirSync(remote, { recursive: true });
  writeFileSync(join(remote, '.clasp.json'), JSON.stringify({ scriptId: target.scriptId }));
  clasp(remote, 'pull');

  // The repo files, staged on their own so nothing else in the folder is pushed.
  const local = join(work, 'local');
  mkdirSync(join(local, 'src'), { recursive: true });
  for (const f of target.files) copyFileSync(join(root, f), join(local, 'src', basename(f)));
  writeFileSync(
    join(local, '.clasp.json'),
    JSON.stringify({ scriptId: target.scriptId, rootDir: 'src' }),
  );

  // 2. Manifest guard.
  const liveManifest = readFileSync(join(remote, 'appsscript.json'), 'utf8');
  const repoManifest = readFileSync(join(local, 'src', 'appsscript.json'), 'utf8');
  if (!sameManifest(liveManifest, repoManifest) && !allowManifest) {
    throw new Error(
      `${target.label}: appsscript.json in the repo differs from the live project. ` +
        'Check the scopes, then run the workflow by hand with "allow_manifest_change".',
    );
  }

  // 3. Nothing to do?
  if (!force && sameCode(codeFiles(join(local, 'src')), codeFiles(remote))) {
    console.log(`${target.label}: already up to date (${expected}).`);
    return;
  }
  if (dryRun) {
    console.log(`${target.label}: would push and deploy ${expected} (dry run).`);
    return;
  }

  // 4. Push and move the deployment to a new version.
  clasp(local, 'push', '--force');
  const out = clasp(
    local,
    'update-deployment',
    target.deploymentId,
    '--description',
    `${expected} (GitHub ${(process.env.GITHUB_SHA || 'local').slice(0, 7)})`,
    '--json',
  );
  console.log(`${target.label}: deployed`, out.trim());

  // 5. Confirm.
  await waitForVersion(name, target, expected);
  console.log(`${target.label}: web app now reports ${expected}.`);
}

const names = which === 'both' ? ['writing', 'classroom'] : [which];
if (!names.every((n) => n in TARGETS)) {
  console.error('Usage: node scripts/deploy-gas.mjs <writing|classroom|both> [--dry-run]');
  process.exit(2);
}
let failed = false;
for (const name of names) {
  try {
    await deploy(name);
  } catch (e) {
    failed = true;
    console.error(`::error::${e instanceof Error ? e.message : e}`);
  }
}
process.exit(failed ? 1 : 0);
