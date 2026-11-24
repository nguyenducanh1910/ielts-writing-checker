// Quick approval: the queue shows the overall band to be sent; ticked essays are sent in one go.
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

test('the teacher sees overall bands and sends ticked essays at once', async ({ page }) => {
  await page.request.get(`${API}/__test/reset`);
  const token = new URL(
    (await loginLink(page, 'admin@example.com')).replace('#/', ''),
  ).searchParams.get('token');
  const admin = (await post(page, 'auth.exchange', { token })).sessionToken as string;
  const queue = await post(page, 'admin.queue', {}, admin);
  const essay = queue.items[0];
  // The teacher saved a form with four scores but did not send it.
  await post(
    page,
    'admin.saveScore',
    { essayId: essay.id, scores: { task: 6, coherence: 6.5, lexical: 6, grammar: 6 }, errors: [] },
    admin,
  );

  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: /^Chào/ })).toBeVisible();
  await page.goto('#/admin');
  await expect(page.getByRole('heading', { name: 'Duyệt nhanh' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Overall' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /6\.0\s+thầy/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/quick-approve.png', fullPage: true });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await page.getByRole('checkbox', { name: new RegExp(`Chọn ${essay.studentName}`) }).check();
  await page.getByRole('button', { name: 'Duyệt & gửi 1 bài đã chọn' }).click();
  await page.getByRole('button', { name: 'Gửi 1 bài', exact: true }).click();
  await expect(page.getByText('Đã gửi 1 bài.')).toBeVisible();
  const after = await post(page, 'admin.queue', { status: 'scored' }, admin);
  expect(after.items.find((i: any) => i.id === essay.id).score).toEqual({
    overall: 6,
    source: 'final',
  });
});
