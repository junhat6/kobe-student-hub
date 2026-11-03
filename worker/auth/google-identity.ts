import { createRemoteJWKSet, jwtVerify } from 'jose';

export const SCHOOL_GOOGLE_DOMAIN = 'st.kobedenshi.ac.jp';
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
// Public signing-key cache only: no request tokens or personal identity in module state.
const googleKeys = createRemoteJWKSet(GOOGLE_JWKS_URL, {
  timeoutDuration: 5_000,
  cooldownDuration: 30_000,
  cacheMaxAge: 600_000,
});

export interface GoogleVerificationContext {
  // Must come from server configuration and a server-bound, unconsumed OAuth attempt.
  clientId?: string;
  expectedNonce?: string;
}

/** Internal/private identity. Never return this object through a public profile DTO. */
export interface VerifiedSchoolIdentity {
  readonly provider: 'google';
  readonly subject: string;
  readonly email: string;
}

/**
 * Real signature and claims verification. Does not create a session or prove enrollment.
 * Future OAuth code must atomically consume its state/nonce before issuing a session.
 * All failures (including configuration/network/JWKS errors) fail closed without logging.
 */
export async function verifySchoolGoogleIdToken(
  token: string,
  context: GoogleVerificationContext,
): Promise<VerifiedSchoolIdentity | null> {
  const { clientId, expectedNonce } = context;
  if (!clientId || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) return null;
  if (!expectedNonce || !/^[A-Za-z0-9_-]{32,128}$/.test(expectedNonce)) return null;
  if (typeof token !== 'string' || token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;

  try {
    const { payload } = await jwtVerify(token, googleKeys, {
      algorithms: ['RS256'],
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'nonce', 'email', 'email_verified', 'hd'],
      maxTokenAge: 600,
      clockTolerance: 5,
    });
    // A dedicated single web-client audience is supported initially. No implicit multi-client trust.
    if (payload.aud !== clientId || (payload.azp !== undefined && payload.azp !== clientId)) return null;
    if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 255) return null;
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp! <= payload.iat!) return null;
    if (payload.nonce !== expectedNonce) return null;
    if (payload.email_verified !== true || payload.hd !== SCHOOL_GOOGLE_DOMAIN) return null;
    if (typeof payload.email !== 'string' || payload.email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(payload.email)) return null;
    if (payload.email.split('@')[1].toLowerCase() !== SCHOOL_GOOGLE_DOMAIN) return null;

    // Deliberately omit Google name, picture, domain hints and the original token.
    return Object.freeze({ provider: 'google', subject: payload.sub, email: payload.email });
  } catch {
    return null;
  }
}
