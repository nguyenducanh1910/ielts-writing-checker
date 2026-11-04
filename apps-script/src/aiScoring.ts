// Automatic scoring, free: "Bắt đầu chấm" runs the rest of the teacher's workflow after the
// Claude draft was pasted (Claude.ai Project, one copy + one paste for up to 5 essays).
//  1. Gemini (API, free key) scores the essay independently, with the same instructions, the
//     band descriptors, the error categories and 3–5 of the teacher's calibration samples of
//     the same kind.
//  2. Gemini reconciles its result with Claude's draft, allowing for each tool's recorded bias.
//  3. The scoring page loads the reconciled result into the form.
// Nothing is sent to the student: the teacher reviews the form and submits it as before; the
// sent result then becomes a calibration sample by itself (handlers/scoring.ts).
// Gemini takes a minute or two, so the calls run without the script lock; results are written
// under the lock at the end.
import {
  addUsage,
  type AiImage,
  type AiReply,
  type AiUsage,
  buildGeminiReconcilePrompt,
  buildSystemPrompt,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SAMPLES_PER_PROMPT,
  draftAsText,
  GEMINI_FALLBACK_MODEL,
  geminiReconcileText,
  geminiRequestBody,
  MAX_RUBRIC,
  MAX_SAMPLES_PER_PROMPT,
  NO_USAGE,
  readGeminiResponse,
  selectSamples,
  type ToolBias,
} from '../../shared/aiScoring';
import { overallBand } from '../../shared/band';
import {
  buildClaudePrompt,
  type ClaudeDraft,
  parseClaudeReply,
  parseReconcileReply,
} from '../../shared/claude';
import { CRITERIA, diagramTypeLabel, essayTypeLabel, type TaskType } from '../../shared/constants';
import { countWords } from '../../shared/wordCount';
import { activeSampleIds, calibrationFor } from './calibration';
import { ApiError, createCtx, type Ctx, type EssayRow, num, parseJson } from './context';
import { MAX_CELL } from './db';
import { recurringErrors } from './handlers/admin';
import { categoryExport, formatSamples } from './handlers/claudeSetup';
import type { ActionDef } from './router';
import type { HttpRequest, Services } from './services';
import { Reader } from './validate';
import { scoreView } from './views';

const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

/** Background runs stop taking new essays after this long (Apps Script stops at 6 minutes). */
const JOB_BUDGET_MS = 3.5 * 60 * 1000;
/** A job still "running" after this long was cut off: it is tried again. */
const STALE_MS = 10 * 60 * 1000;
export const QUEUE_MAX = 50;

// ---------- Settings ----------

function setting(ctx: Ctx, key: string, fallback: string): string {
  const v = ctx.db.findOne('Settings', (s) => s.key === key)?.value ?? '';
  return v.trim() ? v : fallback;
}

function putSetting(ctx: Ctx, key: string, value: string) {
  if (ctx.db.findOne('Settings', (s) => s.key === key)) {
    ctx.db.update('Settings', (s) => s.key === key, { value });
  } else {
    ctx.db.insert('Settings', { key, value });
  }
}

export function aiConfig(ctx: Ctx) {
  const n = Number(setting(ctx, 'ai_samples', String(DEFAULT_SAMPLES_PER_PROMPT)));
  return {
    geminiModel: setting(ctx, 'ai_gemini_model', DEFAULT_GEMINI_MODEL).trim(),
    rubric: setting(ctx, 'ai_rubric', ''),
    samplesPerPrompt: Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_SAMPLES_PER_PROMPT) : 4,
    hasGeminiKey: Boolean(ctx.svc.props.GEMINI_API_KEY),
  };
}

function jobsReady(svc: Services): boolean {
  return Boolean(svc.spreadsheet.getSheetByName('AiJobs'));
}

// ---------- Requests ----------

function geminiRequest(svc: Services, model: string, body: string): HttpRequest {
  return {
    url: geminiUrl(model),
    headers: { 'x-goog-api-key': svc.props.GEMINI_API_KEY ?? '' },
    body,
  };
}

/** One request, tried a second time when the API is overloaded or rate limited. */
function callOnce(svc: Services, req: HttpRequest, read: typeof readGeminiResponse): AiReply {
  let reply = read(...one(svc, req));
  if (!reply.ok && reply.retry) reply = read(...one(svc, req));
  return reply;
}

function one(svc: Services, req: HttpRequest): [number, string] {
  try {
    const [res] = svc.http.fetchAll([req]);
    return [res.status, res.text];
  } catch (err) {
    svc.log(`Gemini request failed: ${(err as Error)?.stack ?? String(err)}`);
    throw new ApiError('conflict', fetchFailure(err));
  }
}

/** Apps Script could not send the request at all (usually a missing permission). */
export function fetchFailure(err: unknown): string {
  const text = String((err as Error)?.message ?? err);
  if (/permission|quyền|authoriz|cấp phép|script\.external_request/i.test(text))
    return 'Apps Script chưa được cấp quyền kết nối ra ngoài (Gemini). Mở dự án Apps Script của web Writing, chọn hàm setup, bấm Chạy và bấm “Cho phép” khi Google hỏi quyền; sau đó triển khai lại “Phiên bản mới”.';
  return `Không gửi được yêu cầu tới Gemini: ${text.slice(0, 300)}`;
}

// ---------- Preparing one essay ----------

interface Prepared {
  essay: EssayRow;
  taskType: TaskType;
  system: string;
  prompt: string;
  image: AiImage | null;
  sampleIds: string[];
  claudeBias: ToolBias;
  geminiBias: ToolBias;
}

function prepare(ctx: Ctx, essay: EssayRow): Prepared {
  const cfg = aiConfig(ctx);
  const taskType = essay.task_type as TaskType;
  const ids = activeSampleIds(ctx);
  const candidates = ctx.db
    .find('Essays', (e) => ids.has(e.id) && e.status === 'scored')
    .map((e) => ({
      id: e.id,
      taskType: e.task_type,
      subtype: taskType === 'task1_academic' ? e.diagram_type : e.essay_type,
      topicId: e.topic_id,
      overall: num(ctx.db.findOne('Scores', (s) => s.essay_id === e.id)?.overall ?? '') ?? null,
      scoredAt: e.scored_at,
    }));
  const sampleIds = selectSamples(
    candidates,
    {
      id: essay.id,
      taskType: essay.task_type,
      subtype: taskType === 'task1_academic' ? essay.diagram_type : essay.essay_type,
      topicId: essay.topic_id,
    },
    cfg.samplesPerPrompt,
  );
  const sampleEssays = sampleIds
    .map((id) => ctx.db.byId('Essays', id))
    .filter((e): e is EssayRow => Boolean(e && scoreView(ctx, e.id)));
  const system = buildSystemPrompt({
    rubric: cfg.rubric,
    categories: categoryExport(ctx),
    samples: formatSamples(ctx, sampleEssays),
  });
  const prompt = buildClaudePrompt({
    taskType,
    prompt: essay.prompt,
    topic: ctx.db.byId('Topics', essay.topic_id)?.label ?? '',
    diagramType: diagramTypeLabel(essay.diagram_type),
    essayType: essayTypeLabel(essay.essay_type),
    wordCount: countWords(essay.body),
    body: essay.body,
    recurringErrors: recurringErrors(ctx, essay.student_id, essay.id),
  });
  let image: AiImage | null = null;
  if (taskType === 'task1_academic' && essay.image_file_id) {
    const f = ctx.svc.drive.readFile(essay.image_file_id);
    image = { mimeType: f.mimeType, base64: f.base64 };
  }
  const cal = calibrationFor(ctx, essay.task_type);
  const biasOf = (name: string): ToolBias => {
    const src = sourceByName(ctx, name);
    const c = src ? cal.find((x) => x.sourceId === src.id) : undefined;
    return { bias: (c?.bias ?? {}) as Record<string, number | null>, samples: c?.samples ?? 0 };
  };
  return {
    essay,
    taskType,
    system,
    prompt,
    image,
    sampleIds: sampleEssays.map((e) => e.id),
    claudeBias: biasOf('claude'),
    geminiBias: biasOf('gemini'),
  };
}

function sourceByName(ctx: Ctx, name: string) {
  return ctx.db.findOne('FeedbackSources', (s) => s.name.trim().toLowerCase() === name);
}

/** The newest pasted Claude draft of the essay (single or batch paste). */
function claudeDraftOf(ctx: Ctx, essayId: string): { raw: string; draft: ClaudeDraft } | null {
  const d = ctx.db
    .find('Drafts', (x) => x.essay_id === essayId && x.kind === 'initial')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!d) return null;
  const parsed = parseJson<ClaudeDraft | null>(d.parsed_json, null);
  if (parsed?.scores) return { raw: d.raw_text, draft: parsed };
  const again = parseClaudeReply(d.raw_text);
  return again.ok ? { raw: d.raw_text, draft: again.value } : null;
}

export interface AiScoreResult {
  essayId: string;
  claudeDraft: ClaudeDraft;
  reconciled: ClaudeDraft | null;
  reconcileText: string;
  gemini: { scores: Record<string, number>; overall: number; model: string } | null;
  samples: number;
  warnings: string[];
  usage: AiUsage;
}

export const NEED_CLAUDE_DRAFT =
  'Chưa có bản chấm của Claude: bấm "Copy for Claude" (hoặc Copy batch), dán vào Claude Project rồi dán kết quả về trước.';

/**
 * Gemini scores, then reconciles with the pasted Claude draft; stores the Gemini result and the
 * reconcile answer. Throws ApiError with a Vietnamese message when it cannot run.
 */
export function scoreEssayWithAi(svc: Services, essayId: string, jobId = ''): AiScoreResult {
  const ctx0 = createCtx(svc);
  const cfg = aiConfig(ctx0);
  if (!cfg.hasGeminiKey) {
    throw new ApiError('conflict', 'Chưa có khoá Gemini API: vào Cài đặt → Chấm tự động để nhập.');
  }
  const essay = ctx0.db.byId('Essays', essayId);
  if (!essay) throw new ApiError('not_found', 'Essay not found.');
  if (essay.status === 'draft')
    throw new ApiError('conflict', 'Bài nháp chưa nộp: chưa chấm được.');
  if (essay.status === 'scored') {
    throw new ApiError('conflict', 'Bài này đã gửi điểm cho học viên: không chấm tự động lại.');
  }
  const claude = claudeDraftOf(ctx0, essayId);
  if (!claude) throw new ApiError('conflict', NEED_CLAUDE_DRAFT);
  const p = prepare(ctx0, essay);
  const warnings: string[] = [];
  let usage = NO_USAGE;

  // 1: Gemini scores on its own (fallback model once if overloaded / rate limited / unknown).
  const firstTurn = { role: 'user' as const, text: p.prompt, image: p.image };
  let model = cfg.geminiModel;
  const ask = (m: string, turns: Parameters<typeof geminiRequestBody>[0]['turns']) =>
    callOnce(
      svc,
      geminiRequest(svc, m, geminiRequestBody({ system: p.system, turns })),
      readGeminiResponse,
    );
  let reply = ask(model, [firstTurn]);
  if (!reply.ok && (reply.retry || reply.status === 404) && model !== GEMINI_FALLBACK_MODEL) {
    warnings.push(`${reply.message} — đã dùng ${GEMINI_FALLBACK_MODEL}.`);
    model = GEMINI_FALLBACK_MODEL;
    reply = ask(model, [firstTurn]);
  }
  if (!reply.ok) throw new ApiError('server_error', reply.message);
  usage = addUsage(usage, reply.usage);
  const parsed = parseClaudeReply(reply.text);
  if (!parsed.ok) {
    throw new ApiError(
      'server_error',
      `Gemini trả lời sai định dạng: ${parsed.errors.slice(0, 2).join(' ')}`,
    );
  }
  const geminiDraft = parsed.value;
  const geminiRaw = reply.text;

  // 2: Gemini reconciles both (same conversation: it sees the essay and its own answer).
  let reconciled: ClaudeDraft | null = null;
  let reconcileText = '';
  const rPrompt = buildGeminiReconcilePrompt({
    taskType: p.taskType,
    claudeDraftJson: JSON.stringify(
      {
        scores: claude.draft.scores,
        feedback: claude.draft.feedback,
        general_comment: claude.draft.generalComment,
        suggested_topic: claude.draft.suggestedTopic,
        errors: claude.draft.errors,
      },
      null,
      2,
    ),
    geminiDraftJson: geminiRaw,
    claudeBias: p.claudeBias,
    geminiBias: p.geminiBias,
  });
  const r2 = ask(model, [
    firstTurn,
    { role: 'model', text: geminiRaw },
    { role: 'user', text: rPrompt },
  ]);
  if (!r2.ok) {
    warnings.push(`${r2.message} — chưa đối chiếu được, form dùng bản chấm của Claude.`);
  } else {
    usage = addUsage(usage, r2.usage);
    const out = geminiReconcileText(r2.text);
    const res = out ? parseReconcileReply(out.text) : null;
    if (out && res && res.ok) {
      reconcileText = `[Gemini API · ${model}]\n${out.text}`;
      reconciled = res.value;
    } else {
      warnings.push('Không đọc được kết quả đối chiếu của Gemini — form dùng bản chấm của Claude.');
    }
  }

  // Store under the lock, with fresh data.
  svc.lock.waitLock(30000);
  try {
    const ctx = createCtx(svc);
    const fresh = ctx.db.byId('Essays', essayId);
    if (!fresh || fresh.status === 'scored') {
      throw new ApiError(
        'conflict',
        'Bài đã được gửi điểm trong lúc AI đang chấm: không lưu kết quả AI.',
      );
    }
    const clip = (t: string) => (t.length < MAX_CELL ? t : t.slice(0, MAX_CELL - 100));
    const gSource = sourceByName(ctx, 'gemini');
    if (gSource) {
      const fields = {
        criterion_1: geminiDraft.scores.task,
        criterion_2: geminiDraft.scores.coherence,
        criterion_3: geminiDraft.scores.lexical,
        criterion_4: geminiDraft.scores.grammar,
        overall: overallBand(CRITERIA.map((c) => geminiDraft.scores[c])),
        feedback_text: clip(`[Gemini API · ${model}]\n\n${draftAsText(geminiDraft, p.taskType)}`),
      };
      const existing = ctx.db.findOne(
        'SourceFeedback',
        (x) => x.essay_id === essayId && x.source_id === gSource.id,
      );
      if (existing) ctx.db.update('SourceFeedback', (x) => x.id === existing.id, fields);
      else
        ctx.db.insert('SourceFeedback', {
          id: ctx.svc.uuid(),
          essay_id: essayId,
          source_id: gSource.id,
          created_at: ctx.nowIso,
          ...fields,
        });
    }
    if (reconcileText) {
      ctx.db.insert('Drafts', {
        id: ctx.svc.uuid(),
        essay_id: essayId,
        kind: 'reconcile',
        raw_text: clip(reconcileText),
        parsed_json: '',
        created_at: ctx.nowIso,
      });
    }
    if (jobsReady(svc)) {
      const row = {
        status: 'done',
        step: reconciled ? 'reconciled' : 'gemini',
        error: '',
        warnings: warnings.join('\n'),
        usage_json: JSON.stringify(usage),
        updated_at: ctx.nowIso,
      };
      if (jobId) ctx.db.update('AiJobs', (j) => j.id === jobId, row);
      else
        ctx.db.insert('AiJobs', {
          id: ctx.svc.uuid(),
          essay_id: essayId,
          created_at: ctx.nowIso,
          ...row,
        });
    }
  } finally {
    svc.lock.releaseLock();
  }

  return {
    essayId,
    claudeDraft: claude.draft,
    reconciled,
    reconcileText,
    gemini: { scores: { ...geminiDraft.scores }, overall: geminiDraft.overall, model },
    samples: p.sampleIds.length,
    warnings,
    usage,
  };
}

// ---------- Background queue ("Chấm tất cả bằng AI") ----------

function withLock<T>(svc: Services, fn: (ctx: Ctx) => T): T {
  svc.lock.waitLock(30000);
  try {
    return fn(createCtx(svc));
  } finally {
    svc.lock.releaseLock();
  }
}

/** The newest job of each essay. */
export function latestJobs(
  ctx: Ctx,
): Map<string, { status: string; error: string; updatedAt: string }> {
  const out = new Map<string, { status: string; error: string; updatedAt: string; at: string }>();
  if (!jobsReady(ctx.svc)) return out;
  for (const j of ctx.db.all('AiJobs')) {
    const prev = out.get(j.essay_id);
    if (!prev || j.created_at > prev.at) {
      out.set(j.essay_id, {
        status: j.status,
        error: j.error,
        updatedAt: j.updated_at,
        at: j.created_at,
      });
    }
  }
  return out;
}

function queueEssays(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const ids = r.ids('essayIds', QUEUE_MAX);
  r.done();
  if (!jobsReady(ctx.svc)) {
    throw new ApiError(
      'conflict',
      'Cần chạy setup() một lần trong Apps Script (thêm bảng AiJobs).',
    );
  }
  if (!aiConfig(ctx).hasGeminiKey) {
    throw new ApiError('conflict', 'Chưa có khoá Gemini API: vào Cài đặt → Chấm tự động để nhập.');
  }
  const latest = latestJobs(ctx);
  let queued = 0;
  let skipped = 0;
  let noDraft = 0;
  for (const id of ids) {
    const e = ctx.db.byId('Essays', id);
    const st = latest.get(id)?.status;
    if (
      !e ||
      e.status === 'draft' ||
      e.status === 'scored' ||
      st === 'queued' ||
      st === 'running'
    ) {
      skipped++;
      continue;
    }
    if (!ctx.db.findOne('Drafts', (d) => d.essay_id === id && d.kind === 'initial')) {
      noDraft++;
      continue;
    }
    ctx.db.insert('AiJobs', {
      id: ctx.svc.uuid(),
      essay_id: id,
      status: 'queued',
      step: '',
      error: '',
      warnings: '',
      usage_json: '',
      created_at: ctx.nowIso,
      updated_at: ctx.nowIso,
    });
    queued++;
  }
  if (queued) ctx.svc.jobs.runSoon('aiJob');
  return { queued, skipped, noDraft };
}

/** Time-driven: score queued essays one by one; schedules itself again if some are left. */
export function runAiJobs(svc: Services) {
  const start = Date.now();
  let done = 0;
  let failed = 0;
  if (!jobsReady(svc)) return { done, failed, left: 0 };
  for (;;) {
    if (Date.now() - start > JOB_BUDGET_MS) break;
    const job = withLock(svc, (ctx) => {
      const nowMs = ctx.now.getTime();
      // Jobs cut off by the 6-minute limit go back to the queue.
      for (const j of ctx.db.find('AiJobs', (x) => x.status === 'running')) {
        if (nowMs - Date.parse(j.updated_at) > STALE_MS) {
          ctx.db.update('AiJobs', (x) => x.id === j.id, {
            status: 'queued',
            updated_at: ctx.nowIso,
          });
        }
      }
      const next = ctx.db
        .find('AiJobs', (x) => x.status === 'queued')
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      if (next)
        ctx.db.update('AiJobs', (x) => x.id === next.id, {
          status: 'running',
          updated_at: ctx.nowIso,
        });
      return next ?? null;
    });
    if (!job) break;
    try {
      scoreEssayWithAi(svc, job.essay_id, job.id);
      done++;
    } catch (err) {
      failed++;
      const message = err instanceof ApiError ? err.message : `Lỗi: ${(err as Error).message}`;
      withLock(svc, (ctx) =>
        ctx.db.update('AiJobs', (x) => x.id === job.id, {
          status: 'failed',
          error: message.slice(0, 500),
          updated_at: ctx.nowIso,
        }),
      );
    }
  }
  const left = withLock(svc, (ctx) => ctx.db.find('AiJobs', (x) => x.status === 'queued').length);
  if (left) svc.jobs.runSoon('aiJob');
  return { done, failed, left };
}

// ---------- Settings page ----------

function settingsView(ctx: Ctx) {
  const cfg = aiConfig(ctx);
  const latest = latestJobs(ctx);
  const counts = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const j of latest.values())
    if (j.status in counts) counts[j.status as keyof typeof counts]++;
  return {
    hasGeminiKey: cfg.hasGeminiKey,
    geminiModel: cfg.geminiModel,
    rubric: cfg.rubric,
    samplesPerPrompt: cfg.samplesPerPrompt,
    sampleCount: activeSampleIds(ctx).size,
    jobsReady: jobsReady(ctx.svc),
    jobs: counts,
  };
}

const MODEL_RE = /^[a-z0-9][a-z0-9.\-_]{2,60}$/;

function saveSettings(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  // Keys copied from AI Studio can carry spaces/line breaks; newer keys may contain dots.
  const geminiKey = r.str('geminiKey', { max: 400, optional: true }).replace(/\s+/g, '');
  const clearGemini = r.has('clearGeminiKey') ? r.bool('clearGeminiKey') : false;
  const geminiModel = r.str('geminiModel', { max: 64, optional: true });
  const rubric = r.str('rubric', { max: MAX_RUBRIC, optional: true, trim: false });
  const samples = r.int('samplesPerPrompt', {
    min: 0,
    max: MAX_SAMPLES_PER_PROMPT,
    optional: true,
  });
  if (geminiKey && !/^[\w.-]{20,300}$/.test(geminiKey))
    r.addError(
      'geminiKey',
      'Khoá Gemini API không đúng dạng — hãy chép lại đúng khoá từ aistudio.google.com/apikey',
    );
  if (geminiModel && !MODEL_RE.test(geminiModel))
    r.addError('geminiModel', 'Tên model không hợp lệ (ví dụ: gemini-flash-latest)');
  r.done();
  if (geminiKey) ctx.svc.setSecret('GEMINI_API_KEY', geminiKey);
  else if (clearGemini) ctx.svc.setSecret('GEMINI_API_KEY', '');
  if (r.has('geminiModel')) putSetting(ctx, 'ai_gemini_model', geminiModel);
  if (r.has('rubric')) putSetting(ctx, 'ai_rubric', rubric);
  if (samples !== null && samples !== undefined) putSetting(ctx, 'ai_samples', String(samples));
  return settingsView(ctx);
}

/** A tiny request to Gemini, to check the key and the model name. */
function testConnection(ctx: Ctx) {
  const cfg = aiConfig(ctx);
  if (!cfg.hasGeminiKey) return { gemini: { ok: false, message: 'Chưa nhập khoá Gemini API' } };
  let res: { status: number; text: string };
  try {
    [res] = ctx.svc.http.fetchAll([
      geminiRequest(
        ctx.svc,
        cfg.geminiModel,
        JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }] }),
      ),
    ]);
  } catch (err) {
    ctx.svc.log(`Gemini test failed: ${(err as Error)?.stack ?? String(err)}`);
    return { gemini: { ok: false, message: fetchFailure(err) } };
  }
  const x = readGeminiResponse(res.status, res.text);
  return {
    gemini: x.ok
      ? { ok: true, message: `Kết nối được (${cfg.geminiModel})` }
      : { ok: false, message: x.message },
  };
}

function scoreOne(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const essayId = r.id('essayId');
  r.done();
  return scoreEssayWithAi(ctx.svc, essayId);
}

export const aiActions: Record<string, ActionDef> = {
  'admin.ai.settings': { write: false, handler: (ctx) => settingsView(ctx) },
  'admin.ai.saveSettings': { write: true, handler: (ctx, p) => saveSettings(ctx, p) },
  'admin.ai.test': { write: false, handler: (ctx) => testConnection(ctx) },
  // No script lock while Gemini answers (a minute or two); results are written under the lock.
  'admin.ai.score': { write: false, handler: (ctx, p) => scoreOne(ctx, p) },
  'admin.ai.queue': { write: true, handler: (ctx, p) => queueEssays(ctx, p) },
};
