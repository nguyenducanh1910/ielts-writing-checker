// Read all: every essay on one prompt, one after another on one page.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

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
  const { link } = (await (
    await page.request.get(`${API}/__test/login-link?email=${email}`)
  ).json()) as { link: string };
  return link;
}

const PROMPT = 'Some people think university should be free. Do you agree or disagree?';

test('the teacher reads every essay on one prompt on one page', async ({ page }) => {
  await page.request.get(`${API}/__test/reset`);
  const token = new URL(
    (await loginLink(page, 'admin@example.com')).replace('#/', ''),
  ).searchParams.get('token');
  const admin = (await post(page, 'auth.exchange', { token })).sessionToken as string;
  const config = await post(page, 'config.get', {});
  const queue = await post(page, 'admin.queue', {}, admin);
  const an = queue.students.find((s: any) => s.name === 'Nguyen Van An').id;
  const binh = queue.students.find((s: any) => s.name === 'Tran Thi Binh').id;
  const topicId = config.topics.find((t: any) => t.label === 'Education').id;
  // Two answers to the same question (written differently) and one to another question.
  for (const [studentId, prompt, body] of [
    [an, PROMPT, 'First answer. Free university helps poor students study. '.repeat(30)],
    [binh, PROMPT.toUpperCase(), 'Second answer. Students should pay a small fee. '.repeat(30)],
    [an, 'Homework should be banned. Do you agree?', 'Another question. '.repeat(60)],
  ]) {
    await post(
      page,
      'admin.essays.create',
      { studentId, taskType: 'task2', topicId, essayType: 'agree_disagree', prompt, body },
      admin,
    );
  }

  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: 'Scoring queue' })).toBeVisible();
  await page.getByLabel('Prompt').selectOption({ label: `${PROMPT} (2 essays)` });
  await page.getByRole('link', { name: 'Read all 2 essays' }).click();

  await expect(page.getByRole('heading', { name: 'Read all', level: 1 })).toBeVisible();
  const essays = page.locator('article.read-essay');
  await expect(essays).toHaveCount(2);
  await expect(essays.nth(0)).toContainText('First answer.');
  await expect(essays.nth(1)).toContainText('Second answer.');
  await expect(essays.nth(1)).toContainText('Same prompt as the essay above.');
  await expect(page.getByText('Another question.')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Essays on this page' })).toContainText(
    '2. Tran Thi Binh',
  );
  await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
    .then((axe) => expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]));

  // J moves to the next essay.
  await page.locator('body').press('j');
  await expect(page.getByRole('heading', { name: /^2\. Tran Thi Binh/ })).toBeFocused();

  // From an essay, the scoring page links back to every essay on the prompt.
  await essays.nth(1).getByRole('link', { name: 'Score this' }).click();
  await page.getByRole('link', { name: 'Read all 2 essays on this prompt' }).click();
  await expect(page.locator('article.read-essay')).toHaveCount(2);
});
