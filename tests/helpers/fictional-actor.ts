import { expect, type Browser, type BrowserContext } from '@playwright/test';
import { completeGoogleFormPost } from './google-form-post';

// A fictional signed-in student with a public profile, created through the HTTPS fixture's API
// so browser specs can start from published content without walking the whole sign-up flow.
export const ORIGIN = 'https://127.0.0.1:8790';
export type Actor = { context: BrowserContext; csrf: string; profileId: string };

export async function actor(
  browser: Browser,
  contexts: BrowserContext[],
  name: string,
): Promise<Actor> {
  const context = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  contexts.push(context);
  const headers = { Origin: ORIGIN };
  expect((await context.request.post('/api/auth/bootstrap', { headers })).status()).toBe(204);
  const command = await context.request.post('/api/auth/command?action=self-registration', {
    headers,
  });
  expect(command.status()).toBe(200);
  const { commandToken } = await command.json();
  const start = await context.request.post('/api/auth/register', {
    headers: { ...headers, Authorization: 'Bearer command.' + commandToken },
    data: { admissionYear: 2026, graduationYear: 2028 },
  });
  expect(start.status()).toBe(200);
  const authorization = new URL((await start.json()).authorizationUrl);
  const state = authorization.searchParams.get('state')!;
  const nonce = authorization.searchParams.get('nonce')!;
  expect(
    (
      await context.request.get(
        '/__control/token?' +
          new URLSearchParams({ state, nonce, actor: 'fictional-a11y-' + crypto.randomUUID() }),
      )
    ).status(),
  ).toBe(200);
  const callback = await completeGoogleFormPost(context.request, ORIGIN, { state, code: state });
  expect(callback.status()).toBe(303);
  const { csrfToken } = await (await context.request.get('/api/private/session')).json();
  const profile = await context.request.post('/api/private/profile', {
    headers: { ...headers, Authorization: 'Bearer csrf.' + csrfToken },
    data: {
      displayName: name,
      department: '',
      yearLabel: '',
      bio: '架空の自己紹介',
      confirmPublic: true,
    },
  });
  expect(profile.status()).toBe(201);
  return { context, csrf: csrfToken, profileId: (await profile.json()).profile.id };
}

export async function write(owner: Actor, path: string, data: object) {
  const response = await owner.context.request.post(path, {
    headers: { Origin: ORIGIN, Authorization: 'Bearer csrf.' + owner.csrf },
    data,
  });
  expect(response.status()).toBe(201);
  return response.json();
}
