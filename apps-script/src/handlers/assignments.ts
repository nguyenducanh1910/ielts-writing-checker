// Assigned test mode: the admin sets the prompt; students get one timed attempt.
import {
  LIMITS,
  OVER_TIME_GRACE_SECONDS,
  TASK_TYPE_LABELS,
  TASK_TYPES,
  TIME_LIMITS,
  type TaskType,
} from '../../../shared/constants';
import type { AuthUser } from '../auth';
import { authorize } from '../authorize';
import { categoryColumns, readCategory } from '../category';
import { ApiError, appUrl, bool, type Ctx, type EssayRow, num, parseJson } from '../context';
import { saveUploadedImage } from '../drive';
import { sendEmail } from '../email';
import { assignmentEmail } from '../emailTemplates';
import type { ActionDef } from '../router';
import type { Row } from '../schema';
import { Reader } from '../validate';
import { deadlineAt, essayDetail, scoreView } from '../views';
import { checkImage } from '../../../shared/image';

type AssignmentRow = Row<'Assignments'>;
export type AssignmentStudentStatus =
  'not_started' | 'in_progress' | 'submitted' | 'over_time' | 'missed';

function classIds(a: AssignmentRow): string[] {
  return parseJson<string[]>(a.class_ids, []);
}
function studentIds(a: AssignmentRow): string[] {
  return parseJson<string[]>(a.student_ids, []);
}

export function isEligible(a: AssignmentRow, user: Row<'Users'>): boolean {
  return classIds(a).includes(user.class) || studentIds(a).includes(user.id);
}

export function assignedStudents(ctx: Ctx, a: AssignmentRow): Row<'Users'>[] {
  return ctx.db.find('Users', (u) => u.role !== 'admin' && isEligible(a, u));
}

function essayFor(ctx: Ctx, assignmentId: string, studentId: string): EssayRow | undefined {
  return ctx.db.findOne(
    'Essays',
    (e) => e.assignment_id === assignmentId && e.student_id === studentId,
  );
}

/** "missed" is set automatically once the close time passes with no attempt. */
export function assignmentStatus(
  ctx: Ctx,
  a: AssignmentRow,
  essay: EssayRow | undefined,
): AssignmentStudentStatus {
  if (!essay) return Date.parse(a.closes_at) <= ctx.now.getTime() ? 'missed' : 'not_started';
  if (essay.status === 'draft') {
    // Started but nothing was handed in before the time ran out.
    const deadline = deadlineAt(ctx, essay);
    const expired =
      deadline &&
      ctx.now.getTime() > Date.parse(deadline) + OVER_TIME_GRACE_SECONDS * 1000 &&
      ctx.now.getTime() >= Date.parse(a.closes_at);
    return expired ? 'missed' : 'in_progress';
  }
  return bool(essay.over_time) ? 'over_time' : 'submitted';
}

function loadAssignment(ctx: Ctx, id: string): AssignmentRow {
  const a = ctx.db.byId('Assignments', id);
  if (!a) throw new ApiError('not_found', 'Assignment not found.');
  return a;
}

function mine(ctx: Ctx, user: AuthUser) {
  return ctx.db
    .find('Assignments', (a) => isEligible(a, user.row))
    .map((a) => {
      const essay = essayFor(ctx, a.id, user.id);
      // Prompt, topic and image stay hidden until the student starts the test.
      return {
        id: a.id,
        title: a.title,
        taskType: a.task_type as TaskType,
        timeLimitMinutes: num(a.time_limit_minutes) ?? TIME_LIMITS[a.task_type as TaskType],
        opensAt: a.opens_at,
        closesAt: a.closes_at,
        createdAt: a.created_at,
        status: assignmentStatus(ctx, a, essay),
        essayId: essay?.id ?? null,
        isOpen:
          Date.parse(a.opens_at) <= ctx.now.getTime() &&
          ctx.now.getTime() < Date.parse(a.closes_at),
      };
    })
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

function start(ctx: Ctx, payload: unknown, user: AuthUser) {
  const r = new Reader(payload);
  const id = r.id('id');
  r.done();
  const a = loadAssignment(ctx, id);
  authorize('assignments.start', user, {
    type: 'assignment',
    assignment: a,
    eligible: isEligible(a, user.row),
  });
  const existing = essayFor(ctx, a.id, user.id);
  if (existing) {
    if (existing.status !== 'draft') {
      throw new ApiError('conflict', 'You have already submitted this test.');
    }
    // One attempt: the timer kept running while the student was away.
    return essayDetail(ctx, existing);
  }
  const nowMs = ctx.now.getTime();
  if (nowMs < Date.parse(a.opens_at)) throw new ApiError('conflict', 'This test is not open yet.');
  if (nowMs >= Date.parse(a.closes_at)) throw new ApiError('conflict', 'This test has closed.');
  const essay = ctx.db.insert('Essays', {
    id: ctx.svc.uuid(),
    student_id: user.id,
    mode: 'assigned',
    assignment_id: a.id,
    started_at: ctx.nowIso,
    auto_submitted: false,
    over_time: false,
    paste_attempts: 0,
    task_type: a.task_type,
    topic_id: a.topic_id,
    diagram_type: a.diagram_type,
    essay_type: a.essay_type,
    prompt: a.prompt,
    body: '',
    word_count: 0,
    image_file_id: a.image_file_id,
    status: 'draft',
    saved_at: ctx.nowIso,
  });
  return essayDetail(ctx, essay);
}

function create(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const title = r.str('title', { max: LIMITS.title, min: 3 });
  const taskType = r.oneOf('taskType', TASK_TYPES) as TaskType;
  const category = readCategory(ctx, r, taskType, { activeTopicsOnly: false });
  const prompt = r.str('prompt', { max: LIMITS.prompt, min: 10 });
  const classes = r.ids('classIds');
  const students = r.ids('studentIds');
  const opensAt = r.isoTime('opensAt');
  const closesAt = r.isoTime('closesAt');
  const minutes = r.int('timeLimitMinutes', { min: 5, max: 180, optional: true });
  const emailStudents = r.bool('emailStudents');
  const imageReader = r.object('image', true);
  let image: { base64: string; mimeType: string; name: string } | null = null;
  if (imageReader) {
    image = {
      base64: imageReader.str('base64', { max: 7_100_000 }),
      mimeType: imageReader.str('mimeType', { max: 20 }),
      name: 'assignment-chart',
    };
    r.absorb('image', imageReader);
    const problem = image.base64 && image.mimeType ? checkImage(image) : null;
    if (problem) r.addError('image', problem);
  }
  if (classes.length === 0 && students.length === 0) {
    r.addError('classIds', 'Choose at least one class or student');
  }
  for (const c of classes) if (!ctx.db.byId('Classes', c)) r.addError('classIds', 'Unknown class');
  for (const s of students)
    if (!ctx.db.byId('Users', s)) r.addError('studentIds', 'Unknown student');
  if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) {
    r.addError('closesAt', 'Close time must be after the open time');
  }
  if (taskType === 'task1_academic' && !image)
    r.addError('image', 'Task 1 Academic needs a chart image');
  if (taskType === 'task2' && image) r.addError('image', 'Task 2 has no image');
  r.done();

  const imageId = image ? saveUploadedImage(ctx, image) : '';
  const a = ctx.db.insert('Assignments', {
    id: ctx.svc.uuid(),
    title,
    task_type: taskType,
    ...categoryColumns(category),
    prompt,
    image_file_id: imageId,
    class_ids: JSON.stringify(classes),
    student_ids: JSON.stringify(students),
    opens_at: opensAt,
    closes_at: closesAt,
    time_limit_minutes: minutes ?? TIME_LIMITS[taskType],
    email_students: emailStudents,
    created_at: ctx.nowIso,
  });
  const outcomes: Record<string, number> = {};
  if (emailStudents) {
    for (const s of assignedStudents(ctx, a)) {
      const outcome = sendEmail(ctx, assignmentNoticeJob(ctx, a, s));
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
  }
  return { id: a.id, emails: outcomes };
}

export function assignmentNoticeJob(ctx: Ctx, a: AssignmentRow, student: Row<'Users'>) {
  return {
    type: 'assignment_notice' as const,
    refId: a.id,
    version: student.id,
    userId: student.id,
    to: student.email,
    build: () =>
      assignmentEmail({
        to: student.email,
        name: student.name,
        title: a.title,
        taskTypeLabel: TASK_TYPE_LABELS[a.task_type as TaskType],
        minutes: num(a.time_limit_minutes) ?? TIME_LIMITS[a.task_type as TaskType],
        closes: formatForEmail(ctx, a.closes_at, student.timezone),
        url: appUrl(ctx, '/assigned'),
      }),
  };
}

export function formatForEmail(ctx: Ctx, iso: string, timeZone: string): string {
  const tz = timeZone || 'Asia/Ho_Chi_Minh';
  const d = new Date(iso);
  const local = new Date(d.getTime() + ctx.svc.tzOffsetMinutes(d, tz) * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} (${tz})`;
}

function adminList(ctx: Ctx) {
  return ctx.db
    .all('Assignments')
    .map((a) => {
      const students = assignedStudents(ctx, a);
      const counts: Record<AssignmentStudentStatus, number> = {
        not_started: 0,
        in_progress: 0,
        submitted: 0,
        over_time: 0,
        missed: 0,
      };
      for (const s of students) counts[assignmentStatus(ctx, a, essayFor(ctx, a.id, s.id))]++;
      return {
        id: a.id,
        title: a.title,
        taskType: a.task_type,
        opensAt: a.opens_at,
        closesAt: a.closes_at,
        timeLimitMinutes: num(a.time_limit_minutes),
        createdAt: a.created_at,
        students: students.length,
        counts,
      };
    })
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

function adminGet(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const id = r.id('id');
  r.done();
  const a = loadAssignment(ctx, id);
  const classLabels = new Map(ctx.db.all('Classes').map((c) => [c.id, c.label]));
  return {
    id: a.id,
    title: a.title,
    taskType: a.task_type,
    topicId: a.topic_id,
    diagramType: a.diagram_type,
    essayType: a.essay_type,
    prompt: a.prompt,
    hasImage: Boolean(a.image_file_id),
    classIds: classIds(a),
    classLabels: classIds(a).map((c) => classLabels.get(c) ?? c),
    studentIds: studentIds(a),
    opensAt: a.opens_at,
    closesAt: a.closes_at,
    timeLimitMinutes: num(a.time_limit_minutes),
    emailStudents: bool(a.email_students),
    students: assignedStudents(ctx, a).map((s) => {
      const essay = essayFor(ctx, a.id, s.id);
      const score = essay?.status === 'scored' ? scoreView(ctx, essay.id) : null;
      return {
        studentId: s.id,
        name: s.name,
        className: classLabels.get(s.class) ?? '',
        status: assignmentStatus(ctx, a, essay),
        essayId: essay?.id ?? null,
        essayStatus: essay?.status ?? null,
        submittedAt: essay?.submitted_at || null,
        score,
      };
    }),
  };
}

export const assignmentActions: Record<string, ActionDef> = {
  'assignments.mine': { write: false, handler: (ctx, _p, user) => mine(ctx, user!) },
  'assignments.start': { write: true, handler: (ctx, p, user) => start(ctx, p, user!) },
  'admin.assignments.create': { write: true, handler: (ctx, p) => create(ctx, p) },
  'admin.assignments.list': { write: false, handler: (ctx) => adminList(ctx) },
  'admin.assignments.get': { write: false, handler: (ctx, p) => adminGet(ctx, p) },
  'admin.assignments.image': {
    write: false,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const id = r.id('id');
      r.done();
      const a = loadAssignment(ctx, id);
      if (!a.image_file_id) throw new ApiError('not_found', 'No image');
      const f = ctx.svc.drive.readFile(a.image_file_id);
      return { mimeType: f.mimeType, base64: f.base64 };
    },
  },
};
