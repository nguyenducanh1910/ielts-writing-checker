// A student practises their errors before the result unlocks; the teacher sees what happened.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { completePractice } from './practice';

const API = 'http://localhost:8788';

async function post(page: Page, action: string, payload: unknown, token?: string) {
  const res = await page.request.post(`${API}/`, {
    headers: { 'Content-Type': 'text/plain' },
    data: JSON.stringify({ action, payload, token }),
  });
  const body = (await res.json()) as { ok: boolean; data: any };
  expect(body.ok, action).toBe(true);
  return body.data;
}

async function loginLink(page: Page, email: string): Promise<string> {
  await post(page, 'auth.requestLink', { email });
  return (
    (await (await page.request.get(`${API}/__test/login-link?email=${email}`)).json()) as {
      link: string;
    }
  ).link;
}

async function noViolations(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

const BODY =
  'Many people thinks that university should be free for everyone. In my opinion the education is a right. ' +
  'If students pay high fees, they may chose cheaper courses instead of the ones they really love. ' +
  'For example my cousin study engineering only because it was cheaper. ' +
  'In conclusion, I am agree that the government should pay for universities.';

test('the result unlocks after the error practice, and the teacher sees it', async ({ page }) => {
  await page.request.get(`${API}/__test/reset`);
  const token = new URL(
    (await loginLink(page, 'admin@example.com')).replace('#/', ''),
  ).searchParams.get('token');
  const admin = (await post(page, 'auth.exchange', { token })).sessionToken as string;
  const config = await post(page, 'config.get', {});
  const queue = await post(page, 'admin.queue', {}, admin);
  const an = queue.students.find((s: any) => s.name === 'Nguyen Van An').id;
  const topicId = config.topics.find((t: any) => t.label === 'Education').id;
  const { essayId } = await post(
    page,
    'admin.essays.create',
    {
      studentId: an,
      taskType: 'task2',
      topicId,
      essayType: 'agree_disagree',
      prompt: 'University education should be free. Do you agree or disagree?',
      body: BODY,
    },
    admin,
  );
  const view = await post(page, 'admin.essay', { id: essayId }, admin);
  const cat = (label: string) => view.categories.find((c: any) => c.label === label).id;
  const at = (text: string) => ({
    start: BODY.indexOf(text),
    end: BODY.indexOf(text) + text.length,
  });
  // Every correction has 3 to 6 words, so each task kind appears once whatever the shuffle.
  const errors = [
    [
      'Many people thinks that',
      'Many people think that',
      'Subject-verb agreement',
      'Chủ ngữ số nhiều.',
    ],
    [
      'In my opinion the education is',
      'In my opinion education is',
      'Articles',
      'Không dùng "the".',
    ],
    ['they may chose cheaper', 'they may choose cheaper', 'Tense', ''],
    ['my cousin study engineering', 'my cousin studied engineering', 'Tense', 'Dùng quá khứ.'],
    ['I am agree that', 'I agree that', 'Subject-verb agreement', ''],
  ].map(([excerpt, correction, label, note]) => ({
    categoryId: cat(label),
    excerpt,
    ...at(excerpt),
    correction,
    note,
  }));
  await post(
    page,
    'admin.saveScore',
    {
      essayId,
      scores: { task: 6.5, coherence: 6, lexical: 6, grammar: 5.5 },
      feedback: { task: 'Tốt.', coherence: 'Rõ ràng.', lexical: 'Ổn.', grammar: 'Chú ý thì.' },
      generalComment: 'Bài làm khá.',
      topicId,
      essayType: 'agree_disagree',
      errors,
      rewrite: { required: false, dueDate: '', note: '' },
      submit: true,
      notifyAgain: false,
      requestId: 'e2e-practice',
    },
    admin,
  );

  // The student: the list says the result needs practice, and the band is hidden.
  await page.goto(await loginLink(page, 'demo.an@example.com'));
  await page.goto('#/essays');
  const row = page.getByRole('row', { name: /Education · Agree or disagree/ });
  await expect(row.getByText('Practice to unlock')).toBeVisible();
  await row.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Before you see your score' })).toBeVisible();
  await expect(page.locator('.band-hero')).toHaveCount(0);
  await noViolations(page);

  const headings = await completePractice(page);
  expect(headings).toEqual([
    'Fill the gap with the correct words',
    'Choose the correct sentence',
    'Put the words in the right order',
    'Name the mistake',
    'Match each mistake with its correction',
  ]);
  await expect(page.locator('.band-hero strong')).toHaveText('6.0');
  await expect(page.getByRole('heading', { name: 'Errors (5)' })).toBeVisible();

  // The teacher: the scored view shows the result was seen and the practice done.
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: 'Scoring queue' })).toBeVisible();
  await page.getByLabel('Status').selectOption({ label: 'Scored (edit a score)' });
  const scored = page.getByRole('row', { name: /Education · Agree or disagree/ });
  await expect(scored.getByText('Done')).toBeVisible();
  await expect(scored.getByText('Sent')).toBeVisible();
  await expect(scored.getByText('Not yet')).toHaveCount(0);
  await noViolations(page);
});
