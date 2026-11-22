import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Writing starts from a public profile; create one on the account page right after sign-up. */
export async function createProfileOnAccount(page: Page, name = '架空の書き手') {
  const region = page.getByRole('region', { name: 'プロフィールをつくる' });
  await region.getByLabel('表示名', { exact: true }).fill(name);
  await region.getByRole('button', { name: '公開する', exact: true }).click();
  await expect(page.getByRole('button', { name: 'プロフィールを編集', exact: true })).toBeVisible();
}

/** After an API-level sign-in (e.g. switching to a seeded account), make sure it can write. */
export async function ensureProfileByApi(request: APIRequestContext, origin: string, name: string) {
  const current = await request.get(origin + '/api/private/profile');
  expect(current.status()).toBe(200);
  if ((await current.json()).profile) return;
  const session = await request.get(origin + '/api/private/session');
  expect(session.status()).toBe(200);
  const { csrfToken } = await session.json();
  const created = await request.post(origin + '/api/private/profile', {
    headers: { Origin: origin, Authorization: 'Bearer csrf.' + csrfToken },
    data: { displayName: name, department: '', yearLabel: '', bio: '', confirmPublic: true },
  });
  expect(created.status()).toBe(201);
}
