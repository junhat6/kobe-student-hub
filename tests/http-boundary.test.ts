import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalOrigin,
  IMAGE_BODY_MAX_CHUNKS,
  readBoundedImage,
  readBoundedJson,
} from '../worker/http-boundary';

const limits = { bytes: 64, chunks: 4 };
const encoder = new TextEncoder();
// A valid JSON object of exactly `size` bytes, so a size failure can only come from the bound.
const jsonOf = (size: number) => {
  const text = `{"a":"${'x'.repeat(size - 8)}"}`;
  expect(encoder.encode(text).byteLength).toBe(size);
  return text;
};
const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('https://hub.example/api/private/x', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
    // @ts-expect-error -- required by undici for a stream body
    duplex: 'half',
  });
const stream = (chunks: Uint8Array[], options: { hang?: boolean } = {}) => {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++]);
      else if (!options.hang) c.close();
    },
  });
};

afterEach(() => {
  vi.useRealTimers();
});

describe('canonicalOrigin — the one Origin check for every private API (#283)', () => {
  it.each(['https://hub.junhat6.com', 'https://localhost:8790', 'https://xn--r8jz45g.example'])(
    'accepts canonical https origin %s',
    (origin) => expect(canonicalOrigin(origin)).toBe(true),
  );
  it.each([
    'http://hub.junhat6.com',
    'https://hub.junhat6.com/',
    'https://hub.junhat6.com/path',
    'https://HUB.junhat6.com',
    'https://hub.junhat6.com:443',
    'https://user@hub.junhat6.com',
    'https://hub.junhat6.com?x=1',
    'hub.junhat6.com',
    '',
    'null',
  ])('rejects non-canonical or non-https origin %j', (origin) =>
    expect(canonicalOrigin(origin)).toBe(false),
  );
});

describe('readBoundedJson — the one bounded JSON request reader (#283)', () => {
  it('reads a body of exactly the byte limit and rejects one byte more with 413', async () => {
    const exact = jsonOf(64);
    expect(await readBoundedJson(post(exact), limits)).toEqual({
      ok: true,
      value: JSON.parse(exact),
    });
    expect(await readBoundedJson(post(jsonOf(65)), limits)).toEqual({ ok: false, status: 413 });
  });

  it('rejects a declared Content-Length over the limit before reading, and allows exactly the limit', async () => {
    const declared = (size: number) =>
      post(stream([encoder.encode(jsonOf(size))]), { 'Content-Length': String(size) });
    expect((await readBoundedJson(declared(64), limits)).ok).toBe(true);
    expect(await readBoundedJson(declared(65), limits)).toEqual({ ok: false, status: 413 });
  });

  it('answers 413 from the declared length alone, without waiting for the body', async () => {
    // The body never ends; only the up-front Content-Length check can answer 413 here.
    const declared = post(stream([], { hang: true }), { 'Content-Length': '65' });
    expect(await readBoundedJson(declared, { ...limits, timeoutMs: 50 })).toEqual({
      ok: false,
      status: 413,
    });
  });

  it('rejects an undeclared streamed body that grows past the limit with 413', async () => {
    const body = stream([encoder.encode(jsonOf(64).slice(0, 40)), encoder.encode('y'.repeat(25))]);
    expect(await readBoundedJson(post(body), limits)).toEqual({ ok: false, status: 413 });
  });

  it('bounds chunk count (zero-byte chunks included) separately from bytes', async () => {
    const text = encoder.encode(jsonOf(16));
    const parts = (n: number) => [...Array.from({ length: n - 1 }, () => new Uint8Array(0)), text];
    expect((await readBoundedJson(post(stream(parts(4))), limits)).ok).toBe(true);
    expect(await readBoundedJson(post(stream(parts(5))), limits)).toEqual({
      ok: false,
      status: 413,
    });
  });

  it.each([
    ['text/plain', 415],
    ['application/json; charset=latin1', 415],
    ['application/jsonx', 415],
    ['application/json; charset="utf-8"', 200],
    ['Application/JSON;charset=UTF-8', 200],
  ])('Content-Type %j → %i', async (type, status) => {
    const result = await readBoundedJson(post('{}', { 'Content-Type': type }), limits);
    expect(result.ok ? 200 : result.status).toBe(status);
  });

  it('rejects a missing Content-Type and a compressed body with 415', async () => {
    const untyped = new Request('https://hub.example/', { method: 'POST', body: '{}' });
    untyped.headers.delete('Content-Type');
    expect(await readBoundedJson(untyped, limits)).toEqual({ ok: false, status: 415 });
    expect(await readBoundedJson(post('{}', { 'Content-Encoding': 'gzip' }), limits)).toEqual({
      ok: false,
      status: 415,
    });
    expect((await readBoundedJson(post('{}', { 'Content-Encoding': 'Identity' }), limits)).ok).toBe(
      true,
    );
  });

  it.each([
    ['malformed Content-Length', post(stream([encoder.encode('{}')]), { 'Content-Length': '2x' })],
    [
      'Content-Length beyond a safe integer',
      post(stream([encoder.encode('{}')]), { 'Content-Length': '99999999999999999999' }),
    ],
    ['mismatched Content-Length', post(stream([encoder.encode('{}')]), { 'Content-Length': '3' })],
    ['missing body', post(null)],
    ['invalid JSON', post('{')],
    ['invalid UTF-8', post(new Uint8Array([0x22, 0xff, 0x22]))],
  ])('answers 400 for %s', async (_name, request) => {
    expect(await readBoundedJson(request, limits)).toEqual({ ok: false, status: 400 });
  });

  it('answers 408 when the body does not finish in time', async () => {
    vi.useFakeTimers();
    const pending = readBoundedJson(post(stream([encoder.encode('{')], { hang: true })), {
      ...limits,
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(49);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, status: 408 });
  });
});

describe('readBoundedImage — the one bounded image upload reader (#295)', () => {
  const image = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request('https://hub.example/api/private/x', {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'image/png', ...headers },
      // @ts-expect-error -- required by undici for a stream body
      duplex: 'half',
    });
  const bytes = (size: number) => new Uint8Array(size).fill(7);

  it('reads a body of exactly the byte limit and rejects one byte more with 413', async () => {
    const result = await readBoundedImage(image(bytes(64)), 64);
    expect(result).toEqual({ bytes: bytes(64), mime: 'image/png' });
    expect(await readBoundedImage(image(bytes(65)), 64)).toEqual({ status: 413 });
  });

  it('keeps the Content-Type it accepted (jpeg and png only, exact match)', async () => {
    expect(await readBoundedImage(image(bytes(3), { 'Content-Type': 'image/jpeg' }), 64)).toEqual({
      bytes: bytes(3),
      mime: 'image/jpeg',
    });
  });

  it('answers 413 from the declared length alone, without waiting for the body', async () => {
    const declared = image(stream([], { hang: true }), { 'Content-Length': '65' });
    expect(await readBoundedImage(declared, 64)).toEqual({ status: 413 });
    const exact = image(stream([bytes(64)]), { 'Content-Length': '64' });
    expect('bytes' in (await readBoundedImage(exact, 64))).toBe(true);
  });

  it('rejects an undeclared streamed body that grows past the limit with 413', async () => {
    expect(await readBoundedImage(image(stream([bytes(40), bytes(25)])), 64)).toEqual({
      status: 413,
    });
  });

  it('bounds chunk count (zero-byte chunks included) at 4096', async () => {
    expect(IMAGE_BODY_MAX_CHUNKS).toBe(4096);
    const parts = (n: number) => [
      ...Array.from({ length: n - 1 }, () => new Uint8Array(0)),
      bytes(1),
    ];
    expect('bytes' in (await readBoundedImage(image(stream(parts(4096))), 64))).toBe(true);
    expect(await readBoundedImage(image(stream(parts(4097))), 64)).toEqual({ status: 413 });
  });

  it.each([
    ['image/svg+xml', {}],
    ['image/gif', {}],
    ['text/plain', {}],
    ['image/png; charset=utf-8', {}],
    ['IMAGE/PNG', {}],
    ['image/png', { 'Content-Encoding': 'gzip' }],
    ['image/png', { 'Content-Encoding': 'Identity' }],
  ])('answers 415 for Content-Type %j %j', async (type, extra) => {
    expect(await readBoundedImage(image(bytes(3), { 'Content-Type': type, ...extra }), 64)).toEqual(
      { status: 415 },
    );
  });

  it('accepts an explicit identity Content-Encoding', async () => {
    const r = await readBoundedImage(image(bytes(3), { 'Content-Encoding': 'identity' }), 64);
    expect('bytes' in r).toBe(true);
  });

  it.each([
    ['malformed Content-Length', () => image(stream([bytes(2)]), { 'Content-Length': '2x' })],
    [
      'Content-Length beyond a safe integer',
      () => image(stream([bytes(2)]), { 'Content-Length': '99999999999999999999' }),
    ],
    ['mismatched Content-Length', () => image(stream([bytes(2)]), { 'Content-Length': '3' })],
    ['missing body', () => image(null)],
    ['empty body', () => image(new Uint8Array(0))],
    ['empty stream', () => image(stream([new Uint8Array(0)]))],
  ])('answers 400 for %s', async (_name, request) => {
    expect(await readBoundedImage(request(), 64)).toEqual({ status: 400 });
  });

  it('answers 408 when the body does not finish within 5 seconds', async () => {
    vi.useFakeTimers();
    const pending = readBoundedImage(image(stream([bytes(1)], { hang: true })), 64);
    await vi.advanceTimersByTimeAsync(4999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ status: 408 });
  });
});

describe('the image upload routes keep no copy of their own (#295)', () => {
  it.each([
    ['worker/media-http.ts', 'MEDIA_MAX_BYTES'],
    ['worker/profile-avatars-http.ts', 'AVATAR_MAX_BYTES'],
  ])('%s reads the upload only through readBoundedImage with %s', (file, limit) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain(`readBoundedImage(request, ${limit})`);
    expect(source).not.toContain('getReader(');
    expect(source).not.toContain("'image/jpeg'");
    // The body is read only after authorization: one read, placed after the one authorizeUpload
    // call. A 404 status test cannot see a read hoisted above it whose result is used later.
    expect(source.split('readBoundedImage(request').length - 1).toBe(1);
    expect(source.split('authorizeUpload(').length - 1).toBe(1);
    expect(source.indexOf('authorizeUpload(')).toBeLessThan(
      source.indexOf('readBoundedImage(request'),
    );
  });
});

describe('the private JSON APIs keep no copy of their own (#283)', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(`${dir}/${e.name}`)
        : e.name.endsWith('.ts')
          ? [`${dir}/${e.name}`]
          : [],
    );
  const sources = files('worker').filter((file) => file !== 'worker/http-boundary.ts');

  it('defines canonicalOrigin only in worker/http-boundary.ts', () => {
    expect(
      sources.filter((f) => /function canonicalOrigin\b/.test(readFileSync(f, 'utf8'))),
    ).toEqual([]);
  });

  it('reads JSON request bodies only through readBoundedJson', () => {
    // A hand-rolled reader shows up as the JSON Content-Type pattern; the image upload reader
    // (readBoundedImage) never tests for application/json. The OAuth dynamic client registration
    // reader is a deliberate exception: it answers RFC 7591 errors (null → invalid_client_metadata),
    // not 415/413, and accepts only the unquoted utf-8 charset. Changing it is a separate R2 change.
    expect(
      sources.filter((f) => readFileSync(f, 'utf8').includes('application\\/json(?:')),
    ).toEqual(['worker/auth/oauth-http.ts']);
  });
});
