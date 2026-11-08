class AnonymousReadError extends Error {}
/** Bounded anonymous JSON transport: no identity bootstrap or credentials. */
export async function readAnonymousJson(
  path: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
  maxBytes = 262144,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 262144)
    throw new AnonymousReadError();
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (error: AnonymousReadError) => void = () => {};
  const cancel = () => {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  };
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    cancel();
    rejectAbort(new AnonymousReadError());
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const work = (async () => {
    if (controller.signal.aborted) throw new AnonymousReadError();
    const response = await fetcher(path, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (
      expired ||
      controller.signal.aborted ||
      response.status !== 200 ||
      !response.body ||
      !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
    ) {
      void response.body?.cancel().catch(() => {});
      throw new AnonymousReadError();
    }
    const length = response.headers.get('Content-Length');
    if (
      length !== null &&
      (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)
    ) {
      void response.body.cancel().catch(() => {});
      throw new AnonymousReadError();
    }
    reader = response.body.getReader();
    const bytes = new Uint8Array(maxBytes);
    let size = 0,
      count = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (expired || controller.signal.aborted) throw new AnonymousReadError();
        if (next.done) break;
        if (++count > 65536 || size + next.value.byteLength > bytes.length)
          throw new AnonymousReadError();
        bytes.set(next.value, size);
        size += next.value.byteLength;
      }
      const result: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
      );
      return result;
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
      reader = undefined;
    }
  })();
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      cancel();
      reject(new AnonymousReadError());
    }, 10000);
  });
  try {
    return await Promise.race([work, deadline, aborted]);
  } catch {
    throw new AnonymousReadError();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    cancel();
  }
}
