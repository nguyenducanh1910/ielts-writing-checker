// Free automatic scoring: the teacher enters a Gemini key, pastes Claude's draft, then
// "Bắt đầu chấm (Gemini)" scores with Gemini, reconciles and fills the form. The queue can also
// send several essays with a Claude draft to the background run.
import { expect, type Page, test } from '@playwright/test';

const API = 'http://localhost:8788';
const BODY =
  'Many people think that university should be free. I agree with this idea because education help everyone. '.repeat(
    6,
  );

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

const claude = {
  scores: { task: 6, coherence: 6, lexical: 6, grammar: 5.5 },
  feedback: {
    task: 'Đủ ý.',
    coherence: 'Rõ ràng.',
    lexical: 'Ổn.',
    grammar: 'Chú ý chia động từ.',
  },
  general_comment: 'Bài làm khá.',
  suggested_topic: 'Education',
  errors: [
    {
      excerpt: 'education help everyone',
      category: 'Subject-verb agreement',
      correction: 'education helps everyone',
      note: '',
    },
  ],
};

test('Gemini scores and reconciles with the pasted Claude draft (no API cost)', async ({
  page,
}) => {
  await page.request.get(`${API}/__test/reset`);
  const token = new URL(
    (await loginLink(page, 'admin@example.com')).replace('#/', ''),
  ).searchParams.get('token');
  const admin = (await post(page, 'auth.exchange', { token })).sessionToken as string;
  const config = await post(page, 'config.get', {});
  const queue = await post(page, 'admin.queue', {}, admin);
  const an = queue.students.find((s: any) => s.name === 'Nguyen Van An').id;
  const created = await post(
    page,
    'admin.essays.create',
    {
      studentId: an,
      taskType: 'task2',
      topicId: config.topics.find((t: any) => t.label === 'Education').id,
      essayType: 'agree_disagree',
      prompt: 'Some people think university should be free. Do you agree or disagree?',
      body: BODY,
    },
    admin,
  );
  const essayId = (created.essayId ?? created.id) as string;

  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: /^Chào/ })).toBeVisible();

  // ---- Settings: Gemini key ----
  await page.goto('#/admin/ai');
  await expect(page.getByRole('heading', { name: 'Chấm tự động (Gemini)' })).toBeVisible();
  await page.getByLabel('Khoá Gemini API').fill('AIzaTestKey_0123456789abcdef');
  await page.getByRole('button', { name: 'Lưu cài đặt' }).click();
  await expect(page.getByLabel('Khoá Gemini API — đã lưu ✓')).toHaveValue('');
  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(page.getByText(/Gemini: Kết nối được/)).toBeVisible();

  // ---- Scoring page: needs Claude's draft first ----
  await page.goto(`#/admin/score/${essayId}`);
  await expect(page.getByRole('heading', { name: /Score: Nguyen Van An/ })).toBeVisible();
  await page.getByRole('button', { name: 'Bắt đầu chấm (Gemini)' }).click();
  await expect(page.getByText(/Dán bản chấm của Claude trước/)).toBeVisible();

  await page.getByRole('button', { name: 'Paste Claude draft' }).click();
  await page.getByLabel('Claude reply').fill(JSON.stringify(claude));
  await page.getByRole('button', { name: 'Check reply' }).click();
  await expect(page.getByText(/Valid reply/)).toBeVisible();
  await page.getByRole('button', { name: 'Load into form' }).click();
  await expect(page.locator('output.overall')).toHaveText('Overall band 6.0');

  await page.getByRole('button', { name: 'Bắt đầu chấm (Gemini)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Load into form' }).click();
  await expect(page.getByText(/Đã điền kết quả đối chiếu Claude \+ Gemini/)).toBeVisible();
  await expect(page.locator('output.overall')).toHaveText('Overall band 6.0');
  await expect(page.getByText(/Lệch nhau: Task/).first()).toBeVisible();
  await expect(page.locator('mark.err')).toHaveCount(1);

  // ---- Queue: the essay shows its Gemini result (save the form first) ----
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.goto('#/admin');
  await expect(
    page.getByRole('row', { name: /Nguyen Van An/ }).getByText('Gemini: đã đối chiếu'),
  ).toBeVisible();
});
