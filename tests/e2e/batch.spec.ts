// Batch scoring with Claude from the queue, then "Send and open next essay".
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

const BODIES = [
  'Many people think that university should be free. I agree with this idea because education help everyone. '.repeat(
    6,
  ),
  'Some people prefer to live in a city while others like the countryside. Living in city have many benefits. '.repeat(
    6,
  ),
];

const claudeResult = (excerpt: string, correction: string) => ({
  scores: { task: 6.5, coherence: 6, lexical: 6, grammar: 5.5 },
  feedback: {
    task: 'Trả lời đúng yêu cầu.',
    coherence: 'Bố cục rõ ràng.',
    lexical: 'Từ vựng ổn.',
    grammar: 'Chú ý chia động từ.',
  },
  general_comment: 'Bài làm khá tốt.',
  suggested_topic: 'Education',
  errors: [{ excerpt, category: 'Subject-verb agreement', correction, note: '' }],
});

test('admin scores two essays with one Claude batch, then sends and opens the next', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.request.get(`${API}/__test/reset`);

  // Two Task 2 essays added by the teacher (the demo queue only has a Task 1 essay waiting).
  const token = new URL(
    (await loginLink(page, 'admin@example.com')).replace('#/', ''),
  ).searchParams.get('token');
  const admin = (await post(page, 'auth.exchange', { token })).sessionToken as string;
  const config = await post(page, 'config.get', {});
  const queue = await post(page, 'admin.queue', {}, admin);
  const an = queue.students.find((s: any) => s.name === 'Nguyen Van An').id;
  const binh = queue.students.find((s: any) => s.name === 'Tran Thi Binh').id;
  const topicId = config.topics.find((t: any) => t.label === 'Education').id;
  for (const [studentId, body] of [
    [an, BODIES[0]],
    [binh, BODIES[1]],
  ]) {
    await post(
      page,
      'admin.essays.create',
      {
        studentId,
        taskType: 'task2',
        topicId,
        essayType: 'agree_disagree',
        prompt: 'Some people think university should be free. Do you agree or disagree?',
        body,
      },
      admin,
    );
  }

  await page.goto(await loginLink(page, 'admin@example.com'));
  await expect(page.getByRole('heading', { name: 'Scoring queue' })).toBeVisible();
  await page.getByText('Batch scoring with Claude (Task 2)').click();
  // Task 1 essays cannot join a batch.
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await page.getByRole('checkbox', { name: /Nguyen Van An/ }).check();
  await page.getByRole('checkbox', { name: /Tran Thi Binh/ }).check();
  await expect(page.getByText('2 of 5 selected')).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole('button', { name: 'Copy batch for Claude' }).click();
  await expect(page.getByText(/Copied 2 essay\(s\)/)).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const refs = [...copied.matchAll(/=== Essay ([0-9a-f]{8}) \(\d of 2\) ===/g)].map((m) => m[1]);
  expect(refs).toHaveLength(2);
  expect(copied).toContain('education help everyone');

  // Claude's answer: the first essay's result, then the second's.
  const answer = {
    essays: [
      { essay: refs[0], ...claudeResult('education help everyone', 'education helps everyone') },
      { essay: refs[1], ...claudeResult('Living in city have', 'Living in a city has') },
    ],
  };
  await page
    .getByLabel('Claude’s batch answer')
    .fill('```json\n' + JSON.stringify(answer) + '\n```');
  await page.getByRole('button', { name: 'Check and save drafts' }).click();
  await expect(page.getByText('Saved 2 Claude draft(s).')).toBeVisible();
  await expect(page.getByText(/Nguyen Van An .*: band 6\.0, 1 error\(s\)\./)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh the queue' }).click();
  await expect(page.locator('.badge', { hasText: 'Claude draft pasted' })).toHaveCount(2);

  // The draft is waiting on the essay's scoring page.
  await page
    .getByRole('row', { name: /Nguyen Van An.*Agree or disagree/ })
    .getByRole('link', { name: 'Score' })
    .click();
  await expect(page.getByText(/Valid reply, saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Load into form' }).click();
  await expect(page.locator('mark.err')).toHaveCount(1);
  const firstUrl = page.url();

  await page.getByRole('button', { name: 'Preview and submit score' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send and open next essay' }).click();
  await expect(
    page.getByText(/Score submitted and the result email was sent\. Next:/),
  ).toBeVisible();
  // The next essay is the other one with a Claude draft ready, not the older Task 1 essay.
  await expect(
    page.getByRole('heading', { name: 'Score: Tran Thi Binh – Education · Agree or disagree' }),
  ).toBeVisible();
  await expect(page.getByText(/Valid reply, saved/)).toBeVisible();
  expect(page.url()).not.toBe(firstUrl);
});
