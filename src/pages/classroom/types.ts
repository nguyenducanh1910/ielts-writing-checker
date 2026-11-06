// Shapes returned by the class management web app (Code.gs, "WEB PORTAL API").

export type GradeKind =
  'sent' | 'error' | 'review' | 'approved' | 'web' | 'skipped' | 'graded' | 'waiting' | 'other';

export interface ClassInfo {
  id: string;
  name: string;
  section?: string;
  link?: string;
  students?: number;
  hasPenaltyFile?: boolean;
}

export interface OverviewAssignment {
  id: string;
  title: string;
  className: string;
  courseId: string;
  dueAt: string;
  total: number;
  onTime: number;
  late: number;
  missing: number;
  missingNames: string[];
  link: string;
  skills: string[];
}

export interface Overview {
  teacherName: string;
  sheetUrl: string;
  classes: ClassInfo[];
  todo: { review: number; approved: number; error: number; web: number };
  assignments: OverviewAssignment[];
  log: Array<{ at: string; event: string; detail: string }>;
  /** Last daily health check (null: never ran). */
  health?: Health | null;
  version?: string;
  /** Classes created on Google Classroom that the system does not track yet. */
  newClasses?: NewClass[];
  /** Tracked classes with a penalty file, usable as the template for a new class. */
  templates?: Array<{ id: string; name: string }>;
  /** Since when Gemini has been overloaded (ISO), '' when it works. */
  aiDownSince?: string;
  /** "Việc cần làm hôm nay": submissions to check by hand, Forms done but not turned in. */
  todoItems?: { manual: TodoItem[]; formPending: TodoItem[] };
}

export interface TodoItem {
  id: string;
  student: string;
  title: string;
  className: string;
  skill: string;
  status: string;
  dueAt?: string;
}

export interface NewClass {
  id: string;
  name: string;
  section?: string;
  link?: string;
  students: number;
}

export interface TrackResult {
  message: string;
  penaltyLink: string;
}

export interface Health {
  checkedAt: string;
  ok: boolean;
  problems: string[];
  notes: string[];
  versions?: {
    site: { backend?: string; classroom?: string } | null;
    writing: string | null;
    classroom: string;
  };
}

export interface Submission {
  id: string;
  className: string;
  title: string;
  skill: string;
  student: string;
  email: string;
  status: string;
  turnedInAt: string;
  dueAt: string;
  score: string;
  band: string;
  summary: string;
  feedbackFile: string;
  gradeStatus: string;
  gradeKind: GradeKind;
  gradedAt: string;
  approved: boolean;
  sentAt: string;
  files: string[];
  courseWorkId: string;
  courseId: string;
  assignmentLink: string;
}

export type SubmissionView = 'review' | 'approved' | 'error' | 'web' | 'missing' | 'all';

export interface SubmissionList {
  view: SubmissionView;
  counts: Record<SubmissionView, number>;
  total: number;
  rows: Submission[];
  classes: ClassInfo[];
  assignments: Array<{ id: string; title: string; className: string }>;
}

export interface SubmissionFile {
  id: string;
  name: string;
  mime: string;
  kind: 'audio' | 'video' | 'image' | 'doc' | 'error';
  size: number;
  url: string;
}

export interface AssignOptions {
  classes: ClassInfo[];
  types: string[];
  timeZone: string;
}

export interface PreviewQuestion {
  n: number;
  type: string;
  options: string[];
  key: string;
  explained: boolean;
  level: string;
  err: string;
}

export interface AssignPreview {
  parts: Array<{
    name: string;
    total: number;
    groups: Array<{ a: number; b: number; label: string; pair: boolean }>;
    questions: PreviewQuestion[];
    scale: string[];
  }>;
  attachments: Array<{ name: string; mode: string }>;
  writing: string;
  speaking: string;
  missingAudio: boolean;
}

export interface AssignCheck {
  summary: string;
  warnings: string[];
  preview?: AssignPreview;
}

export interface AssignRow {
  row: number;
  className: string;
  session: string;
  type: string;
  folder: string;
  dueAt: string;
  publish: boolean;
  status: string;
  link: string;
  detail: string;
}

export interface ItemRow {
  q: string;
  key: string;
  n: number;
  right: number;
  wrong: number;
  p: number | null;
  pLabel: string;
  d: number | null;
  dLabel: string;
  expected: string;
  common: string;
  flags: string;
}

export interface ItemAnalysis {
  key: string;
  courseWorkId: string;
  className: string;
  title: string;
  part: string;
  updatedAt: string;
  summary: {
    average: string;
    students: number;
    notDone: string;
    note: string;
    distribution: string;
    groups: string;
  } | null;
  items: ItemRow[];
}

export interface ItemsResponse {
  list: Array<Pick<ItemAnalysis, 'key' | 'className' | 'title' | 'part' | 'updatedAt'>>;
  selected: ItemAnalysis | null;
}

export interface ScoreCell {
  skill: string;
  status: string;
  score: string;
  band: string;
  gradeKind: GradeKind;
  id: string;
}

export interface ScoresResponse {
  courseId: string;
  classes: ClassInfo[];
  assignments: Array<{ id: string; title: string; dueAt: string }>;
  students: Array<{ email: string; name: string; cells: Record<string, ScoreCell[]> }>;
}

export interface PenaltyResponse {
  classes: ClassInfo[];
  courseId?: string;
  message?: string;
  tab?: string;
  tabs?: string[];
  url?: string;
  columns?: Array<{ session: string; week: string; skill: string }>;
  rows?: Array<{ name: string; values: string[]; fine: number; weeks: Record<string, number> }>;
  total?: number;
  fineUnit?: number;
}

export interface StudentPart {
  skill: string;
  state: 'sent' | 'skipped' | 'grading' | 'todo';
  score: string;
  band: string;
  summary: string;
  sentAt: string;
  feedbackFile: string;
  /** Writing essay on this site (scored or not): the student opens it at /essays/<id>. */
  essayId?: string;
}

export interface StudentAssignment {
  id: string;
  title: string;
  className: string;
  dueAt: string;
  status: string;
  turnedInAt: string;
  link: string;
  overdue: boolean;
  parts: StudentPart[];
}

export interface StudentClassroom {
  matched: boolean;
  email: string;
  name?: string;
  classes?: string[];
  stats?: {
    assignments: number;
    pastDue: number;
    submitted: number;
    pending: number;
    overdue: number;
    bands: Record<'Reading' | 'Listening' | 'Writing' | 'Speaking', number | null>;
  };
  assignments?: StudentAssignment[];
  penalty?: Array<{
    className: string;
    tab: string;
    fine: number;
    weeks: Record<string, number>;
    items: Array<{ session: string; week: string; skill: string; value: string }>;
  }>;
}

export interface ProgressPoint {
  at: string;
  title: string;
  skill: 'Reading' | 'Listening' | 'Writing' | 'Speaking';
  band: number;
  score: string;
}

export interface ReviewItem {
  courseWorkId: string;
  title: string;
  skill: string;
  q: number;
  given: string;
  key: string;
  err: string;
  explanation: string;
  at: string;
}

export interface Progress {
  matched: boolean;
  email: string;
  name?: string;
  className?: string;
  points?: ProgressPoint[];
  bySkill?: Record<string, { count: number; latest: number; average: number; change: number }>;
  errors?: Array<{ label: string; count: number }>;
  wrongTotal?: number;
  answered?: number;
  review?: ReviewItem[];
}

export interface StudentListItem {
  email: string;
  name: string;
  className: string;
}
