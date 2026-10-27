// Bundles the TypeScript back end into a single Apps Script file.
// Apps Script has no module system, so esbuild produces an IIFE exposed as
// `__App`, and the footer declares the top-level functions Apps Script needs
// (web app entry points, setup, and trigger handlers).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'dist');
mkdirSync(outDir, { recursive: true });

const entryPoints = ['doGet', 'doPost', 'setup', 'installTriggers', 'dailyJob', 'hourlyJob'];

const footer = entryPoints
  .map((name) => `function ${name}(e) { return __App.${name}(e); }`)
  .join('\n');

await build({
  entryPoints: [join(here, 'src', 'gas.ts')],
  bundle: true,
  format: 'iife',
  globalName: '__App',
  target: 'es2020',
  platform: 'neutral',
  outfile: join(outDir, 'Code.js'),
  footer: { js: `\n${footer}\n` },
  legalComments: 'none',
  logLevel: 'info',
});

copyFileSync(join(here, 'appsscript.json'), join(outDir, 'appsscript.json'));
console.log('Apps Script bundle written to apps-script/dist');
