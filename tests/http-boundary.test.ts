import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalOrigin, readBoundedJson } from '../worker/http-boundary';

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
    // A hand-rolled reader shows up as the JSON Content-Type pattern; the binary upload readers
    // (media, avatars) never test for application/json. The OAuth dynamic client registration
    // reader is a deliberate exception: it answers RFC 7591 errors (null → invalid_client_metadata),
    // not 415/413, and accepts only the unquoted utf-8 charset. Changing it is a separate R2 change.
    expect(
      sources.filter((f) => readFileSync(f, 'utf8').includes('application\\/json(?:')),
    ).toEqual(['worker/auth/oauth-http.ts']);
  });
});
