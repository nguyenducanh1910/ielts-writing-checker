// Mock API server for local development and the Playwright flow.
// It runs the real back-end code (apps-script/src) against in-memory Sheets,
// Drive, Gmail, Cache and Lock, so it follows exactly the same contract as
// the Apps Script web app. Test-only helpers live under /__test/.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { callApi } from '../apps-script/src/api';
import { createCtx } from '../apps-script/src/context';
import { runSetup } from '../apps-script/src/setup';
import { runDailyJob, runHourlyJob } from '../apps-script/src/triggers';
import { createMemoryServices, type MemoryServices } from '../apps-script/testing/memory';

const PORT = Number(process.env.MOCK_API_PORT ?? 8787);
const APP_URL = process.env.MOCK_APP_URL ?? 'http://localhost:5173/';

let svc: MemoryServices = fresh();

function fresh(): MemoryServices {
  const s = createMemoryServices({ APP_URL }, { realTime: true });
  runSetup(s);
  return s;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (req.method === 'OPTIONS') return send(res, 204, null);

    if (url.pathname === '/' && req.method === 'POST') {
      // Like Apps Script, only text/plain bodies are expected (no preflight).
      const body = await readBody(req);
      return send(res, 200, callApi(svc, body));
    }
    if (url.pathname === '/' && req.method === 'GET') {
      return send(res, 200, { ok: true, data: { service: 'ielts-writing (mock)' } });
    }

    // ---- Test helpers ----
    if (url.pathname === '/__test/reset') {
      svc = fresh();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/__test/outbox') {
      return send(
        res,
        200,
        svc.mail.outbox.map((m) => ({ to: m.to, subject: m.subject, text: m.text })),
      );
    }
    if (url.pathname === '/__test/login-link') {
      const email = (url.searchParams.get('email') ?? '').toLowerCase();
      const mail = [...svc.mail.outbox]
        .reverse()
        .find((m) => m.to === email && /token=/.test(m.text));
      const link = mail ? /(https?:\/\/\S+token=[a-f0-9]+)/.exec(mail.text)?.[1] : null;
      return send(res, link ? 200 : 404, { link });
    }
    if (url.pathname === '/__test/email-events') {
      return send(res, 200, createCtx(svc).db.all('EmailEvents'));
    }
    if (url.pathname === '/__test/table') {
      const name = url.searchParams.get('name') ?? '';
      return send(res, 200, createCtx(svc).db.all(name as 'Essays'));
    }
    if (url.pathname === '/__test/quota') {
      svc.mail.quota = Number(url.searchParams.get('n') ?? 100);
      return send(res, 200, { quota: svc.mail.quota });
    }
    if (url.pathname === '/__test/fail-mail') {
      svc.mail.failNext = Number(url.searchParams.get('n') ?? 1);
      return send(res, 200, { failNext: svc.mail.failNext });
    }
    if (url.pathname === '/__test/advance') {
      svc.advance(Number(url.searchParams.get('ms') ?? 0));
      return send(res, 200, { now: svc.now().toISOString() });
    }
    if (url.pathname === '/__test/daily') return send(res, 200, runDailyJob(svc));
    if (url.pathname === '/__test/hourly') return send(res, 200, runHourlyJob(svc));
    return send(res, 404, { ok: false });
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, error: { code: 'server_error', message: String(err) } });
  }
});

server.listen(PORT, () => {
  console.log(`Mock API listening on http://localhost:${PORT} (app URL ${APP_URL})`);
  console.log('Admin: admin@example.com · Students: demo.an@example.com, demo.binh@example.com');
  console.log(`Login links: http://localhost:${PORT}/__test/login-link?email=<email>`);
});
