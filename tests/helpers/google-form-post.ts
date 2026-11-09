import { expect, type APIRequestContext, type Route } from '@playwright/test';

const attribute = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return escaped[character];
  });

/** Local provider fixture: this document stays on the intercepted Google origin until form POST. */
export async function fulfillGoogleFormPost(
  route: Route,
  origin: string,
  fields: Record<string, string>,
) {
  const inputs = Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${attribute(name)}" value="${attribute(value)}">`,
    )
    .join('');
  await route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Local provider return</title><form method="post" action="${attribute(origin)}/api/auth/callback">${inputs}</form><script>addEventListener('load', () => document.forms[0].submit());</script></html>`,
  });
}

/** API fixture for silent session replacement; UI tests independently exercise real browser cookie policy. */
export async function completeGoogleFormPost(
  request: APIRequestContext,
  origin: string,
  fields: Record<string, string>,
) {
  const staged = await request.post(origin + '/api/auth/callback', {
    headers: { Origin: 'https://accounts.google.com', Cookie: '' },
    form: fields,
    maxRedirects: 0,
  });
  expect(staged.status()).toBe(303);
  expect(staged.headers().location).toBe(origin + '/api/auth/callback/complete#');
  return request.get(origin + '/api/auth/callback/complete', { maxRedirects: 0 });
}
