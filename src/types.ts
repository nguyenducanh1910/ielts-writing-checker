// Shapes returned by the API (mirrors apps-script/src/views.ts).
import type { Criterion, Mode, TaskType } from '../shared/constants';

export interface Option {
  id: string;
  label: string;
}

export interface AppConfig {
  classes: Option[];
  topics: Option[];
  dailyCap: number;
  adminTimezone: string;
}

export interface ScoreView {
  criteria: Record<Criterion, number>;
  overall: number;
  feedback: Record<Criterion, string>;
  generalComment: string;
  updatedAt: string;
}

export interface ErrorView {
  id: string;
  categoryId: string;
  category: string;
  criterion: Criterion;
  excerpt: string;
  start: number | null;
  end: number | null;
  correction: string;
  note: string;
}

export interface RewriteView {
  id: string;
  essayId: string;
  dueAt: string;
  note: string;
  status: 'requested' | 'submitted' | 'overdue' | 'waived';
  rewriteEssayId: string | null;
  late: boolean;
}

export interface EssaySummary {
  id: string;
  mode: Mode;
  taskType: TaskType;
  topicId: string;
  /** Display label: diagram type (Task 1) or "Topic · Essay type" (Task 2). */
  topic: string;
  topicName?: string;
  diagramType?: string;
  essayType?: string;
  promptPreview: string;
  wordCount: number;
  status: 'draft' | 'pending' | 'in_review' | 'scored';
  studentStatus: string;
  overall: number | null;
  savedAt: string;
  submittedAt: string | null;
  scoredAt: string | null;
  parentEssayId: string | null;
  assignmentId: string | null;
  assignmentTitle: string | null;
  overTime: boolean;
  uploadedByAdmin?: boolean;
  startedAt: string | null;
  deadlineAt: string | null;
}

export interface EssayDetail extends EssaySummary {
  prompt: string;
  body: string;
  hasImage: boolean;
  timeLimitMinutes: number | null;
  timeUsedSeconds: number | null;
  autoSubmitted: boolean;
  pasteAttempts: number;
  testDate: string;
  score: ScoreView | null;
  errors: ErrorView[];
  rewrite: RewriteView | null;
  parent: { id: string; score: ScoreView | null; submittedAt: string } | null;
  rewriteEssay: { id: string; status: string; score: ScoreView | null } | null;
  serverNow?: string;
}
