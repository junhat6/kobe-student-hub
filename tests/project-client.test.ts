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
  technologies: 'React、TypeScript',
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
const project = { ...fields, id, publishedOn: '2026-11-04', stage: 'complete' };
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
  expect(JSON.parse(String(calls[1].body))).toEqual({
    expectedVersion: 1,
    confirmPublic: true,
    stage: 'complete',
  });
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
                stage: 'in_progress',
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
    stage: 'complete',
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
it('reports a 404 project as missing, distinct from a failed read', async () => {
  const status = (s: number) =>
    createPublicProjectClient((async () =>
      Response.json({ error: 'x' }, { status: s })) as typeof fetch);
  await expect(status(404).read(id)).rejects.toMatchObject({ missing: true });
  await expect(status(503).read(id)).rejects.toMatchObject({ missing: false });
  await expect(status(200).read('not-a-uuid')).rejects.toMatchObject({ missing: true });
});
it('sends owner-chosen article links only when present and validates linked article titles', async () => {
  const article = '22222222-2222-4222-8222-222222222222';
  const calls: RequestInit[] = [];
  const client = createProjectClient(token, (async (_p, init) => {
    calls.push(init!);
    return Response.json({ projectId: id }, { status: 201 });
  }) as typeof fetch);
  expect(await client.publish(id, 1, undefined, [], [article])).toBe(id);
  expect(JSON.parse(String(calls[0].body))).toEqual({
    expectedVersion: 1,
    confirmPublic: true,
    articleIds: [article],
    stage: 'complete',
  });
  expect(await client.publish(id, 1, undefined, [], [], 'in_progress')).toBe(id);
  expect(JSON.parse(String(calls[1].body)).stage).toBe('in_progress');
  calls.length = 1;
  await expect(
    client.publish(id, 1, undefined, [], [], 'done' as 'complete'),
  ).rejects.toBeInstanceOf(ProjectClientError);
  for (const bad of [[article, article], ['not-a-uuid'], [article, id, article, id]])
    await expect(client.publish(id, 1, undefined, [], bad)).rejects.toBeInstanceOf(
      ProjectClientError,
    );
  expect(calls).toHaveLength(1);
  const page = { project, author, articles: [{ id: article, title: '架空の記事' }] };
  const read = (v: unknown) =>
    createPublicProjectClient((async () => Response.json(v)) as typeof fetch, 'ordinary').read(id);
  expect(await read(page)).toEqual(page);
  expect(await read({ ...page, articles: [] })).toEqual({ ...page, articles: [] });
  for (const articles of [
    [{ id: article, title: '' }],
    [{ id: article, title: 'x', summary: 'PRIVATE' }],
    [page.articles[0], page.articles[0]],
    null,
  ])
    await expect(read({ ...page, articles })).rejects.toBeInstanceOf(ProjectClientError);
});
it('switches 制作中／完成 only with the stage body and accepts only a confirmed matching receipt (#275)', async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const reply = (stage: string) => ({
    publication: {
      projectId: id,
      sourceVersion: 1,
      project: { ...project, stage },
      author,
    },
  });
  let answer: unknown = reply('in_progress');
  const client = createProjectClient(token, (async (path, init) => {
    calls.push({ path: String(path), init: init! });
    return Response.json(answer);
  }) as typeof fetch);
  const confirmed = await client.setStage(id, 'in_progress');
  expect(confirmed?.project.stage).toBe('in_progress');
  expect(calls[0].path).toBe('/api/private/project-publications/' + id);
  expect(calls[0].init.method).toBe('PUT');
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ stage: 'in_progress' });
  // A receipt that does not show the requested stage, or carries an unknown stage, is not success.
  for (const bad of [reply('complete'), reply('done'), { publication: null }]) {
    answer = bad;
    await expect(client.setStage(id, 'in_progress')).rejects.toBeInstanceOf(ProjectClientError);
  }
  await expect(client.setStage('not-a-uuid', 'complete')).rejects.toBeInstanceOf(
    ProjectClientError,
  );
});
it('keeps private owner reads within the shared 64 KiB bound and sends CSRF only on writes (#189)', async () => {
  // A valid JSON body padded with whitespace: exactly at the bound is read, one byte over is not.
  const sized = (bytes: number) => {
    const json = JSON.stringify(draft);
    return json + ' '.repeat(bytes - new TextEncoder().encode(json).byteLength);
  };
  const reply = (text: string) =>
    (async () =>
      new Response(text, { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  expect(await createProjectClient(token, reply(sized(65536))).read(id)).toMatchObject({ id });
  await expect(createProjectClient(token, reply(sized(65537))).read(id)).rejects.toBeInstanceOf(
    ProjectClientError,
  );
  const calls: [string, RequestInit][] = [];
  const client = createProjectClient(token, (async (path, init) => {
    calls.push([String(path), init!]);
    return init?.method === 'PUT' ? Response.json({ ...draft, version: 2 }) : Response.json(draft);
  }) as typeof fetch);
  await client.read(id);
  await client.save(id, fields, 1);
  const [read, write] = calls.map(([, init]) => new Headers(init.headers));
  expect(calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin' });
  expect(calls[0][1].body).toBeUndefined();
  expect(read.has('Authorization') || read.has('Content-Type')).toBe(false);
  expect(write.get('Content-Type')).toBe('application/json');
  expect(write.get('Authorization') === 'Bearer csrf.' + token).toBe(true);
  // A write with a malformed CSRF token never reaches the network.
  const never = vi.fn();
  await expect(
    createProjectClient('short', never as typeof fetch).save(id, fields, 1),
  ).rejects.toBeInstanceOf(ProjectClientError);
  expect(never).not.toHaveBeenCalled();
  // A 409 or 422 from the server is a plain failure here, never a retried write.
  for (const status of [409, 422]) {
    const f = vi.fn(async () => Response.json({ error: 'x' }, { status }));
    await expect(
      createProjectClient(token, f as typeof fetch).save(id, fields, 1),
    ).rejects.toBeInstanceOf(ProjectClientError);
    expect(f).toHaveBeenCalledTimes(1);
  }
});
it('reads a private draft that arrives split across many stream chunks (#189 verifier M11)', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(draft));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.subarray(i, i + 7));
      c.close();
    },
  });
  const f = (async () =>
    new Response(stream, { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  expect(await createProjectClient(token, f).read(id)).toMatchObject({ id, version: 1 });
});
it('reads and changes journal links only through confirmed owner responses (#273)', async () => {
  const article = '22222222-2222-4222-8222-222222222222',
    fixed = '33333333-3333-4333-8333-333333333333';
  const calls: { path: string; init: RequestInit }[] = [];
  let answer: unknown = {
    projectId: id,
    fixedArticleIds: [fixed],
    articleIds: [article],
    articles: [{ id: article, title: '日誌', isPublic: true }],
  };
  const client = createProjectClient(token, (async (path, init) => {
    calls.push({ path: String(path), init: init! });
    return Response.json(answer);
  }) as typeof fetch);
  expect((await client.journal(id)).articleIds).toEqual([article]);
  expect(calls[0].path).toBe('/api/private/project-journal/' + id);
  expect(calls[0].init.method ?? 'GET').toBe('GET');
  expect((await client.setJournalLink(id, article, true)).articleIds).toEqual([article]);
  expect(calls[1].init.method).toBe('PUT');
  expect(JSON.parse(String(calls[1].init.body))).toEqual({ articleId: article, linked: true });
  // A response that does not show the requested change, or has extra or malformed fields, is not success.
  await expect(client.setJournalLink(id, article, false)).rejects.toBeInstanceOf(
    ProjectClientError,
  );
  for (const bad of [
    { projectId: id, fixedArticleIds: [], articleIds: [article, article] },
    // articles must match articleIds one to one, with a boolean public flag.
    { projectId: id, fixedArticleIds: [], articleIds: [article], articles: [] },
    {
      projectId: id,
      fixedArticleIds: [],
      articleIds: [article],
      articles: [{ id: article, title: '日誌', isPublic: 1 }],
    },
    {
      projectId: id,
      fixedArticleIds: [],
      articleIds: [article],
      articles: [{ id: fixed, title: '日誌', isPublic: true }],
    },
    { projectId: id, fixedArticleIds: [], articleIds: [article], ownerAccountId: 'x' },
    { projectId: 'x', fixedArticleIds: [], articleIds: [] },
    { projectId: id, fixedArticleIds: [], articleIds: Array(21).fill(article) },
  ]) {
    answer = bad;
    await expect(client.journal(id)).rejects.toBeInstanceOf(ProjectClientError);
  }
  const before = calls.length;
  await expect(client.setJournalLink(id, 'not-a-uuid', true)).rejects.toBeInstanceOf(
    ProjectClientError,
  );
  expect(calls).toHaveLength(before);
  // The public page: journal is optional (older Worker), dated, and never repeats a fixed article.
  const page = {
    project,
    author,
    articles: [{ id: fixed, title: '公開時の記事' }],
    journal: [{ id: article, title: '日誌 1 日目', publishedOn: '2026-11-20' }],
  };
  const read = (v: unknown) =>
    createPublicProjectClient((async () => Response.json(v)) as typeof fetch, 'ordinary').read(id);
  expect(await read(page)).toEqual(page);
  const { journal: _journal, ...older } = page;
  expect(await read(older)).toEqual(older);
  for (const journal of [
    [{ id: article, title: '日誌', publishedOn: 'yesterday' }],
    [{ id: article, title: '日誌' }],
    [{ id: fixed, title: '重複', publishedOn: '2026-11-20' }],
    [{ id: article, title: '日誌', publishedOn: '2026-11-20', body: 'PRIVATE' }],
    null,
  ])
    await expect(read({ ...page, journal })).rejects.toBeInstanceOf(ProjectClientError);
});
