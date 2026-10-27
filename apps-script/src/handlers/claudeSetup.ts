// Text the admin copies or uploads to their Claude.ai Project.
import { formatBand } from '../../../shared/band';
import { claudeProjectInstructions } from '../../../shared/claude';
import {
  CRITERIA,
  criterionLabel,
  TASK_TYPE_LABELS,
  type TaskType,
} from '../../../shared/constants';
import { essayLabel } from '../category';
import { bool, type Ctx } from '../context';
import type { ActionDef } from '../router';
import { errorsView, scoreView } from '../views';

export function categoryExport(ctx: Ctx): string {
  const active = ctx.db.find('ErrorCategories', (c) => bool(c.active));
  const lines = ['ERROR CATEGORY LIST', 'Use only these labels in the "category" field.', ''];
  for (const c of CRITERIA) {
    lines.push(`${criterionLabel(c)}:`);
    for (const cat of active.filter((x) => x.criterion === c)) lines.push(`- ${cat.label}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function samplesExport(ctx: Ctx): string {
  const ids = new Set(ctx.db.all('CalibrationSamples').map((s) => s.essay_id));
  const essays = ctx.db.find('Essays', (e) => ids.has(e.id) && e.status === 'scored');
  const parts = [
    'CALIBRATION SAMPLES',
    'Essays scored by the teacher. Use them to match the teacher’s standard.',
    '',
  ];
  essays.forEach((e, i) => {
    const score = scoreView(ctx, e.id);
    if (!score) return;
    const taskType = e.task_type as TaskType;
    parts.push(
      `===== SAMPLE ${i + 1} =====`,
      `Task type: ${TASK_TYPE_LABELS[taskType]}`,
      `${taskType === 'task1_academic' ? 'Diagram type' : 'Topic and essay type'}: ${essayLabel(ctx, e)}`,
      `Prompt: ${e.prompt}`,
      '',
      'Essay:',
      e.body,
      '',
      'Final scores:',
      ...CRITERIA.map((c) => `- ${criterionLabel(c, taskType)}: ${formatBand(score.criteria[c])}`),
      `- Overall: ${formatBand(score.overall)}`,
      '',
      'Feedback:',
      ...CRITERIA.map((c) => `${criterionLabel(c, taskType)}: ${score.feedback[c]}`),
      `General comment: ${score.generalComment}`,
      '',
      'Tagged errors:',
      ...errorsView(ctx, e.id).map((x) => `- [${x.category}] "${x.excerpt}" -> ${x.correction}`),
      '',
    );
  });
  if (essays.length === 0)
    parts.push('(No samples marked yet. Tick "Use as calibration sample" on a scored essay.)');
  return parts.join('\n');
}

export const claudeSetupActions: Record<string, ActionDef> = {
  'admin.claudeSetup': {
    write: false,
    handler: (ctx) => ({
      instructions: claudeProjectInstructions(),
      categories: categoryExport(ctx),
      samples: samplesExport(ctx),
      sampleCount: ctx.db.all('CalibrationSamples').length,
    }),
  },
};
