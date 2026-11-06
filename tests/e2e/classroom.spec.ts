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
  // One menu for the class pages and Writing scoring.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Chấm Writing' })).toBeVisible();
  await expect(nav.getByText('Công cụ Writing')).toBeVisible();
  await expect(page.getByTestId('runtime')).toContainText(
    'Chạy tự động hôm nay: khoảng 23/90 phút',
  );
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
  // Writing scoring is in the same menu.
  await page.getByRole('link', { name: 'Chấm Writing' }).click();
  await expect(page.getByRole('heading', { name: 'Scoring queue' })).toBeVisible();
  await nav.getByText('Công cụ Writing').click();
  await nav.getByRole('link', { name: 'Học sinh (Writing)' }).click();
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();
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
  // Writing results open on this site with the same login.
  const essayLink = page.getByRole('link', { name: /Xem bài chữa|Xem bài em đã nộp/ }).first();
  await expect(essayLink).toHaveAttribute('href', /^#\/essays\/mock-essay-\d+$/);
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

test('check shows a preview of the Form and uploads a missing audio file', async ({ page }) => {
  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: /^Chào/ })).toBeVisible();
  await page.goto('#/lop/giao-bai');
  await expect(page.getByRole('link', { name: /Tải file mẫu Teacher's Book/ })).toBeVisible();
  await page.getByLabel('Loại bài').selectOption('Listening + Speaking');
  await page.getByLabel('Link thư mục Drive').fill('https://drive.google.com/drive/folders/L25');
  await page.getByRole('button', { name: 'Kiểm tra trước' }).click();
  const preview = page.getByTestId('assign-preview');
  await expect(preview.getByText('Listening: 8 câu')).toBeVisible();
  await expect(preview.getByRole('cell', { name: 'local farmers' })).toBeVisible();
  await expect(preview.getByText(/cặp 7–8/).first()).toBeVisible();
  const upload = page.getByTestId('audio-upload');
  await expect(upload).toBeVisible();
  await upload.getByLabel('Chọn file nghe').setInputFiles({
    name: 'L25 part 2.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3fake-mp3'),
  });
  await upload.getByRole('button', { name: 'Tải lên thư mục' }).click();
  await expect(page.getByText(/Đã tải "Listening - L25 part 2\.mp3"/)).toBeVisible();
  // Re-checked automatically: the folder now has its audio.
  await expect(page.getByTestId('audio-upload')).toHaveCount(0);
  await expect(page.getByText(/Thư mục hợp lệ/)).toBeVisible();
});

test('teacher approves several Speaking results at once', async ({ page }) => {
  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: /^Chào/ })).toBeVisible();
  await page.goto('#/lop/bai-nop?view=review');
  const bulk = page.getByTestId('bulk');
  await expect(bulk).toBeVisible();
  const picks = page.locator('.cl-sub-pick');
  const before = await picks.count();
  expect(before).toBeGreaterThan(2);
  await picks.nth(0).check();
  await picks.nth(1).check();
  await expect(bulk.getByText('2 bài được chọn')).toBeVisible();
  await bulk.getByRole('button', { name: 'Duyệt các bài đã chọn' }).click();
  await expect(page.getByText('Đã duyệt 2 bài.')).toBeVisible();
  await expect(page.locator('.cl-sub-pick')).toHaveCount(before - 2);
  // The AI draft opens inline.
  const first = page.locator('.cl-sub').first();
  await first.locator('.cl-sub-head').click();
  await first.getByText(/Xem bản nháp chi tiết của AI/).click();
  await expect(first.getByText(/Your response \(transcript\)/)).toBeVisible();
});

test('teacher sees one student’s progress; the student reviews wrong answers', async ({ page }) => {
  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: /^Chào/ })).toBeVisible();
  await page.getByRole('link', { name: 'Học sinh', exact: true }).click();
  await page.getByLabel('Học sinh').selectOption('demo.binh@example.com');
  await expect(page.getByRole('heading', { name: 'Band theo thời gian' })).toBeVisible();
  await expect(page.getByText('Không theo dõi việc đổi ý').first()).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.goto(await loginLink(page, 'demo.binh@example.com'));
  // Students start on their class page, which also links to "Tiến bộ & ôn câu sai".
  await expect(page.getByRole('heading', { name: 'Lớp học của em' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Tiến bộ' })
    .click();
  await expect(page.getByRole('heading', { name: 'Tiến bộ & ôn tập' })).toBeVisible();
  const review = page.getByTestId('review');
  const item = review.locator('.cl-review-item').first();
  await expect(item.getByText('glue (chấp nhận: the glue)')).toBeHidden();
  await item.getByRole('button', { name: 'Xem đáp án' }).click();
  await expect(item.getByText('glue (chấp nhận: the glue)')).toBeVisible();
});

test('a page that cannot draw the server answer shows an error, not a spinner', async ({
  page,
}) => {
  await page.route(`${MOCK_API}/classroom`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string };
    if (body.action === 'overview')
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"data":{}}' });
    return route.continue();
  });
  const reported = page.waitForRequest(
    (r) => r.url().startsWith(`${MOCK_API}/classroom`) && /client\.error/.test(r.postData() ?? ''),
  );
  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByText(/This page could not be displayed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await reported;
});

test('the teacher is warned when a web app runs an older version', async ({ page }) => {
  await page.route(`${MOCK_API}/`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string };
    if (body.action !== 'config.get') return route.continue();
    const res = await route.fetch();
    const json = (await res.json()) as { data: Record<string, unknown> };
    json.data.serverVersion = 'old0000000';
    return route.fulfill({ response: res, body: JSON.stringify(json) });
  });
  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: /^Chào/ })).toBeVisible();
  await expect(page.getByText(/đang chạy bản cũ \(máy chủ: old0000000/)).toBeVisible();
  await expect(page.getByTestId('health')).toBeVisible();
});

test('a new Google Classroom class is set up like the others after the teacher confirms', async ({
  page,
}) => {
  await page.goto(await loginLink(page, 'admin@example.com'));
  const card = page.getByTestId('new-class');
  await expect(card.getByRole('heading', { name: 'K233 6.0 TC - BTVN' })).toBeVisible();
  await expect(card.getByLabel('Lớp mẫu')).toHaveValue('c230');
  await card.getByLabel('Buổi đầu tiên (số buổi Lxx)').fill('0');
  await card.getByRole('button', { name: 'Bắt đầu theo dõi' }).click();
  await expect(card.getByText('Buổi đầu tiên phải là số từ 1 đến 300.')).toBeVisible();
  await card.getByLabel('Buổi đầu tiên (số buổi Lxx)').fill('5');
  await card.getByLabel('Buổi đầu là').selectOption('LS');
  await card.getByRole('button', { name: 'Bắt đầu theo dõi' }).click();
  await expect(card.getByText(/buổi: L5 L \+ S/)).toBeVisible();
  await expect(card.getByText(/Web Writing: đã tạo lớp "K233 6.0 TC"/)).toBeVisible();
  await expect(card.getByRole('link', { name: 'Mở file phạt ↗' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Bỏ qua' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Kiểm tra lớp mới' }).click();
  await expect(page.getByText('Không có lớp mới.')).toBeVisible();
});
