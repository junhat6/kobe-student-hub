import { expect } from 'vitest';

// Per-route guard for the private JSON APIs that read their body through `readBoundedJson`
// (#283/#287). `tests/http-boundary.test.ts` covers the reader itself; this checks, through each
// real handler, that the route still answers 415/400/413 and an empty body the same way and
// passes its own byte limit to the reader (a wrong or swapped limit fails here, not there).

/** Sends one request to the route under test and returns the status. `body` is sent verbatim. */
export type RawSend = (
  body: string | undefined,
  headers?: Record<string, string>,
) => Promise<number>;

const encoder = new TextEncoder();

/** The same JSON value padded with trailing whitespace to exactly `size` UTF-8 bytes. */
export function paddedJson(value: unknown, size: number): string {
  const text = JSON.stringify(value);
  const length = encoder.encode(text).byteLength;
  if (length > size) throw new Error(`DTO is ${length} bytes, over ${size}`);
  const padded = text + ' '.repeat(size - length);
  expect(encoder.encode(padded).byteLength).toBe(size);
  return padded;
}

export async function expectBoundedJsonRoute(
  send: RawSend,
  route: {
    /** The route's byte limit, as passed to `readBoundedJson`. */
    bytes: number;
    /** A DTO the route accepts as input (it decodes; the store may still answer 4xx/2xx). */
    valid: unknown;
    /** What the route answers for `valid` once it is past the body reader. */
    accepted: number;
  },
) {
  const body = JSON.stringify(route.valid);
  // 415: not utf-8 JSON, or an encoded body.
  const unsupported: Record<string, string>[] = [
    { 'Content-Type': 'text/plain' },
    { 'Content-Type': 'application/json; charset=latin1' },
    { 'Content-Encoding': 'gzip' },
  ];
  for (const headers of unsupported)
    expect(await send(body, headers), JSON.stringify(headers)).toBe(415);
  // 400: malformed JSON, an empty body and no body at all.
  expect(await send('{"a":')).toBe(400);
  expect(await send('')).toBe(400);
  expect(await send(undefined)).toBe(400);
  // 413 exactly one byte past the route's limit, with the same valid DTO either side.
  expect(await send(paddedJson(route.valid, route.bytes + 1))).toBe(413);
  expect(await send(paddedJson(route.valid, route.bytes))).toBe(route.accepted);
}
