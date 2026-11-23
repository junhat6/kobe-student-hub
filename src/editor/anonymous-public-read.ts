import { boundedReadFailure, readBoundedJson } from '../shared/http-client';
class AnonymousReadError extends Error {}
/** The server answered 404: the public item does not exist or is not public (reason withheld). */
class AnonymousReadMissing extends AnonymousReadError {}
/** True when a read failed because the item is absent or not public, not because of the network. */
export function publicReadMissing(error: unknown): boolean {
  return (
    error instanceof AnonymousReadMissing ||
    (error instanceof Error && (error as { missing?: unknown }).missing === true)
  );
}
/**
 * Tells the header the server answered a public read, so a header that could not read the
 * session during an outage re-checks it. Carries no URL, content or identity.
 */
export function announceServerReachable() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ksh:server-reachable'));
}
/** Bounded anonymous JSON transport: no identity bootstrap or credentials. */
export async function readAnonymousJson(
  path: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
  maxBytes = 262144,
): Promise<unknown> {
  try {
    return await readBoundedJson(path, {
      fetcher,
      credentials: 'omit',
      maxBytes,
      maxChunks: 65536,
      signal,
      onResponse: announceServerReachable,
    });
  } catch (error) {
    throw boundedReadFailure(error) === 'missing'
      ? new AnonymousReadMissing()
      : new AnonymousReadError();
  }
}
