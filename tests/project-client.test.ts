import { it, expect, vi, afterEach } from 'vitest';
import { createProjectClient, ProjectClientError } from '../src/editor/project-client';
import { createPublicProjectClient } from '../src/editor/public-project-client';
const id = '11111111-1111-4111-8111-111111111111',
  profileId = 'profile-fictional';
const fields = {
  title: '作品',
  description: '<script>plain</script>',
  githubUrl: 'https://example.invalid/',
  demoUrl: '',
};
const draft = { ...fields, id, version: 1, updatedAt: 1 };
const author = {
  id: profileId,
  name: '架空の投稿者',
  department: 'IT',
  year: '2年',
  bio: '紹介',
  initials: '架',
};
const project = { ...fields, id, publishedOn: '2026-11-04' };
const token = 'a'.repeat(43);
afterEach(() => vi.useRealTimers());
it('normalizes before private create and uses expected-version PUT without replacing newer input', async () => {
  const calls: RequestInit[] = [];
  const f = vi.fn(async (_path, init) => {
    calls.push(init!);
    const data = JSON.parse(String(init?.body));
    return Response.json(
      {
        ...draft,
        ...data,
        version: init?.method === 'PUT' ? 2 : 1,
        ...{ expectedVersion: undefined },
      },
      { status: init?.method === 'PUT' ? 200 : 201 },
    );
  });
  const client = createProjectClient(token, f as typeof fetch);
  expect(
    (await client.save(null, { ...fields, githubUrl: 'https://example.invalid' })).githubUrl,
  ).toBe('https://example.invalid/');
  expect((await client.save(id, fields, 1)).version).toBe(2);
  expect(calls.map((c) => c.method)).toEqual(['POST', 'PUT']);
  expect(JSON.parse(String(calls[1].body))).toEqual({ ...fields, expectedVersion: 1 });
  expect(calls[0]).toMatchObject({
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  expect(new Headers(calls[1].headers).get('Authorization') === 'Bearer csrf.' + token).toBe(true);
});
it('accepts blank draft fields and strict own lists, but rejects mismatched IDs, versions and private projections', async () => {
  expect(
    await createProjectClient(token, (async () =>
      Response.json({ ...draft, title: '', description: '' })) as typeof fetch).read(id),
  ).toMatchObject({ title: '' });
  for (const v of [
    { ...draft, id: '22222222-2222-4222-8222-222222222222' },
    { ...draft, ownerId: 'PRIVATE' },
    { ...draft, githubUrl: 'https://example.invalid' },
  ])
    await expect(
      createProjectClient(token, (async () => Response.json(v)) as typeof fetch).read(id),
    ).rejects.toBeInstanceOf(ProjectClientError);
  await expect(
    createProjectClient(token, (async () =>
      Response.json({ ...draft, version: 3 })) as typeof fetch).save(id, fields, 1),
  ).rejects.toBeInstanceOf(ProjectClientError);
  await expect(
    createProjectClient(token, (async () =>
      Response.json(
        Array(21).fill({ id, title: '', version: 1, updatedAt: 0 }),
      )) as typeof fetch).list(),
  ).rejects.toBeInstanceOf(ProjectClientError);
});
it('uses publication receipt without confusing null with unavailable and only posts version/confirmation', async () => {
  const calls: RequestInit[] = [];
  const client = createProjectClient(token, (async (_p, init) => {
    calls.push(init!);
    return init?.method === 'POST'
      ? Response.json({ projectId: id }, { status: 201 })
      : Response.json({ publication: null });
  }) as typeof fetch);
  expect(await client.receipt(id)).toEqual({ publication: null });
  expect(await client.publish(id, 1)).toBe(id);
  expect(JSON.parse(String(calls[1].body))).toEqual({ expectedVersion: 1, confirmPublic: true });
  await expect(
    createProjectClient(
      token,
      (async () => new Response('PRIVATE', { status: 404 })) as typeof fetch,
    ).receipt(id),
  ).rejects.toThrow('作品の操作結果を確認できませんでした。');
});
it('rejects unsafe input and bounds unknown responses without automatic retry', async () => {
  const f = vi.fn(async () => new Response('PRIVATE', { status: 503 }));
  await expect(
    createProjectClient(token, f as typeof fetch).save(null, fields),
  ).rejects.toBeInstanceOf(ProjectClientError);
  expect(f).toHaveBeenCalledTimes(1);
  for (const githubUrl of [
    'javascript:alert(1)',
    'https://user:pass@example.invalid/',
    'https://example.invalid/a b',
  ])
    await expect(
      createProjectClient(token, f as typeof fetch).save(null, { ...fields, githubUrl }),
    ).rejects.toBeInstanceOf(ProjectClientError);
  expect(f).toHaveBeenCalledTimes(1);
  await expect(
    createProjectClient(
      token,
      (async () =>
        new Response('x'.repeat(65537), {
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
    ).read(id),
  ).rejects.toBeInstanceOf(ProjectClientError);
});
it('times out stalled private reads and aborts old fetches', async () => {
  vi.useFakeTimers();
  const f = vi.fn(() => new Promise<Response>(() => {}));
  const pending = createProjectClient(token, f as typeof fetch).read(id);
  const assertion = expect(pending).rejects.toBeInstanceOf(ProjectClientError);
  await vi.advanceTimersByTimeAsync(10000);
  await assertion;
  expect(f).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  const old = createProjectClient(token, f as typeof fetch).read(id, controller.signal);
  const canceled = expect(old).rejects.toBeInstanceOf(ProjectClientError);
  controller.abort();
  await canceled;
});
it('reads project-only public DTOs anonymously without article fields or fetching external URLs', async () => {
  const f = vi.fn(async (path) =>
    Response.json(
      String(path).includes('project-authors')
        ? {
            author,
            projects: [
              {
                id,
                title: fields.title,
                descriptionPreview: fields.description,
                githubUrl: fields.githubUrl,
                demoUrl: '',
                publishedOn: '2026-11-04',
              },
            ],
          }
        : { project, author },
    ),
  );
  const client = createPublicProjectClient(f as typeof fetch);
  expect(await client.read(id)).toEqual({ project, author });
  expect((await client.author(profileId)).projects).toHaveLength(1);
  for (const call of f.mock.calls) expect(call[0]).toMatch(/^\/__lab\//);
  expect(f).toHaveBeenCalledWith(
    '/__lab/projects/' + id,
    expect.objectContaining({ credentials: 'omit', cache: 'no-store', redirect: 'error' }),
  );
  for (const v of [
    { project: { ...project, minutes: 5 }, author },
    { project, author: { ...author, email: 'PRIVATE' } },
    { project: { ...project, githubUrl: 'https://example.invalid' }, author },
  ])
    await expect(
      createPublicProjectClient((async () => Response.json(v)) as typeof fetch).read(id),
    ).rejects.toBeInstanceOf(ProjectClientError);
});
it('caps project reader at64KiB while author response keeps256KiB and rejects false empty', async () => {
  const padded = JSON.stringify({ project, author }) + ' '.repeat(65536);
  await expect(
    createPublicProjectClient(
      (async () =>
        new Response(padded, { headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
    ).read(id),
  ).rejects.toBeInstanceOf(ProjectClientError);
  const summary = {
    id,
    title: fields.title,
    descriptionPreview: '紹介',
    githubUrl: fields.githubUrl,
    demoUrl: '',
    publishedOn: '2026-11-04',
  };
  expect(
    (
      await createPublicProjectClient(
        (async () =>
          new Response(JSON.stringify({ author, projects: [summary] }) + ' '.repeat(65536), {
            headers: { 'Content-Type': 'application/json' },
          })) as typeof fetch,
      ).author(profileId)
    ).projects,
  ).toHaveLength(1);
  await expect(
    createPublicProjectClient((async () =>
      Response.json({ author, projects: [] })) as typeof fetch).author(profileId),
  ).rejects.toBeInstanceOf(ProjectClientError);
});
