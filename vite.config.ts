import { defineConfig, type Plugin } from 'vite';
import { backendVersion } from './scripts/backend-version.mjs';
import { CLASSROOM_VERSION } from './src/versions';

const BACKEND_VERSION = backendVersion();

// GitHub Pages cannot send security headers, so the production build carries a
// Content-Security-Policy meta tag. Scripts only from this site; network calls
// only to the Apps Script web app (script.google.com redirects to
// script.googleusercontent.com); images only from this site or data: URLs.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// dist/version.json: what this build expects the two Apps Script web apps to run. The class
// system's daily health check reads it and emails the teacher when a deployment is out of date.
function versionFilePlugin(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(
          {
            backend: BACKEND_VERSION,
            classroom: CLASSROOM_VERSION,
            builtAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      });
    },
  };
}

// Relative base so the build works on GitHub Pages under /<repo>/ and locally.
// Routing uses the URL hash, so no server-side rewrites are needed.
export default defineConfig({
  base: './',
  plugins: [cspPlugin(), versionFilePlugin()],
  define: { __EXPECTED_BACKEND_VERSION__: JSON.stringify(BACKEND_VERSION) },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
