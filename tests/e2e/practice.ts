// Completes the error practice like a struggling student: two wrong tries on every task, then
// the revealed answer. This exercises every task kind and the reveal path.
import { expect, type Page } from '@playwright/test';

/** Returns the heading of every task, in order. */
export async function completePractice(page: Page): Promise<string[]> {
  const section = page.locator('section.practice');
  await expect(section.getByRole('heading', { name: 'Trước khi xem điểm' })).toBeVisible();
  const total = Number(
    /\/(\d+)/.exec((await section.getByText(/^Câu 1\/\d+$/).textContent())!)![1],
  );
  const headings: string[] = [];
  for (let n = 1; n <= total; n++) {
    await expect(section.getByText(`Câu ${n}/${total}`)).toBeVisible();
    const task = section.locator('form.practice-task');
    const heading = (await task.locator('h3').textContent())!;
    headings.push(heading);
    const gap = task.getByLabel('Từ đúng cho chỗ trống');
    if (heading.startsWith('Điền từ')) await gap.fill('definitely wrong');
    // Two wrong tries reveal the answer.
    for (let i = 0; i < 2; i++) await task.getByRole('button', { name: 'Kiểm tra' }).click();
    const reveal = task.locator('.notice-warning');
    await expect(reveal).toBeVisible();
    const answers = await reveal.locator('strong').allTextContents();
    if (heading.startsWith('Điền từ')) {
      await gap.fill(answers[0]);
    } else if (heading.startsWith('Chọn câu đúng') || heading.startsWith('Gọi tên lỗi')) {
      await task.locator('label.practice-option', { hasText: answers[0] }).first().click();
    } else if (heading.startsWith('Sắp xếp từ')) {
      for (const word of answers[0].split(' ')) {
        await task
          .locator('.practice-bank button:not([disabled])', { hasText: word })
          .filter({ hasText: new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
          .first()
          .click();
      }
    } else if (heading.startsWith('Nối')) {
      const selects = task.locator('select');
      for (let i = 0; i < answers.length; i++)
        await selects.nth(i).selectOption({ label: answers[i] });
    } else {
      throw new Error(`Unknown task: ${heading}`);
    }
    await task.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(task.getByText('Đúng rồi!')).toBeVisible();
    await task.getByRole('button', { name: n < total ? 'Câu tiếp theo' : 'Hoàn thành' }).click();
  }
  await expect(section.getByRole('heading', { name: 'Làm tốt lắm!' })).toBeVisible();
  await section.getByRole('button', { name: 'Xem điểm và nhận xét' }).click();
  return headings;
}
