import type { Page } from '@playwright/test';

/** Signed-in navigation lives in the header account menu. */
export async function accountMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'アカウントメニュー', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
