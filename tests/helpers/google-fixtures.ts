import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
export const TEST_CLIENT_ID = 'fixture-web-client.apps.googleusercontent.com';
export const TEST_NONCE = 'test-only-not-a-real-oauth-attempt-00000000000';
export const TEST_EMAIL = 'fixture-do-not-use@st.kobedenshi.ac.jp';
export async function googleFixture() {
  // Ephemeral keys are generated in memory; no live account, credential or private key is stored.
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture-rsa-key', alg: 'RS256', use: 'sig' };
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: JWTPayload = {
    iss: 'https://accounts.google.com', aud: TEST_CLIENT_ID, sub: 'fictional-google-subject',
    iat: issuedAt, exp: issuedAt + 600, nonce: TEST_NONCE, hd: 'st.kobedenshi.ac.jp',
    email: TEST_EMAIL, email_verified: true,
    name: 'Fictional name must stay private', picture: 'https://example.invalid/private-picture',
  };
  return {
    jwks: { keys: [jwk] }, claims,
    sign: (patch: JWTPayload = {}, kid = 'fixture-rsa-key') => new SignJWT({ ...claims, ...patch }).setProtectedHeader({ alg: 'RS256', kid }).sign(privateKey),
  };
}
