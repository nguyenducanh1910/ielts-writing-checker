// Admin adds a paper essay for a new student (no email) from a .txt file and scores it.
import { expect, test } from '@playwright/test';

const API = 'http://localhost:8788';

test('admin adds an essay from a file for a new student', async ({ page }) => {
  await page.request.get(`${API}/__test/reset`);
  await page.request.post(`${API}/`, {
    headers: { 'Content-Type': 'text/plain' },
    data: JSON.stringify({ action: 'auth.requestLink', payload: { email: 'admin@example.com' } }),
  });
  const { link } = (await (
    await page.request.get(`${API}/__test/login-link?email=admin@example.com`)
  ).json()) as { link: string };
  await page.goto(link);

  await page.getByRole('link', { name: 'Add an essay' }).click();
  await expect(page.getByRole('heading', { name: 'Add an essay' })).toBeVisible();
  await page.getByLabel('Student', { exact: true }).selectOption({ label: '+ New student…' });
  await page.getByLabel('Full name').fill('Pham Paper Student');
  await page.getByLabel('Task type').selectOption('task2');
  await page.getByLabel('Topic').selectOption({ label: 'Crime' });
  await page.getByLabel('Essay type').selectOption({ label: 'Discussion' });
  await page
    .getByLabel('Task prompt')
    .fill('Some people think prison is the best punishment. Discuss.');
  const essay = 'Crime is a serious problem in many countries today. '.repeat(30);
  await page.getByLabel('Load the essay from a file (optional)').setInputFiles({
    name: 'essay.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(essay),
  });
  await expect(page.getByText('Loaded essay.txt')).toBeVisible();
  await expect(page.getByLabel('Essay text')).toHaveValue(essay.trim());
  await expect(page.getByText('270 words')).toBeVisible();

  await page.getByRole('button', { name: 'Add and score now' }).click();
  await expect(page.getByRole('heading', { name: /Score: Pham Paper Student/ })).toBeVisible();
  await expect(page.getByText('Copied to Google Drive.')).toBeVisible();

  await page.goto('#/admin');
  const row = page.getByRole('row', { name: /Pham Paper Student/ });
  await expect(row.getByText('Uploaded by teacher')).toBeVisible();
});
