import type { ClaudeDraft } from '../../../shared/claude';
import type { Criterion } from '../../../shared/constants';
import type { SourceCalibration } from '../../../shared/stats';
import type { EssayDetail, ErrorView, ScoreView } from '../../types';

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
}

export interface QueueResponse {
  items: QueueItem[];
  students: Array<{ id: string; name: string }>;
  assignments: Array<{ id: string; title: string }>;
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
  sourceFeedback: SourceFeedbackView[];
  sources: Array<{ id: string; name: string; active: boolean }>;
  calibration: SourceCalibration[];
  categories: CategoryRow[];
  topics: Array<{ id: string; label: string; active: boolean }>;
  recurringErrors: Array<{ category: string; count: number }>;
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
