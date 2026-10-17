import { expect, test } from '@playwright/test';

test('full flow: create from url, edit, save, build, download', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder(/Адрес вашего сайта/).fill('https://e2e-test.local');
  await page.getByRole('button', { name: 'Создать приложение' }).click();

  await page.waitForURL(/\/p\/p_/, { timeout: 15_000 });

  const nameInput = page.locator('input[type="text"]').first();
  await expect(nameInput).toHaveValue('Кофейня Уют');

  await nameInput.fill('Кофейня Уют (edited)');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();

  await page.getByRole('button', { name: 'Собрать .ipa' }).click();

  const downloadLink = page.getByRole('link', { name: 'Скачать .ipa' });
  await expect(downloadLink).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/неподписанный .ipa/i)).toBeVisible();

  const href = await downloadLink.getAttribute('href');
  expect(href).toBeTruthy();
  const downloadResponse = await page.request.get(href!);
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()['content-disposition']).toContain('attachment');
});
