import { expect, type Page } from '@playwright/test';

/** #228: reports start from the 「…」 menu, then open in a dialog that checks the session. */
export async function chooseReport(page: Page, subject: '記事' | '作品' | 'プロフィール') {
  await page.getByRole('button', { name: `この${subject}のその他の操作`, exact: true }).click();
  await page.getByRole('menuitem', { name: '通報する', exact: true }).click();
  // The menu fades out while the dialog opens; axe must not sample its half-transparent item.
  await expect(page.locator('.report-menu-popup')).toHaveCount(0);
}

export const reportDialog = (page: Page, subject: '記事' | '作品' | 'プロフィール') =>
  page.getByRole('dialog', { name: `${subject}の通報`, exact: true });
