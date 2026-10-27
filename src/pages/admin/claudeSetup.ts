// Claude setup: Project instructions to copy, and files to upload to the Project.
import { api } from '../../api';
import { h } from '../../dom';
import { async, page, toast } from '../../ui/components';
import { copyText, downloadText } from '../../ui/clipboard';

interface SetupData {
  instructions: string;
  categories: string;
  samples: string;
  sampleCount: number;
}

export function claudeSetupPage(): Node {
  return page(
    'Claude setup',
    async(
      () => api<SetupData>('admin.claudeSetup'),
      (data) => {
        const copyBtn = h(
          'button',
          { type: 'button', class: 'btn btn-primary' },
          'Copy Project instructions',
        );
        copyBtn.addEventListener('click', async () => {
          try {
            await copyText(data.instructions);
            toast('Instructions copied.');
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Copy failed', 'error');
          }
        });
        const catBtn = h(
          'button',
          { type: 'button', class: 'btn' },
          'Download error categories (.txt)',
        );
        catBtn.addEventListener('click', () =>
          downloadText('error-categories.txt', data.categories),
        );
        const sampleBtn = h(
          'button',
          { type: 'button', class: 'btn' },
          `Download calibration samples (${data.sampleCount}) (.txt)`,
        );
        sampleBtn.addEventListener('click', () =>
          downloadText('calibration-samples.txt', data.samples),
        );
        return [
          h(
            'ol',
            { class: 'card prose' },
            h('li', null, 'In Claude.ai, create a Project (for example “IELTS Harper Scoring”).'),
            h('li', null, 'Paste the instructions below into the Project instructions.'),
            h(
              'li',
              null,
              'Upload the two files below as Project files, plus the official band descriptors and any other scoring materials.',
            ),
            h(
              'li',
              null,
              'Re-download and re-upload the files when you change categories or mark new samples.',
            ),
            h(
              'li',
              null,
              'For each essay: press “Copy for Claude” on the scoring page, paste into a new chat in the Project, then paste Claude’s reply into “Paste Claude draft”.',
            ),
          ),
          h('h2', null, 'Project instructions'),
          copyBtn,
          h(
            'pre',
            { class: 'plain-text card', tabindex: '0', 'aria-label': 'Project instructions' },
            data.instructions,
          ),
          h('h2', null, 'Project files'),
          h('div', { class: 'actions' }, catBtn, sampleBtn),
          h(
            'details',
            { class: 'card' },
            h('summary', null, 'Preview error categories'),
            h(
              'pre',
              { class: 'plain-text', tabindex: '0', 'aria-label': 'Error categories' },
              data.categories,
            ),
          ),
          h(
            'details',
            { class: 'card' },
            h('summary', null, 'Preview calibration samples'),
            h(
              'pre',
              { class: 'plain-text', tabindex: '0', 'aria-label': 'Calibration samples' },
              data.samples,
            ),
          ),
        ];
      },
    ),
  );
}
