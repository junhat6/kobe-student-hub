import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, base64url, type JWTPayload } from 'jose';
import { verifySchoolGoogleIdToken } from '../worker/auth/google-identity';
import { googleFixture, TEST_CLIENT_ID, TEST_EMAIL, TEST_NONCE } from './helpers/google-fixtures';
let fixture: Awaited<ReturnType<typeof googleFixture>>;
const context = { clientId: TEST_CLIENT_ID, expectedNonce: TEST_NONCE };
const fetchKeys = vi.fn();
beforeAll(async () => {
  fixture = await googleFixture();
  fetchKeys.mockImplementation(async (url: string | URL) => {
    expect(String(url)).toBe('https://www.googleapis.com/oauth2/v3/certs');
    return Response.json(fixture.jwks, { headers: { 'Cache-Control': 'public, max-age=600' } });
  });
  vi.stubGlobal('fetch', fetchKeys);
});
afterAll(() => vi.unstubAllGlobals());
describe('server Google identity boundary with real JOSE signatures', () => {
  it('verifies a signed school identity and returns only private minimal fields', async () => {
    expect(await verifySchoolGoogleIdToken(await fixture.sign(), context)).toEqual({
      provider: 'google',
      subject: 'fictional-google-subject',
      email: TEST_EMAIL,
    });
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });
  it('supports the documented alternate Google issuer and matching azp', async () => {
    expect(
      await verifySchoolGoogleIdToken(
        await fixture.sign({ iss: 'accounts.google.com', azp: TEST_CLIENT_ID }),
        context,
      ),
    ).not.toBeNull();
  });
  it.each([
    ['foreign issuer', { iss: 'https://example.invalid' }],
    ['foreign audience', { aud: 'other.apps.googleusercontent.com' }],
    ['multi-client audience', { aud: [TEST_CLIENT_ID, 'other'] }],
    ['foreign presenter', { azp: 'other.apps.googleusercontent.com' }],
    ['expired', { exp: 1 }],
    ['old issued-at', { iat: Math.floor(Date.now() / 1000) - 3600 }],
    ['future issued-at', { iat: Math.floor(Date.now() / 1000) + 60 }],
    ['missing expiry', { exp: undefined }],
    ['missing subject', { sub: undefined }],
    ['blank subject', { sub: ' ' }],
    ['unverified email', { email_verified: false }],
    ['string verified flag', { email_verified: 'true' }],
    ['missing hosted domain', { hd: undefined }],
    ['lookalike hosted domain', { hd: 'st.kobedenshi.ac.jp.example.invalid' }],
    ['wrong email domain', { email: 'fixture@example.invalid' }],
    ['email suffix attack', { email: 'fixture@st.kobedenshi.ac.jp.example.invalid' }],
    ['malformed email', { email: 'fixture@@st.kobedenshi.ac.jp' }],
    ['nonce mismatch', { nonce: 'wrong-nonce' }],
    ['missing nonce', { nonce: undefined }],
  ] satisfies [string, JWTPayload][])('rejects %s', async (_label, patch) => {
    expect(await verifySchoolGoogleIdToken(await fixture.sign(patch), context)).toBeNull();
  });
  it('rejects tampering, foreign signing keys, unknown kid and algorithm confusion', async () => {
    const parts = (await fixture.sign()).split('.');
    parts[1] = base64url.encode(JSON.stringify({ ...fixture.claims, sub: 'tampered' }));
    expect(await verifySchoolGoogleIdToken(parts.join('.'), context)).toBeNull();
    const foreign = await googleFixture();
    expect(await verifySchoolGoogleIdToken(await foreign.sign(), context)).toBeNull();
    expect(
      await verifySchoolGoogleIdToken(await fixture.sign({}, 'unrecognized-key'), context),
    ).toBeNull();
    const hmac = await new SignJWT(fixture.claims)
      .setProtectedHeader({ alg: 'HS256', kid: 'fixture-rsa-key' })
      .sign(new Uint8Array(32));
    expect(await verifySchoolGoogleIdToken(hmac, context)).toBeNull();
  });
  it('fails closed before network for missing configuration or malformed/oversized token', async () => {
    const before = fetchKeys.mock.calls.length;
    const signed = await fixture.sign();
    for (const c of [
      {},
      { clientId: TEST_CLIENT_ID },
      { ...context, expectedNonce: 'short' },
      { ...context, clientId: 'not-a-client' },
    ])
      expect(await verifySchoolGoogleIdToken(signed, c)).toBeNull();
    for (const token of ['not-a-jwt', 'a.b.', 'a'.repeat(17000), JSON.stringify(fixture.claims)])
      expect(await verifySchoolGoogleIdToken(token, context)).toBeNull();
    expect(fetchKeys.mock.calls).toHaveLength(before);
  });
  it('fails closed if the public-key fetch is unavailable', async () => {
    vi.resetModules();
    fetchKeys.mockRejectedValueOnce(new Error('fixture-network-unavailable'));
    const fresh = await import('../worker/auth/google-identity');
    expect(await fresh.verifySchoolGoogleIdToken(await fixture.sign(), context)).toBeNull();
  });
});
