// End-to-end flow against the mock API:
// student signs up, saves a draft, submits; admin pastes a Claude draft and one
// external result, edits a score, sets a rewrite, submits; an email event is recorded.
import { expect, type Page, test } from '@playwright/test';

const API = 'http://localhost:8788';
const STUDENT_EMAIL = 'e2e.student@example.com';
const STUDENT_PASSWORD = 'harper-e2e-pass';

const ESSAY =
  'Some people believe that university should be free for everyone. In my opinion, the goverment should pay most of the cost. ' +
  'Free education give poor students the same chance as rich students, and society benefits from a skilled workforce. '.repeat(
    12,
  );

async function openLoginLink(page: Page, email: string) {
  const res = await page.request.get(`${API}/__test/login-link?email=${encodeURIComponent(email)}`);
  expect(res.ok()).toBeTruthy();
  const { link } = (await res.json()) as { link: string };
  await page.goto(link);
}

test('student submits an essay; admin scores it with Claude and an external tool', async ({
  page,
}) => {
  await page.request.get(`${API}/__test/reset`);

  // ---- Student signs up ----
  await page.goto('#/signup');
  await page.getByLabel('Full name').fill('E2E Student');
  await page.getByLabel('Email address').fill(STUDENT_EMAIL);
  await page.getByLabel('Choose a password').fill(STUDENT_PASSWORD);
  await page.getByLabel('Class').selectOption({ label: 'IELTS 7' });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Sign up' }).click();
  // Straight into the site, no email needed.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // ---- Saves a draft ----
  await page.goto('#/new?mode=practice');
  await page.getByLabel('Task type').selectOption('task2');
  await page.getByLabel('Topic').selectOption({ label: 'Education' });
  await page.getByLabel('Essay type').selectOption({ label: 'Discussion' });
  await page
    .getByLabel('Task prompt')
    .fill(
      'Some people think university education should be free. Discuss both views and give your opinion.',
    );
  await page.getByLabel('Your essay').fill(ESSAY);
  await expect(page.getByText(/\d+ words/)).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Draft saved at/)).toBeVisible();
  await expect(page).toHaveURL(/#\/write\//);

  // ---- Submits ----
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText("You can't edit after submitting.")).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(/^Submitted\. Your teacher will score it soon/)).toBeVisible();
  const essayUrl = page.url();
  const essayId = /#\/essays\/([^/?]+)/.exec(essayUrl)![1];

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  // ---- Admin opens the essay from the queue ----
  await page.request.post(`${API}/`, {
    headers: { 'Content-Type': 'text/plain' },
    data: JSON.stringify({ action: 'auth.requestLink', payload: { email: 'admin@example.com' } }),
  });
  await openLoginLink(page, 'admin@example.com');
  await expect(page.getByRole('heading', { name: 'Scoring queue' })).toBeVisible();
  const row = page.getByRole('row', { name: /E2E Student/ });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Score' }).click();
  await expect(page.getByRole('heading', { name: /Score: E2E Student/ })).toBeVisible();

  // ---- Pastes a Claude draft ----
  const claudeReply = {
    scores: { task: 7, coherence: 6.5, lexical: 6, grammar: 6 },
    feedback: {
      task: 'Clear position throughout.',
      coherence: 'Logical paragraphs.',
      lexical: 'Some repetition.',
      grammar: 'Watch subject-verb agreement.',
    },
    general_comment: 'A clear answer with a few accuracy problems.',
    suggested_topic: 'Education',
    errors: [
      { excerpt: 'goverment', category: 'spelling', correction: 'government', note: '' },
      {
        excerpt: 'Free education give',
        category: 'Subject-verb agreement',
        correction: 'Free education gives',
        note: '',
      },
    ],
  };
  await page.getByRole('button', { name: 'Paste Claude draft' }).click();
  await page
    .getByLabel('Claude reply')
    .fill('```json\n' + JSON.stringify(claudeReply, null, 2) + '\n```');
  await page.getByRole('button', { name: 'Check reply' }).click();
  await expect(page.getByText(/Valid reply/)).toBeVisible();
  await page.getByRole('button', { name: 'Load into form' }).click();
  await expect(page.getByText(/Claude’s draft is loaded into the form/)).toBeVisible();
  await expect(page.locator('output.overall')).toHaveText('Overall band 6.5');
  await expect(page.locator('mark.err')).toHaveCount(2);

  // ---- Pastes one external result ----
  await page.getByRole('tab', { name: 'AI4IELTS' }).click();
  const ai = page
    .getByRole('tabpanel')
    .filter({ has: page.getByRole('button', { name: 'Save AI4IELTS result' }) });
  await ai.getByLabel('Task Response').selectOption('7.5');
  await ai.getByLabel('Grammatical Range and Accuracy').selectOption('7.0');
  await ai.getByLabel(/AI4IELTS feedback/).fill('Great essay! <script>alert(1)</script>');
  await ai.getByRole('button', { name: 'Save AI4IELTS result' }).click();
  await expect(page.getByText(/AI4IELTS result saved/)).toBeVisible();

  // ---- Loads Claude's reconciled result (notes, then revised JSON) into the form ----
  await page.getByRole('tab', { name: 'Claude draft' }).click();
  const reconciled = {
    ...claudeReply,
    scores: { task: 7, coherence: 6.5, lexical: 6, grammar: 6.5 },
    feedback: { ...claudeReply.feedback, grammar: 'Mostly accurate after reconciling.' },
  };
  await page
    .getByLabel('Reconcile notes')
    .fill(
      '1. Disagreements: GRA.\n2. Argument problems: none.\n3. Revised suggestion: GRA 6.5.\n\n```json\n' +
        JSON.stringify(reconciled, null, 2) +
        '\n```',
    );
  await page.getByRole('button', { name: 'Load reconciled result into form' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Load into form' }).click();
  await expect(page.getByText(/Claude’s reconciled result is loaded/)).toBeVisible();
  await expect(page.locator('select[name="score-grammar"]')).toHaveValue('6.5');
  await expect(page.locator('output.overall')).toHaveText('Overall band 6.5');
  await expect(page.locator('mark.err')).toHaveCount(2);

  // ---- Edits a score ----
  await page.locator('select[name="score-grammar"]').selectOption('5.0');
  await expect(page.locator('output.overall')).toHaveText('Overall band 6.0'); // (7+6.5+6+5)/4 = 6.125 → 6.0

  // ---- Sets a rewrite ----
  await page.getByLabel('Rewrite required').check();
  await page.locator('input[name="rewrite.dueDate"]').fill('2099-01-31');
  await page
    .getByLabel('Instructions for the student')
    .fill('Fix the spelling and agreement errors.');

  // ---- Submits ----
  await page.getByRole('button', { name: 'Preview and submit score' }).click();
  // ---- Previews what the student will receive, then sends ----
  const preview = page.getByRole('dialog');
  await expect(
    preview.getByRole('heading', { name: /Preview: what the student will receive/ }),
  ).toBeVisible();
  await expect(
    preview.locator('.preview-student').getByText('A clear answer with a few accuracy problems.'),
  ).toBeVisible();
  await expect(preview.locator('mark.err')).toHaveCount(2);
  await preview.getByRole('tab', { name: 'Email' }).click();
  await expect(preview.getByText('Your score: Task 2 – Band 6.0')).toBeVisible();
  await expect(preview.getByText(STUDENT_EMAIL).first()).toBeVisible();
  // Going back changes nothing; nothing was sent.
  await preview.getByRole('button', { name: 'Back to editing' }).click();
  const pre = (await (await page.request.get(`${API}/__test/email-events`)).json()) as unknown[];
  expect(pre).toHaveLength(1); // only the admin's login link so far (the student signed up without email)
  await page.getByRole('button', { name: 'Preview and submit score' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send to student' }).click();
  await expect(page.getByText('Score submitted and the result email was sent.')).toBeVisible();

  // ---- An email event is recorded ----
  const events = (await (await page.request.get(`${API}/__test/email-events`)).json()) as Array<
    Record<string, string>
  >;
  const result = events.filter((e) => e.essay_id === essayId && e.type === 'result');
  expect(result).toHaveLength(1);
  expect(result[0].status).toBe('sent');
  expect(result[0].idempotency_key).toBe(`result:${essayId}:1`);

  const scores = (await (
    await page.request.get(`${API}/__test/table?name=Scores`)
  ).json()) as Array<Record<string, string>>;
  expect(scores.find((s) => s.essay_id === essayId)).toMatchObject({
    criterion_4: '5',
    overall: '6',
  });
  const sources = (await (
    await page.request.get(`${API}/__test/table?name=SourceFeedback`)
  ).json()) as Array<Record<string, string>>;
  expect(sources.filter((s) => s.essay_id === essayId)).toHaveLength(2); // Claude's first draft + AI4IELTS

  // ---- The student sees the final score and the rewrite request ----
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.goto('#/login');
  await page.getByLabel('Email address').fill(STUDENT_EMAIL);
  await page.getByLabel('Password').fill(STUDENT_PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.goto(essayUrl);
  await expect(page.locator('.band-hero strong')).toHaveText('6.0');
  await expect(page.getByRole('heading', { name: 'Rewrite required' })).toBeVisible();
  await expect(page.getByText('AI4IELTS')).toHaveCount(0);
  await expect(page.getByText('Great essay!')).toHaveCount(0);
});
