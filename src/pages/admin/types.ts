import type { ClaudeDraft } from '../../../shared/claude';
import type { Criterion } from '../../../shared/constants';
import type { SourceCalibration } from '../../../shared/stats';
import type { EssayDetail, ErrorView, ScoreView } from '../../types';
import type { ResultActivity } from './activity';

export interface QueueItem {
  id: string;
  studentId: string;
  studentName: string;
  taskType: string;
  mode: string;
  topic: string;
  submittedAt: string;
  scoredAt: string | null;
  wordCount: number;
  queueStatus: string;
  isRewrite: boolean;
  assignmentId: string | null;
  assignmentTitle: string | null;
  overTime: boolean;
  pasteAttempts: number;
  uploadedByAdmin: boolean;
  /** Scored essays only. */
  activity: ResultActivity | null;
  /** Latest automatic scoring run (Gemini), if any. */
  ai?: AiJobView | null;
}

export interface AiJobView {
  status: 'queued' | 'running' | 'done' | 'failed' | string;
  error: string;
  updatedAt: string;
}

/** Gemini's own draft; "calibration" lists the scores moved by Gemini's recorded bias. */
export type AiDraft = import('../../../shared/claude').ClaudeDraft & {
  calibration?: import('../../../shared/aiScoring').ScoreAdjustment[];
};

export interface AiSettings {
  hasGeminiKey: boolean;
  /** Essays from Google Classroom get a Gemini draft as soon as they arrive. */
  autoDraft: boolean;
  /** Move Gemini's own draft by its recorded bias against the teacher's final scores. */
  calibrate: boolean;
  /** Gemini's own scores versus the teacher's final scores, per task type. */
  accuracy: Array<{
    taskType: string;
    label: string;
    samples: number;
    bias: Partial<Record<string, number | null>>;
    within: Partial<Record<string, number | null>>;
  }>;
  geminiModel: string;
  rubric: string;
  samplesPerPrompt: number;
  sampleCount: number;
  jobsReady: boolean;
  jobs: { queued: number; running: number; done: number; failed: number };
}

export interface AiScoreResult {
  essayId: string;
  /** Null when Gemini scored alone (no Claude draft): see aiDraft. */
  claudeDraft: import('../../../shared/claude').ClaudeDraft | null;
  aiDraft: AiDraft | null;
  reconciled: import('../../../shared/claude').ClaudeDraft | null;
  reconcileText: string;
  gemini: { scores: Record<string, number>; overall: number; model: string } | null;
  samples: number;
  warnings: string[];
}

export interface QueueResponse {
  items: QueueItem[];
  students: Array<{ id: string; name: string }>;
  assignments: Array<{ id: string; title: string }>;
  /** Prompts answered by two or more essays, most answered first. */
  prompts: Array<{ key: string; label: string; count: number }>;
  emailQueued: number;
  emailFailed: number;
}

export interface CategoryRow {
  id: string;
  criterion: Criterion;
  label: string;
  active: boolean;
}

export interface SourceFeedbackView {
  id: string;
  sourceId: string;
  scores: Record<Criterion, number | null>;
  overall: number | null;
  feedbackText: string;
  createdAt: string;
}

export interface AdminEssayResponse {
  essay: EssayDetail & {
    driveStatus: string;
    driveFolderId: string;
    queueStatus: string;
    /** Taken out of the marking queue by the teacher (not scored). */
    withdrawnAt?: string | null;
  };
  student: { id: string; name: string; email: string; className: string } | null;
  assignment: { id: string; title: string } | null;
  parent: {
    id: string;
    prompt: string;
    body: string;
    submittedAt: string;
    score: ScoreView | null;
    errors: ErrorView[];
  } | null;
  claudeDraft: {
    id: string;
    rawText: string;
    parsed: ClaudeDraft | null;
    createdAt: string;
  } | null;
  reconcile: { id: string; rawText: string; createdAt: string } | null;
  /** Gemini's own draft, made without a Claude draft (e.g. right after a Classroom import). */
  aiDraft?: {
    id: string;
    rawText: string;
    parsed: AiDraft | null;
    createdAt: string;
  } | null;
  sourceFeedback: SourceFeedbackView[];
  sources: Array<{ id: string; name: string; active: boolean }>;
  calibration: SourceCalibration[];
  categories: CategoryRow[];
  topics: Array<{ id: string; label: string; active: boolean }>;
  recurringErrors: Array<{ category: string; count: number }>;
  /** Submitted essays (this one included) that answer the same prompt. */
  samePrompt: { key: string; count: number } | null;
  isSample: boolean;
  emailEvents: Array<{
    id: string;
    type: string;
    status: string;
    error: string;
    createdAt: string;
    key: string;
  }>;
}

/** One essay on the Read all page. */
export interface ReadItem {
  id: string;
  studentName: string;
  className: string;
  taskType: string;
  topic: string;
  prompt: string;
  body: string;
  wordCount: number;
  submittedAt: string;
  hasImage: boolean;
  queueStatus: string;
  overall: number | null;
  isRewrite: boolean;
  assignmentTitle: string | null;
}
