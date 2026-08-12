import { expect, test } from '@playwright/test';

test('development console renders and creates a validated direct PDF', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Urveska' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Mr. Lombardi playing drums' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'PDF Creator' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(68, 99, 119)');
  await expect(page.getByText('internal testing console, not a general public file converter')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');

  await page.getByLabel('Saved fixture').selectOption('appA');
  await expect(page.getByLabel(/HTML \(/)).toContainText('data:image/svg+xml;base64');
  await page.getByLabel('Saved fixture').selectOption('fixed');
  await expect(page.getByLabel('Expected pages')).toHaveValue('3');
  await page.getByLabel('Filename').fill('Console_Named_Report.pdf');
  await page.getByRole('button', { name: 'Generate validated PDF' }).click();
  await expect(page.getByText('PDF created and validated.')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'Validated sandbox preview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
  await expect(page.locator('.results')).toContainText('pageCount');
  await expect(page.locator('.results')).toContainText('3');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download direct PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Console_Named_Report.pdf');
});
