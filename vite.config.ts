import { defineConfig, type Plugin } from 'vite';

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

// Relative base so the build works on GitHub Pages under /<repo>/ and locally.
// Routing uses the URL hash, so no server-side rewrites are needed.
export default defineConfig({
  base: './',
  plugins: [cspPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
