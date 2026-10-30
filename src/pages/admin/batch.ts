// Batch scoring with Claude (Task 2 only): copy up to BATCH_MAX essays as one message for the
// Claude Project, then paste Claude's whole answer once. Each essay gets its own Claude draft,
// which its scoring page shows ready for "Load into form". Task 1 essays need their chart image
// in the chat, so they are still scored one by one.
import {
  BATCH_MAX,
  type BatchEssayInput,
  batchRef,
  buildBatchClaudePrompt,
  parseBatchReply,
} from '../../../shared/claude';
import { api } from '../../api';
import { type Child, h, replace } from '../../dom';
import { copyText } from '../../ui/clipboard';
import { busy, errorBox, errorMessage, field, link, notice, toast } from '../../ui/components';
import { formatBand } from '../../ui/format';
import type { QueueItem } from './types';

interface SavedDraft {
  essayId: string;
  createdAt: string;
  errors: number;
  unplaced: number;
}

export function canBatch(item: QueueItem): boolean {
  return item.taskType === 'task2' && item.queueStatus !== 'scored';
}

/** The batch panel plus a checkbox for each row that can join a batch. */
export function batchScoring(items: QueueItem[], reload: () => void) {
  const selected = new Set<string>();
  const boxes = new Map<string, HTMLInputElement>();
  const count = h('span', { class: 'hint', 'aria-live': 'polite' });
  const copyBtn = h(
    'button',
    { type: 'button', class: 'btn btn-primary' },
    'Copy batch for Claude',
  );
  const copyStatus = h('div', { 'aria-live': 'polite' });

  const refresh = () => {
    count.textContent = `${selected.size} of ${BATCH_MAX} selected`;
    copyBtn.disabled = selected.size === 0;
    for (const box of boxes.values()) box.disabled = !box.checked && selected.size >= BATCH_MAX;
  };

  const checkbox = (item: QueueItem): Child => {
    if (!canBatch(item)) return null;
    const box = h('input', {
      type: 'checkbox',
      'aria-label': `Add ${item.studentName}, ${item.topic} to the batch`,
    });
    box.addEventListener('change', () => {
      if (box.checked) selected.add(item.id);
      else selected.delete(item.id);
      refresh();
    });
    boxes.set(item.id, box);
    return box;
  };

  copyBtn.addEventListener('click', () =>
    busy(copyBtn, 'Preparing…', async () => {
      replace(copyStatus);
      // Keep the queue order (oldest first) so Claude's answer comes back in a predictable order.
      const essayIds = items.filter((i) => selected.has(i.id)).map((i) => i.id);
      let text: string;
      try {
        const res = await api<{ essays: BatchEssayInput[] }>('admin.batchPrompt', { essayIds });
        text = buildBatchClaudePrompt(res.essays);
      } catch (err) {
        replace(copyStatus, errorBox(err));
        return;
      }
      const done = () =>
        replace(
          copyStatus,
          notice(
            'success',
            `Copied ${essayIds.length} essay(s). Paste them into a new chat in your Claude Project, then paste Claude’s whole answer below.`,
          ),
        );
      try {
        await copyText(text);
        done();
      } catch {
        // Some browsers only allow copying right after a click; the request above took too long.
        const again = h('button', { type: 'button', class: 'btn btn-primary' }, 'Copy now');
        again.addEventListener('click', async () => {
          try {
            await copyText(text);
            done();
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        });
        replace(copyStatus, notice('info', 'The batch is ready. ', again));
      }
    }),
  );

  const answer = h('textarea', {
    rows: '8',
    maxlength: '100000',
    placeholder: 'Paste Claude’s whole JSON answer here',
  });
  const saveBtn = h(
    'button',
    { type: 'button', class: 'btn btn-primary' },
    'Check and save drafts',
  );
  const result = h('div', { 'aria-live': 'polite' });

  saveBtn.addEventListener('click', () => {
    const parsed = parseBatchReply(answer.value);
    if (!parsed.ok) {
      replace(
        result,
        notice(
          'error',
          h('p', null, h('strong', null, 'The answer is not valid. Nothing was saved.')),
          h('ul', null, ...parsed.errors.map((e) => h('li', null, e))),
        ),
      );
      return;
    }
    const byRef = new Map(items.map((i) => [batchRef(i.id), i]));
    const lines: Child[] = [];
    const drafts: { essayId: string; rawText: string }[] = [];
    const draftFor = new Map<string, { item: QueueItem; overall: number }>();
    for (const it of parsed.items) {
      const item = byRef.get(it.ref);
      if (!item) {
        lines.push(
          h(
            'li',
            null,
            `Essay ${it.ref || '(no code)'}: not in this queue view. Clear the filters and paste again.`,
          ),
        );
      } else if (!it.result.ok) {
        lines.push(
          h('li', null, `${item.studentName} (${item.topic}): ${it.result.errors.join(' ')}`),
        );
      } else {
        drafts.push({ essayId: item.id, rawText: it.rawText });
        draftFor.set(item.id, { item, overall: it.result.value.overall });
      }
    }
    const problems = lines.length
      ? notice(
          'error',
          h('p', null, h('strong', null, 'These results were not saved:')),
          h('ul', null, ...lines),
        )
      : null;
    if (!drafts.length) {
      replace(result, problems);
      return;
    }
    void busy(saveBtn, 'Saving…', async () => {
      try {
        const res = await api<{ saved: SavedDraft[] }>('admin.saveClaudeDrafts', { drafts });
        const ok = res.saved.map((s) => {
          const d = draftFor.get(s.essayId)!;
          const suspicious = s.errors > 0 && s.unplaced * 2 > s.errors;
          return h(
            'li',
            null,
            `${d.item.studentName} (${d.item.topic}): band ${formatBand(d.overall)}, ${s.errors} error(s)`,
            s.unplaced ? `, ${s.unplaced} not found in the essay` : '',
            '. ',
            suspicious
              ? h(
                  'strong',
                  null,
                  'Most excerpts are not in this essay: check that this answer belongs to it. ',
                )
              : null,
            link(`/admin/score/${s.essayId}`, 'Score'),
          );
        });
        answer.value = '';
        replace(copyStatus);
        const refreshBtn = h('button', { type: 'button', class: 'btn' }, 'Refresh the queue');
        refreshBtn.addEventListener('click', reload);
        replace(
          result,
          notice(
            'success',
            h('p', null, h('strong', null, `Saved ${ok.length} Claude draft(s).`)),
            h('ul', null, ...ok),
            h('p', null, 'Open each essay to load its draft into the form, review and send.'),
            refreshBtn,
          ),
          problems,
        );
        selected.clear();
        for (const box of boxes.values()) box.checked = false;
        refresh();
      } catch (err) {
        replace(result, errorBox(err), problems);
      }
    });
  });

  refresh();
  const panel = h(
    'details',
    { class: 'card batch-panel' },
    h('summary', null, h('strong', null, 'Batch scoring with Claude (Task 2)')),
    h(
      'p',
      { class: 'hint' },
      `Tick up to ${BATCH_MAX} Task 2 essays in the table, copy them as one message for your Claude Project, then paste Claude’s whole answer here. Each essay gets its own Claude draft to review on its scoring page. Task 1 essays need their chart image, so score them one by one.`,
    ),
    h('div', { class: 'actions' }, copyBtn, count),
    copyStatus,
    field({ label: 'Claude’s batch answer', control: answer }),
    h('div', { class: 'actions' }, saveBtn),
    result,
  );
  return { panel, checkbox };
}
