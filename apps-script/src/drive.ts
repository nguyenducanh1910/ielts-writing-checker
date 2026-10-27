// Google Drive archive: one folder per submitted essay, plus chart images.
import { TASK_TYPE_LABELS, type TaskType } from '../../shared/constants';
import { localDateString } from '../../shared/dates';
import { essayFolderName, uniqueName } from '../../shared/folderName';
import { essayTypeLabel } from '../../shared/constants';
import { folderSubject } from './category';
import { adminTimezone, type Ctx, type EssayRow } from './context';

const UPLOADS_FOLDER = '_uploads';

function rootId(ctx: Ctx): string {
  const id = ctx.svc.props.DRIVE_ROOT_FOLDER_ID;
  if (!id) throw new Error('DRIVE_ROOT_FOLDER_ID Script Property is not set');
  return id;
}

/** Images are saved here until the essay is submitted and gets its own folder. */
export function saveUploadedImage(
  ctx: Ctx,
  image: { base64: string; mimeType: string; name: string },
): string {
  const folderId = ctx.svc.drive.ensureFolder(rootId(ctx), UPLOADS_FOLDER);
  return ctx.svc.drive.saveFile(folderId, image.name, image.mimeType, image.base64);
}

export function expectedFolderName(ctx: Ctx, essay: EssayRow): string {
  const student = ctx.db.byId('Users', essay.student_id);
  const submitted = essay.submitted_at ? new Date(essay.submitted_at) : ctx.now;
  return essayFolderName({
    studentName: student?.name ?? 'Student',
    taskType: essay.task_type as TaskType,
    topic: folderSubject(ctx, essay),
    date: localDateString(submitted, adminTimezone(ctx), ctx.svc.tzOffsetMinutes),
    rewrite: Boolean(essay.parent_essay_id),
  });
}

/**
 * True when the essay's image belongs to something else as well: the
 * assignment it came from, or the original essay of a rewrite. Shared images
 * are copied into the essay folder instead of moved, and never trashed.
 */
export function isSharedImage(ctx: Ctx, essay: EssayRow): boolean {
  if (!essay.image_file_id) return false;
  if (
    essay.assignment_id &&
    ctx.db.byId('Assignments', essay.assignment_id)?.image_file_id === essay.image_file_id
  ) {
    return true;
  }
  return ctx.db
    .all('Essays')
    .some((other) => other.id !== essay.id && other.image_file_id === essay.image_file_id);
}

/**
 * Copy a submitted essay to Drive. Safe to call again after a failure: the
 * folder ID is stored as soon as the folder exists, so a retry reuses it.
 * Never throws; returns the resulting sync status.
 */
export function archiveEssay(ctx: Ctx, essayId: string): 'ok' | 'failed' {
  const drive = ctx.svc.drive;
  try {
    let essay = ctx.db.byId('Essays', essayId);
    if (!essay) throw new Error('Essay not found');
    let folderId = essay.drive_folder_id;
    if (!folderId) {
      const parent = rootId(ctx);
      const name = uniqueName(expectedFolderName(ctx, essay), drive.listFolderNames(parent));
      folderId = drive.createFolder(parent, name);
      ctx.db.update('Essays', (r) => r.id === essayId, { drive_folder_id: folderId });
      essay = { ...essay, drive_folder_id: folderId };
    }
    if (essay.task_type === 'task1_academic' && essay.image_file_id) {
      if (isSharedImage(ctx, essay)) {
        drive.copyFile(essay.image_file_id, folderId, 'Chart image');
      } else {
        drive.moveFile(essay.image_file_id, folderId);
      }
    }
    drive.createDoc(folderId, `Essay - ${TASK_TYPE_LABELS[essay.task_type as TaskType]}`, [
      `Task type: ${TASK_TYPE_LABELS[essay.task_type as TaskType]}`,
      essay.task_type === 'task1_academic'
        ? `Diagram type: ${folderSubject(ctx, essay)}`
        : `Topic: ${folderSubject(ctx, essay)} · Essay type: ${essayTypeLabel(essay.essay_type) || '–'}`,
      `Mode: ${essay.mode}`,
      `Submitted: ${essay.submitted_at}`,
      `Word count: ${essay.word_count}`,
      '',
      'Prompt',
      essay.prompt,
      '',
      'Essay',
      essay.body,
    ]);
    ctx.db.update('Essays', (r) => r.id === essayId, { drive_sync_status: 'ok' });
    return 'ok';
  } catch (err) {
    ctx.svc.log(`Drive archive failed for ${essayId}: ${(err as Error).message}`);
    ctx.db.update('Essays', (r) => r.id === essayId, { drive_sync_status: 'failed' });
    return 'failed';
  }
}

/** Rename the essay folder after a topic change (keeps any " (n)" suffix rule). */
export function renameEssayFolder(ctx: Ctx, essayId: string): void {
  const essay = ctx.db.byId('Essays', essayId);
  if (!essay?.drive_folder_id) return;
  try {
    const drive = ctx.svc.drive;
    const current = drive.getFolderName(essay.drive_folder_id);
    const base = expectedFolderName(ctx, essay);
    if (current === base || current.startsWith(`${base} (`)) return;
    const taken = drive.listFolderNames(rootId(ctx)).filter((n) => n !== current);
    drive.renameFolder(essay.drive_folder_id, uniqueName(base, taken));
  } catch (err) {
    ctx.svc.log(`Folder rename failed for ${essayId}: ${(err as Error).message}`);
  }
}

export function trashEssayFiles(ctx: Ctx, essay: EssayRow): void {
  try {
    if (essay.drive_folder_id) ctx.svc.drive.trashFolder(essay.drive_folder_id);
    else if (essay.image_file_id && !isSharedImage(ctx, essay)) {
      ctx.svc.drive.trashFile(essay.image_file_id);
    }
  } catch (err) {
    ctx.svc.log(`Trash failed for ${essay.id}: ${(err as Error).message}`);
  }
}
