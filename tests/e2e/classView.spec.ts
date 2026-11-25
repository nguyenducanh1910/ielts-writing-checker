// "Lớp học" in the scoring queue: a Classroom class, then one assignment with its whole history.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const API = 'http://localhost:8788';
const SECRET = 'portal-secret-'.padEnd(64, 'x');

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

test('the teacher picks a class and an assignment to see all its essays', async ({ page }) => {
  await page.request.get(`${API}/__test/reset`);
  await page.request.get(`${API}/__test/portal-secret?value=${SECRET}`);
  const token = new URL(
    (await loginLink(page, 'admin@example.com')).replace('#/', ''),
  ).searchParams.get('token');
  const admin = (await post(page, 'auth.exchange', { token })).sessionToken as string;
  const all = await post(page, 'admin.queue', { status: 'all' }, admin);
  const waiting = all.items.find((i: any) => i.queueStatus !== 'scored');
  const scored = all.items.find((i: any) => i.queueStatus === 'scored');
  await post(page, 'portal.essays.tag', {
    secret: SECRET,
    items: [waiting, scored].map((i: any) => ({
      essayId: i.id,
      classLabel: 'K230',
      assignment: 'Buổi 5 – Writing Task 2',
      courseworkId: 'cw5',
    })),
  });

  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: /^Chào/ })).toBeVisible();
  await page.goto('#/admin');
  await expect(page.getByRole('heading', { name: 'Lớp học' })).toBeVisible();
  await page.getByLabel('Lớp', { exact: true }).selectOption({ label: 'K230 (1 bài tập)' });
  await page
    .getByLabel('Bài tập đã giao')
    .selectOption({ label: 'Buổi 5 – Writing Task 2 — 2 bài, 1 chờ chấm' });
  await expect(page.getByText(/Đang xem toàn bộ 2 bài/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit score' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Score', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/class-view.png', fullPage: true });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});
