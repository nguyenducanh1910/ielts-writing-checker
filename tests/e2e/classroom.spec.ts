// "Lớp học" section against the classroom mock (same contract as the Apps Script web app).
import { expect, type Page, test } from '@playwright/test';
import { MOCK_API } from '../../playwright.config';

async function loginLink(page: Page, email: string): Promise<string> {
  await page.request.post(`${MOCK_API}/`, {
    headers: { 'Content-Type': 'text/plain' },
    data: JSON.stringify({ action: 'auth.requestLink', payload: { email } }),
  });
  const { link } = (await (
    await page.request.get(`${MOCK_API}/__test/login-link?email=${email}`)
  ).json()) as { link: string };
  return link;
}

test.beforeEach(async ({ request }) => {
  await request.get(`${MOCK_API}/__test/reset`);
});

test('teacher reviews a Speaking result and sends it', async ({ page }) => {
  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: /^Chào/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Khu vực' })).toBeVisible();
  await page.getByRole('link', { name: /Speaking chờ duyệt/ }).click();
  await expect(page.getByRole('heading', { name: 'Bài nộp' })).toBeVisible();
  const first = page.locator('.cl-sub').first();
  await first.locator('.cl-sub-head').click();
  await expect(first.getByText(/Speaking\.m4a/)).toBeVisible();
  await first.getByLabel('Band').fill('7.5');
  await first.getByRole('button', { name: 'Duyệt & gửi ngay' }).click();
  await page.getByRole('button', { name: 'Gửi ngay', exact: true }).click();
  await expect(first.getByText(/Đã gửi cho học sinh lúc/)).toBeVisible();
  await expect(first.getByText('Band 7.5')).toBeVisible();
  // The Writing section is still one click away.
  await page.getByRole('link', { name: 'Writing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Scoring queue' })).toBeVisible();
});

test('teacher checks an assignment folder before posting it', async ({ page }) => {
  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: /^Chào/ })).toBeVisible();
  await page.goto('#/lop/giao-bai');
  await page.getByLabel('Link thư mục Drive').fill('https://drive.google.com/drive/folders/abc');
  await page.getByRole('button', { name: 'Kiểm tra trước' }).click();
  await expect(page.getByText(/Thư mục hợp lệ/)).toBeVisible();
  await page.getByRole('button', { name: 'Giao bài' }).click();
  await page.getByRole('button', { name: 'Giao ngay' }).click();
  await expect(page.getByText('Mở bài trên Classroom ↗')).toBeVisible();
});

test('student sees only their own class page and no teacher pages', async ({ page }) => {
  await page.goto(await loginLink(page, 'demo.binh@example.com'));
  await expect(page.getByRole('link', { name: 'Lớp học' })).toBeVisible();
  await page.getByRole('link', { name: 'Lớp học' }).click();
  await expect(page.getByRole('heading', { name: 'Lớp học của em' })).toBeVisible();
  await expect(page.getByText('Tran Thi Binh · K232 5.5 TM - BTVN')).toBeVisible();
  await expect(page.getByText('Hoàng Quang Vinh')).toHaveCount(0);
  await page.goto('#/lop');
  await expect(
    page.getByRole('heading', { name: 'You do not have access to this page' }),
  ).toBeVisible();
  // The API refuses too, whatever the browser sends.
  const token = await page.evaluate(() => localStorage.getItem('ielts.session'));
  const res = await page.request.post(`${MOCK_API}/classroom`, {
    headers: { 'Content-Type': 'text/plain' },
    data: JSON.stringify({ action: 'submissions.list', token, payload: { view: 'all' } }),
  });
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
});
