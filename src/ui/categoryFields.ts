// Topic / essay type (Task 2) and diagram type (Task 1 Academic) fields,
// shared by every form that creates or edits an essay or assignment.
import { DIAGRAM_TYPES, ESSAY_TYPES } from '../../shared/constants';
import type { Option } from '../types';
import { field, selectEl } from './components';

export interface CategoryValues {
  topicId: string;
  diagramType: string;
  essayType: string;
}

export interface CategoryFields {
  /** Field wrappers to place in a grid next to the task type. */
  fields: HTMLElement[];
  setTaskType(taskType: string): void;
  values(): Partial<CategoryValues>;
  /** Client-side check; the server validates again. */
  errors(): Record<string, string>;
  setValues(v: Partial<CategoryValues>): void;
  disable(): void;
  onChange(fn: () => void): void;
}

export function categoryFields(
  topics: Option[],
  initial: Partial<CategoryValues> = {},
): CategoryFields {
  let taskType = 'task2';
  const topicSel = selectEl(
    'topicId',
    topics.map((t) => ({ value: t.id, label: t.label })),
    initial.topicId ?? '',
    'Choose a topic',
  );
  const essaySel = selectEl(
    'essayType',
    ESSAY_TYPES.map((t) => ({ value: t.id, label: t.label })),
    initial.essayType ?? '',
    'Choose an essay type',
  );
  const diagramSel = selectEl(
    'diagramType',
    DIAGRAM_TYPES.map((t) => ({ value: t.id, label: t.label })),
    initial.diagramType ?? '',
    'Choose a diagram type',
  );
  const topicField = field({ label: 'Topic', control: topicSel, name: 'topicId' });
  const essayField = field({ label: 'Essay type', control: essaySel, name: 'essayType' });
  const diagramField = field({
    label: 'Diagram type',
    control: diagramSel,
    name: 'diagramType',
    hint: 'Dynamic: changes over time · Static: one point in time · Process · Map · Mixed: more than one chart',
  });

  const setTaskType = (t: string) => {
    taskType = t;
    const task1 = t === 'task1_academic';
    topicField.hidden = task1;
    essayField.hidden = task1;
    diagramField.hidden = !task1;
  };
  setTaskType(taskType);

  return {
    fields: [topicField, essayField, diagramField],
    setTaskType,
    values: () =>
      taskType === 'task1_academic'
        ? { diagramType: diagramSel.value }
        : { topicId: topicSel.value, essayType: essaySel.value },
    errors: () => {
      const e: Record<string, string> = {};
      if (taskType === 'task1_academic') {
        if (!diagramSel.value) e.diagramType = 'Choose the diagram type';
      } else {
        if (!topicSel.value) e.topicId = 'Choose a topic';
        if (!essaySel.value) e.essayType = 'Choose the essay type';
      }
      return e;
    },
    setValues: (v) => {
      if (v.topicId !== undefined) topicSel.value = v.topicId;
      if (v.essayType !== undefined) essaySel.value = v.essayType;
      if (v.diagramType !== undefined) diagramSel.value = v.diagramType;
    },
    disable: () => {
      topicSel.disabled = true;
      essaySel.disabled = true;
      diagramSel.disabled = true;
    },
    onChange: (fn) => {
      for (const s of [topicSel, essaySel, diagramSel]) s.addEventListener('change', fn);
    },
  };
}
