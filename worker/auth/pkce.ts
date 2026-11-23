import { base64url } from 'jose';

/** RFC 7636 code_verifier: 43–128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * S256 code_challenge for a verifier, or null when the value is not an RFC 7636 verifier.
 * Shared by the Google login flow and the AI agent token exchange so the format check
 * cannot be dropped by a caller that forgets to repeat it.
 */
export async function pkceChallenge(verifier: unknown): Promise<string | null> {
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier)) return null;
  return base64url.encode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
}
