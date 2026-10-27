// Admin: add an essay for scoring (paper essays, essays sent by message…).
import { MIN_WORDS, TASK_TYPE_LABELS, type TaskType } from '../../../shared/constants';
import { countWords } from '../../../shared/wordCount';
import { api, ApiClientError } from '../../api';
import { h, replace } from '../../dom';
import { navigate, setUnsavedCheck } from '../../router';
import { getConfig } from '../../state';
import {
  async,
  busy,
  errorBox,
  errorMessage,
  field,
  link,
  notice,
  page,
  selectEl,
  showFieldErrors,
  toast,
} from '../../ui/components';
import { categoryFields } from '../../ui/categoryFields';
import { readEssayFile } from '../../ui/docx';
import { type PickedImage, readImageFile } from '../../ui/image';

interface StudentOption {
  id: string;
  name: string;
  email: string;
  className: string;
}

const NEW_STUDENT = '__new__';

export function addEssayPage(): Node {
  return page(
    'Add an essay',
    h(
      'p',
      null,
      'Add an essay that was not submitted through the website, for example one written on paper. It is saved to Drive and joins the ',
      link('/admin', 'scoring queue'),
      ' like any other essay. It does not count toward the student’s daily limit.',
    ),
    async(
      async () => {
        const [config, students] = await Promise.all([
          getConfig(),
          api<StudentOption[]>('admin.students'),
        ]);
        return { config, students };
      },
      ({ config, students }) => {
        let image: PickedImage | null = null;
        let dirty = false;
        setUnsavedCheck(() => dirty);

        const studentSel = selectEl(
          'studentId',
          [
            ...students.map((s) => ({
              value: s.id,
              label: `${s.name}${s.className ? ` (${s.className})` : ''}${s.email ? '' : ' – no email'}`,
            })),
            { value: NEW_STUDENT, label: '+ New student…' },
          ],
          '',
          'Choose a student',
        );
        const newName = h('input', {
          name: 'newStudent.name',
          maxlength: '80',
          autocomplete: 'off',
        });
        const newEmail = h('input', {
          type: 'email',
          name: 'newStudent.email',
          autocomplete: 'off',
        });
        const newClass = selectEl(
          'newStudent.classId',
          config.classes.map((c) => ({ value: c.id, label: c.label })),
          '',
          'No class',
        );
        const newStudentBox = h(
          'fieldset',
          { class: 'card', hidden: true },
          h('legend', null, 'New student'),
          field({ label: 'Full name', control: newName, name: 'newStudent.name' }),
          field({
            label: 'Email (optional)',
            control: newEmail,
            name: 'newStudent.email',
            hint: 'With an email, the student can log in to see the result and gets the result email. Without one, only you see it.',
          }),
          field({ label: 'Class', control: newClass, name: 'newStudent.classId' }),
        );
        const studentHint = h('p', { class: 'hint', 'aria-live': 'polite' });
        const syncStudent = () => {
          newStudentBox.hidden = studentSel.value !== NEW_STUDENT;
          const s = students.find((x) => x.id === studentSel.value);
          studentHint.textContent =
            s && !s.email
              ? 'This student has no email address, so no result email will be sent.'
              : '';
        };
        studentSel.addEventListener('change', syncStudent);

        const taskSel = selectEl(
          'taskType',
          Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          'task2',
        );
        const category = categoryFields(config.topics);
        const prompt = h('textarea', { name: 'prompt', rows: '4', maxlength: '4000' });
        const imageInput = h('input', {
          type: 'file',
          name: 'image',
          accept: 'image/png,image/jpeg',
        });
        const imageField = field({
          label: 'Chart or diagram image (PNG or JPG, max 5 MB)',
          control: imageInput,
          name: 'image',
          hint: 'Required for Task 1 Academic.',
        });
        const testDate = h('input', { type: 'date', name: 'testDate' });
        const fileInput = h('input', { type: 'file', name: 'file', accept: '.txt,.docx' });
        const fileStatus = h('p', { class: 'hint', 'aria-live': 'polite' });
        const body = h('textarea', {
          name: 'body',
          rows: '16',
          class: 'essay-input',
          spellcheck: 'false',
        });
        const words = h('p', { class: 'word-count', 'aria-live': 'polite' });
        const updateWords = () => {
          const n = countWords(body.value);
          const min = MIN_WORDS[taskSel.value as TaskType];
          words.textContent = `${n} word${n === 1 ? '' : 's'}${n > 0 && n < min ? ` · below the ${min}-word minimum for ${TASK_TYPE_LABELS[taskSel.value as TaskType]}` : ''}`;
        };
        const syncTask = () => {
          imageField.hidden = taskSel.value !== 'task1_academic';
          category.setTaskType(taskSel.value);
          updateWords();
        };
        taskSel.addEventListener('change', syncTask);
        body.addEventListener('input', () => {
          dirty = true;
          updateWords();
        });
        for (const el of [prompt, newName, newEmail])
          el.addEventListener('input', () => (dirty = true));

        fileInput.addEventListener('change', async () => {
          const file = fileInput.files?.[0];
          if (!file) return;
          fileStatus.textContent = `Reading ${file.name}…`;
          try {
            const text = await readEssayFile(file);
            if (
              body.value.trim() &&
              !window.confirm('Replace the essay text with the file’s text?')
            ) {
              fileStatus.textContent = '';
              return;
            }
            body.value = text;
            dirty = true;
            updateWords();
            fileStatus.textContent = `Loaded ${file.name}. Check the text below; tidy it if needed.`;
          } catch (err) {
            fileStatus.textContent = '';
            showFieldErrors(form, { file: errorMessage(err) });
          } finally {
            fileInput.value = '';
          }
        });
        imageInput.addEventListener('change', async () => {
          const file = imageInput.files?.[0];
          if (!file) return;
          try {
            image = await readImageFile(file);
            showFieldErrors(form, {});
          } catch (err) {
            image = null;
            imageInput.value = '';
            showFieldErrors(form, { image: errorMessage(err) });
          }
        });

        const status = h('div', { 'aria-live': 'polite' });
        const scoreBtn = h(
          'button',
          { type: 'submit', class: 'btn btn-primary', value: 'score' },
          'Add and score now',
        );
        const anotherBtn = h(
          'button',
          { type: 'submit', class: 'btn', value: 'another' },
          'Add and add another',
        );
        const form = h(
          'form',
          { class: 'card editor', novalidate: true },
          h(
            'div',
            { class: 'field', dataset: { field: 'studentId' } },
            h('label', { for: 'add-student' }, 'Student'),
            Object.assign(studentSel, { id: 'add-student' }),
            studentHint,
            h('p', { class: 'field-error', 'aria-live': 'polite' }),
          ),
          newStudentBox,
          h(
            'div',
            { class: 'grid-3' },
            field({ label: 'Task type', control: taskSel, name: 'taskType' }),
            ...category.fields,
          ),
          field({ label: 'Task prompt', control: prompt, name: 'prompt' }),
          imageField,
          field({ label: 'Date written (optional)', control: testDate, name: 'testDate' }),
          field({
            label: 'Load the essay from a file (optional)',
            control: fileInput,
            name: 'file',
            hint: '.txt or .docx (Word). Or paste the text below.',
          }),
          fileStatus,
          field({ label: 'Essay text', control: body, name: 'body' }),
          words,
          h('div', { class: 'actions' }, scoreBtn, anotherBtn),
          status,
        );
        syncTask();

        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
          const next = submitter?.value === 'another' ? 'another' : 'score';
          const errors: Record<string, string> = {};
          const isNew = studentSel.value === NEW_STUDENT;
          if (!studentSel.value) errors.studentId = 'Choose a student or add a new one';
          if (isNew && newName.value.trim().length < 2)
            errors['newStudent.name'] = 'Enter the student’s name';
          Object.assign(errors, category.errors());
          if (prompt.value.trim().length < 10) errors.prompt = 'Enter the task prompt';
          if (!body.value.trim()) errors.body = 'Paste the essay or load it from a file';
          if (taskSel.value === 'task1_academic' && !image)
            errors.image = 'Attach the chart or diagram image';
          showFieldErrors(form, errors);
          if (Object.keys(errors).length) return;
          const button = next === 'another' ? anotherBtn : scoreBtn;
          void busy(button, 'Saving to Drive…', async () => {
            try {
              const res = await api<{ essayId: string; studentId: string; driveStatus: string }>(
                'admin.essays.create',
                {
                  studentId: isNew ? undefined : studentSel.value,
                  newStudent: isNew
                    ? {
                        name: newName.value,
                        email: newEmail.value || undefined,
                        classId: newClass.value || undefined,
                      }
                    : undefined,
                  taskType: taskSel.value,
                  ...category.values(),
                  prompt: prompt.value,
                  body: body.value,
                  testDate: testDate.value || undefined,
                  image: taskSel.value === 'task1_academic' ? (image ?? undefined) : undefined,
                },
              );
              dirty = false;
              const driveNote =
                res.driveStatus === 'ok' ? '' : ' Drive copy failed; retry it from the queue.';
              if (next === 'score') {
                toast(`Essay added.${driveNote}`);
                navigate(`/admin/score/${res.essayId}`);
                return;
              }
              // Keep the student, task and prompt for the next essay of the same set.
              if (isNew) {
                students.push({
                  id: res.studentId,
                  name: newName.value,
                  email: newEmail.value,
                  className: '',
                });
                studentSel.insertBefore(
                  h('option', { value: res.studentId }, newName.value),
                  studentSel.querySelector(`option[value="${NEW_STUDENT}"]`),
                );
                studentSel.value = res.studentId;
                syncStudent();
              }
              body.value = '';
              updateWords();
              replace(
                status,
                notice(
                  'success',
                  `Essay added to the queue.${driveNote} `,
                  link(`/admin/score/${res.essayId}`, 'Score it now'),
                ),
              );
              body.focus();
            } catch (err) {
              if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
              replace(status, errorBox(err));
            }
          });
        });
        return form;
      },
      'Loading students…',
    ),
  );
}
