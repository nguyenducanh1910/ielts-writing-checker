// Automated accessibility checks (axe-core, WCAG 2 A/AA) on the main pages.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const API = 'http://localhost:8788';

async function login(page: Page, email: string) {
  await page.request.post(`${API}/`, {
    headers: { 'Content-Type': 'text/plain' },
    data: JSON.stringify({ action: 'auth.requestLink', payload: { email } }),
  });
  const { link } = (await (
    await page.request.get(`${API}/__test/login-link?email=${email}`)
  ).json()) as { link: string };
  await page.goto(link);
}

async function check(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.loading')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id}: ${v.help} (${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(', ')})`,
  );
  expect(summary, `${name} accessibility violations`).toEqual([]);
}

test('student and admin pages have no WCAG A/AA violations', async ({ page }) => {
  await page.request.get(`${API}/__test/reset`);
  await page.goto('#/login');
  await check(page, 'login');
  await page.goto('#/signup');
  await check(page, 'signup');
  await page.goto('#/privacy');
  await check(page, 'privacy');

  await login(page, 'demo.an@example.com');
  for (const path of [
    '/dashboard',
    '/essays',
    '/new',
    '/new?mode=practice',
    '/new?mode=test',
    '/assigned',
    '/topics',
    '/settings',
  ]) {
    await page.goto(`#${path}`);
    await check(page, path);
  }
  await page.goto('#/essays');
  await page
    .getByRole('link', { name: /Education/ })
    .first()
    .click();
  await check(page, 'essay detail');

  await page.getByRole('button', { name: 'Log out' }).click();
  await login(page, 'admin@example.com');
  await check(page, 'queue');
  await page.getByRole('link', { name: 'Score' }).first().click();
  await check(page, 'scoring page');
  for (const path of [
    '/admin/essays/new',
    '/admin/students',
    '/admin/assignments',
    '/admin/assignments/new',
    '/admin/calibration',
    '/admin/emails',
    '/admin/lists',
    '/admin/claude',
  ]) {
    await page.goto(`#${path}`);
    await check(page, path);
  }
});
