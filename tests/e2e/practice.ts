// Completes the error practice like a struggling student: two wrong tries on every task, then
// the revealed answer. This exercises every task kind and the reveal path.
import { expect, type Page } from '@playwright/test';

/** Returns the heading of every task, in order. */
export async function completePractice(page: Page): Promise<string[]> {
  const section = page.locator('section.practice');
  await expect(section.getByRole('heading', { name: 'Before you see your score' })).toBeVisible();
  const total = Number(
    /of (\d+)/.exec((await section.getByText(/^Task 1 of \d+$/).textContent())!)![1],
  );
  const headings: string[] = [];
  for (let n = 1; n <= total; n++) {
    await expect(section.getByText(`Task ${n} of ${total}`)).toBeVisible();
    const task = section.locator('form.practice-task');
    const heading = (await task.locator('h3').textContent())!;
    headings.push(heading);
    const gap = task.getByLabel('Correct words for the gap');
    if (heading.startsWith('Fill the gap')) await gap.fill('definitely wrong');
    // Two wrong tries reveal the answer.
    for (let i = 0; i < 2; i++) await task.getByRole('button', { name: 'Check' }).click();
    const reveal = task.locator('.notice-warning');
    await expect(reveal).toBeVisible();
    const answers = await reveal.locator('strong').allTextContents();
    if (heading.startsWith('Fill the gap')) {
      await gap.fill(answers[0]);
    } else if (heading.startsWith('Choose the correct') || heading.startsWith('Name the mistake')) {
      await task.locator('label.practice-option', { hasText: answers[0] }).first().click();
    } else if (heading.startsWith('Put the words')) {
      for (const word of answers[0].split(' ')) {
        await task
          .locator('.practice-bank button:not([disabled])', { hasText: word })
          .filter({ hasText: new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
          .first()
          .click();
      }
    } else if (heading.startsWith('Match')) {
      const selects = task.locator('select');
      for (let i = 0; i < answers.length; i++)
        await selects.nth(i).selectOption({ label: answers[i] });
    } else {
      throw new Error(`Unknown task: ${heading}`);
    }
    await task.getByRole('button', { name: 'Check' }).click();
    await expect(task.getByText('Correct!')).toBeVisible();
    await task.getByRole('button', { name: n < total ? 'Next task' : 'Finish' }).click();
  }
  await expect(section.getByRole('heading', { name: 'Well done!' })).toBeVisible();
  await section.getByRole('button', { name: 'See my score and feedback' }).click();
  return headings;
}
