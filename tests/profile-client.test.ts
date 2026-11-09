import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  createProfileClient,
  ProfileClientError,
  ProfileConflictError,
  sameProfileInput,
  type ProfileInput,
} from '../src/editor/profile-client';
const input: ProfileInput = {
  displayName: '  テストの書き手  ',
  department: 'IT',
  yearLabel: '2年',
  bio: '入力した文章\nそのまま',
};
const value = { ...input, id: 'profile-11111111-1111-4111-8111-111111111111', initials: 'テ' };
const csrf = 'c'.repeat(43);
afterEach(() => vi.useRealTimers());
describe('explicit public profile browser client', () => {
  it('updates the exact prior public snapshot with PATCH and keeps its stable public ID', async () => {
    const changed = { ...input, bio: '更新した自己紹介' };
    const fetcher = vi.fn(async (_p: unknown, init?: RequestInit) => {
      expect(init?.method).toBe('PATCH');
      expect(init?.credentials).toBe('same-origin');
      expect(init?.cache).toBe('no-store');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer csrf.' + csrf);
      expect(JSON.parse(init?.body as string)).toEqual({
        ...changed,
        confirmPublic: true,
        expectedProfile: value,
      });
      return Response.json({ profile: { ...value, ...changed } });
    });
    expect(
      await createProfileClient(csrf, fetcher as typeof fetch).update(changed, value, true),
    ).toEqual({ ...value, ...changed });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('requires confirmation and a public-only expected DTO before sending an update', async () => {
    const fetcher = vi.fn(),
      client = createProfileClient(csrf, fetcher as typeof fetch);
    await expect(client.update(input, value, false)).rejects.toBeInstanceOf(ProfileClientError);
    const privateExtra = { ...value, email: 'PRIVATE' };
    await expect(client.update(input, privateExtra, true)).rejects.toBeInstanceOf(
      ProfileClientError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('distinguishes stale updates and rejects changed ID, private extras or partial acknowledgements', async () => {
    await expect(
      createProfileClient(csrf, (async () =>
        Response.json({ error: 'profile_changed' }, { status: 409 })) as typeof fetch).update(
        input,
        value,
        true,
      ),
    ).rejects.toBeInstanceOf(ProfileConflictError);
    for (const profile of [
      { ...value, id: 'another-profile' },
      { ...value, email: 'PRIVATE' },
      { ...value, bio: 'different' },
      { ...value, initials: 'X' },
      null,
    ])
      await expect(
        createProfileClient(csrf, (async () => Response.json({ profile })) as typeof fetch).update(
          input,
          value,
          true,
        ),
      ).rejects.toBeInstanceOf(ProfileClientError);
  });
  it('never retries an uncertain update or accepts its late receipt', async () => {
    vi.useFakeTimers();
    let release: (value: Response) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const result = createProfileClient(csrf, fetcher as typeof fetch).update(input, value, true);
    const rejected = expect(result).rejects.toBeInstanceOf(ProfileClientError);
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    release(Response.json({ profile: value }));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('sends only explicit input and confirmation with CSRF/no-store, preserving spaces', async () => {
    let init: RequestInit | undefined;
    let path: unknown;
    const client = createProfileClient(csrf, (async (p, i) => {
      path = p;
      init = i;
      return Response.json({ profile: value }, { status: 201 });
    }) as typeof fetch);
    expect(await client.create(input, true)).toEqual(value);
    expect(path).toBe('/api/private/profile');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer csrf.' + csrf);
    expect(JSON.parse(init?.body as string)).toEqual({ ...input, confirmPublic: true });
    expect(sameProfileInput(input, { ...input, displayName: input.displayName.trim() })).toBe(
      false,
    );
  });
  it('does not send before confirmation or with privileged/invalid fields', async () => {
    const fetcher = vi.fn();
    const client = createProfileClient(csrf, fetcher as typeof fetch);
    await expect(client.create(input, false)).rejects.toBeInstanceOf(ProfileClientError);
    for (const bad of [
      { ...input, displayName: ' ' },
      { ...input, displayName: 'x'.repeat(81) },
      { ...input, bio: '\ud800' },
      { ...input, bio: '\0' },
      { ...input, initials: 'X' },
    ])
      await expect(client.create(bad, true)).rejects.toBeInstanceOf(ProfileClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts null and bounded legacy public profiles for read-only display', async () => {
    expect(
      await createProfileClient(csrf, (async () =>
        Response.json({ profile: null })) as typeof fetch).read(),
    ).toBeNull();
    const legacy = { ...value, id: 'public-author_2', initials: 'AB' };
    expect(
      await createProfileClient(csrf, (async () =>
        Response.json({ profile: legacy })) as typeof fetch).read(),
    ).toEqual(legacy);
  });
  it('rejects private extra fields and malformed DTOs without exposing payloads', async () => {
    for (const result of [
      { profile: { ...value, email: 'PRIVATE_EMAIL' } },
      { profile: value, privateAccount: 'PRIVATE' },
      { profile: { ...value, id: '../private' } },
      { profile: { ...value, initials: 'x'.repeat(9) } },
      { profile: { ...value, bio: '\ud800' } },
      { profile: { ...value, displayName: '' } },
    ])
      await expect(
        createProfileClient(csrf, (async () => Response.json(result)) as typeof fetch).read(),
      ).rejects.toThrow('プロフィールの操作結果を確認できませんでした。');
  });
  it('requires a generated ID, exact submitted fields and derived initials for create acknowledgement', async () => {
    for (const result of [
      { ...value, id: 'manual-existing' },
      { ...value, initials: 'AB' },
      { ...value, displayName: value.displayName.trim() },
      null,
    ])
      await expect(
        createProfileClient(csrf, (async () =>
          Response.json({ profile: result }, { status: 201 })) as typeof fetch).create(input, true),
      ).rejects.toBeInstanceOf(ProfileClientError);
  });
  it('bounds responses and handles malformed or unavailable data generically', async () => {
    for (const make of [
      () => new Response('PRIVATE_DB_FAILURE', { status: 503 }),
      () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
      () => new Response('x'.repeat(16385), { headers: { 'Content-Type': 'application/json' } }),
      () =>
        new Response('{}', {
          headers: { 'Content-Type': 'application/json', 'Content-Length': '16385' },
        }),
    ])
      await expect(
        createProfileClient(csrf, (async () => make()) as typeof fetch).read(),
      ).rejects.toBeInstanceOf(ProfileClientError);
  });
  it('does not retry an uncertain creation or accept its late acknowledgement', async () => {
    vi.useFakeTimers();
    let release: (r: Response) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const promise = createProfileClient(csrf, fetcher as typeof fetch).create(input, true);
    const rejected = expect(promise).rejects.toBeInstanceOf(ProfileClientError);
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(Response.json({ profile: value }, { status: 201 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
