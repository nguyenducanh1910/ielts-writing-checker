// What an essay is about: Task 1 Academic has a diagram type; Task 2 has a
// topic and an essay type. Older essays (saved before diagram and essay types
// existed) may only have a topic; they keep working.
import {
  DIAGRAM_TYPE_IDS,
  type DiagramType,
  diagramTypeLabel,
  ESSAY_TYPE_IDS,
  essayCategoryLabel,
  type EssayType,
  type TaskType,
} from '../../shared/constants';
import { bool, type Ctx, type EssayRow } from './context';
import type { Reader } from './validate';

export interface Category {
  topicId: string;
  diagramType: DiagramType | '';
  essayType: EssayType | '';
}

/** Read and validate the category fields for a task type. */
export function readCategory(
  ctx: Ctx,
  r: Reader,
  taskType: TaskType | '',
  options: { activeTopicsOnly: boolean },
): Category {
  if (taskType === 'task1_academic') {
    return {
      topicId: '',
      diagramType: r.oneOf('diagramType', DIAGRAM_TYPE_IDS) as DiagramType | '',
      essayType: '',
    };
  }
  if (taskType === 'task2') {
    const topicId = r.id('topicId');
    if (
      topicId &&
      !ctx.db.findOne(
        'Topics',
        (t) => t.id === topicId && (!options.activeTopicsOnly || bool(t.active)),
      )
    ) {
      r.addError('topicId', 'Choose a topic from the list');
    }
    return {
      topicId,
      diagramType: '',
      essayType: r.oneOf('essayType', ESSAY_TYPE_IDS) as EssayType | '',
    };
  }
  return { topicId: '', diagramType: '', essayType: '' };
}

/** Columns to store for a category. */
export function categoryColumns(c: Category) {
  return { topic_id: c.topicId, diagram_type: c.diagramType, essay_type: c.essayType };
}

/** The topic's label, or '' when there is none (Task 1 Academic). */
export function topicName(ctx: Ctx, topicId: string): string {
  return topicId ? (ctx.db.byId('Topics', topicId)?.label ?? '') : '';
}

/** "Process" for Task 1 Academic, "Education · Discussion" for Task 2. */
export function essayLabel(ctx: Ctx, essay: EssayRow): string {
  return essayCategoryLabel({
    taskType: essay.task_type,
    topic: topicName(ctx, essay.topic_id),
    diagramType: essay.diagram_type,
    essayType: essay.essay_type,
  });
}

/** The part of the Drive folder name after the task type: diagram type or topic. */
export function folderSubject(ctx: Ctx, essay: EssayRow): string {
  if (essay.task_type === 'task1_academic') {
    return diagramTypeLabel(essay.diagram_type) || topicName(ctx, essay.topic_id) || 'Task 1';
  }
  return topicName(ctx, essay.topic_id) || 'Other';
}

/** True when the essay has what its task type needs (old essays may only have a topic). */
export function hasCategory(essay: EssayRow): boolean {
  return essay.task_type === 'task1_academic'
    ? Boolean(essay.diagram_type || essay.topic_id)
    : Boolean(essay.topic_id);
}
