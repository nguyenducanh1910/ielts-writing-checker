// The teacher adds an essay for scoring (for example one written on paper or
// sent by message). It joins the normal queue and scoring flow.
import { LIMITS, TASK_TYPES, type TaskType } from '../../../shared/constants';
import { checkImage } from '../../../shared/image';
import { countWords } from '../../../shared/wordCount';
import { categoryColumns, readCategory } from '../category';
import { adminTimezone, type Ctx } from '../context';
import { saveUploadedImage } from '../drive';
import type { ActionDef } from '../router';
import { Reader } from '../validate';
import { finalizeSubmission } from './essays';

function createEssay(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const studentId = r.id('studentId', true);
  const newStudent = r.object('newStudent', true);
  let student = { name: '', email: '', classId: '' };
  if (newStudent) {
    student = {
      name: newStudent.str('name', { max: LIMITS.name, min: 2 }),
      email: newStudent.has('email') ? newStudent.email('email') : '',
      classId: newStudent.id('classId', true),
    };
    r.absorb('newStudent', newStudent);
    if (student.classId && !ctx.db.findOne('Classes', (c) => c.id === student.classId)) {
      r.addError('newStudent.classId', 'Choose a class from the list');
    }
    if (student.email && ctx.db.findOne('Users', (u) => u.email.toLowerCase() === student.email)) {
      r.addError(
        'newStudent.email',
        'A student with this email already exists. Choose them from the list.',
      );
    }
  } else if (!studentId) {
    r.addError('studentId', 'Choose a student or add a new one');
  } else if (!ctx.db.findOne('Users', (u) => u.id === studentId && u.role !== 'admin')) {
    r.addError('studentId', 'Student not found');
  }
  const taskType = r.oneOf('taskType', TASK_TYPES) as TaskType;
  const category = readCategory(ctx, r, taskType, { activeTopicsOnly: true });
  const prompt = r.str('prompt', { max: LIMITS.prompt, min: 10 });
  const body = r.str('body', { max: LIMITS.body, trim: false });
  const testDate = r.date('testDate', true);
  if (body && countWords(body) === 0) r.addError('body', 'The essay is empty');
  const imageR = r.object('image', true);
  let image: { base64: string; mimeType: string; name: string } | null = null;
  if (imageR) {
    image = {
      base64: imageR.str('base64', { max: 7_100_000 }),
      mimeType: imageR.str('mimeType', { max: 20 }),
      name: (imageR.str('name', { max: 120, optional: true }) || 'chart').replace(/[^\w .-]/g, '_'),
    };
    r.absorb('image', imageR);
    const problem = image.base64 && image.mimeType ? checkImage(image) : null;
    if (problem) r.addError('image', problem);
  }
  if (taskType === 'task1_academic' && !image) {
    r.addError('image', 'Task 1 Academic needs the chart or diagram image.');
  }
  if (taskType === 'task2' && image) r.addError('image', 'Task 2 essays do not have an image');
  r.done();

  let ownerId = studentId;
  if (newStudent) {
    // Added by the teacher: no consent time and, without an email, no login.
    ownerId = ctx.svc.uuid();
    ctx.db.insert('Users', {
      id: ownerId,
      name: student.name,
      email: student.email,
      class: student.classId,
      role: 'student',
      target_band: '',
      exam_date: '',
      timezone: adminTimezone(ctx),
      consent_at: '',
      created_at: ctx.nowIso,
    });
  }
  const essay = ctx.db.insert('Essays', {
    id: ctx.svc.uuid(),
    student_id: ownerId,
    parent_essay_id: '',
    mode: 'practice',
    assignment_id: '',
    started_at: '',
    time_used_seconds: '',
    auto_submitted: false,
    over_time: false,
    paste_attempts: 0,
    task_type: taskType,
    ...categoryColumns(category),
    prompt,
    body,
    word_count: countWords(body),
    image_file_id: image ? saveUploadedImage(ctx, image) : '',
    status: 'draft',
    drive_folder_id: '',
    drive_sync_status: '',
    saved_at: ctx.nowIso,
    submitted_at: '',
    scored_at: '',
    test_date: testDate,
    source: 'admin',
  });
  const submitted = finalizeSubmission(ctx, essay, { autoSubmitted: false });
  return {
    essayId: submitted.id,
    studentId: ownerId,
    driveStatus: submitted.drive_sync_status,
  };
}

export const adminUploadActions: Record<string, ActionDef> = {
  'admin.essays.create': { write: true, handler: (ctx, p) => createEssay(ctx, p) },
};
