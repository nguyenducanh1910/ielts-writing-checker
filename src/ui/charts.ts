// Chart.js wrappers. Each chart has a text summary for screen readers and a
// data table fallback, and is destroyed when the page is left.
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  type ChartConfiguration,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { type Child, h } from '../dom';
import { onLeave } from '../router';
import { table } from './components';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Legend,
  Tooltip,
);

export const COLORS = {
  primary: '#ea580c',
  test: '#334155',
  target: '#047857',
  grey: '#6b7280',
  /** Same colours as the error highlights: TA/TR, CC, LR, GRA. */
  criteria: ['#dc2626', '#ea580c', '#2563eb', '#9333ea'],
  palette: ['#ea580c', '#334155', '#047857', '#7c3aed', '#be123c', '#0e7490'],
};

export function chartBox(
  config: ChartConfiguration,
  summary: string,
  data: { headers: string[]; rows: Child[][] },
): HTMLElement {
  const canvas = h('canvas', { role: 'img', 'aria-label': summary });
  const box = h(
    'figure',
    { class: 'chart-figure' },
    h('div', { class: 'chart-box' }, canvas),
    h('details', null, h('summary', null, 'Show data as a table'), table(data.headers, data.rows)),
  );
  // Create after the canvas is attached so Chart.js can measure it.
  requestAnimationFrame(() => {
    if (!canvas.isConnected) return;
    const chart = new Chart(canvas, {
      ...config,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        ...config.options,
      },
    });
    onLeave(() => chart.destroy());
  });
  return box;
}
