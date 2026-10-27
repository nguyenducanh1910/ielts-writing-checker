import { TASK_TYPE_LABELS, type TaskType } from './constants';

/** Remove characters that Drive or common file systems reject, and tidy spaces. */
export function sanitizeDriveName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  );
}

/** "{Student name} - {Task type} - {Topic} - {YYYY-MM-DD}" plus " - Rewrite" for rewrites. */
export function essayFolderName(input: {
  studentName: string;
  taskType: TaskType;
  topic: string;
  date: string;
  rewrite: boolean;
}): string {
  const parts = [
    sanitizeDriveName(input.studentName) || 'Student',
    TASK_TYPE_LABELS[input.taskType],
    sanitizeDriveName(input.topic) || 'Other',
    input.date,
  ];
  if (input.rewrite) parts.push('Rewrite');
  return sanitizeDriveName(parts.join(' - '));
}

/** Append " (2)", " (3)" … until the name is not taken. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!set.has(candidate)) return candidate;
  }
}
