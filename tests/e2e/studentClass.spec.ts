// The teacher changes a student's class from the student's page.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const API = 'http://localhost:8788';

test('admin moves a student to another class', async ({ page }) => {
  await page.request.get(`${API}/__test/reset`);
  await page.request.post(`${API}/`, {
    headers: { 'Content-Type': 'text/plain' },
    data: JSON.stringify({ action: 'auth.requestLink', payload: { email: 'admin@example.com' } }),
  });
  const { link } = (await (
    await page.request.get(`${API}/__test/login-link?email=admin@example.com`)
  ).json()) as { link: string };
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Scoring queue' })).toBeVisible();

  await page.goto('#/admin/students');
  await page.getByRole('link', { name: 'Tran Thi Binh' }).click();
  await expect(page.getByRole('heading', { name: 'Tran Thi Binh' })).toBeVisible();
  await expect(page.getByText(/· IELTS 7 ·/)).toBeVisible();
  await expect(page.getByLabel('Class', { exact: true })).toHaveValue(/.+/);

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page.getByLabel('Class', { exact: true }).selectOption({ label: 'IELTS 8' });
  await page.getByRole('button', { name: 'Save class' }).click();
  await expect(page.getByText('Moved to IELTS 8.')).toBeVisible();
  // The page reloads and shows the new class.
  await expect(page.getByText(/· IELTS 8 ·/)).toBeVisible();
  const selected = page.getByLabel('Class', { exact: true }).locator('option:checked');
  await expect(selected).toHaveText('IELTS 8');
});
