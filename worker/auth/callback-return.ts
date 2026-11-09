import { EncryptJWT, jwtDecrypt } from 'jose';
import { callbackParameters } from './callback-receiver';
import type { BrowserFlowConfig } from './browser-flow';

const COOKIE = '__Host-kobe-oauth-return';
const ISSUER = 'kobe-student-hub:oauth-callback-return';
const TYPE = 'oauth-callback-return+jwt';
const TTL_SECONDS = 60;
const COOKIE_LIMIT = 3800;
const completePath = '/api/auth/callback/complete';
const audience = (config: BrowserFlowConfig) =>
  config.clientId + '|' + config.origin + completePath;
const validTime = (now: number) =>
  Number.isSafeInteger(now) && now >= 0 && now < Number.MAX_SAFE_INTEGER - TTL_SECONDS * 1000;

/** An untrusted transport envelope only. The original broker still proves every authority. */
export async function sealCallbackReturn(
  params: URLSearchParams,
  config: BrowserFlowConfig,
  now: number,
): Promise<string | null> {
  try {
    const canonical = callbackParameters(params.toString());
    if (!canonical || !validTime(now)) return null;
    const issued = Math.floor(now / 1000);
    const sealed = await new EncryptJWT({ parameters: canonical.toString() })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: TYPE })
      .setIssuer(ISSUER)
      .setAudience(audience(config))
      .setIssuedAt(issued)
      .setExpirationTime(issued + TTL_SECONDS)
      .encrypt(config.cookieKey);
    const cookie = `${COOKIE}=${sealed}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SECONDS}`;
    return cookie.length <= COOKIE_LIMIT ? cookie : null;
  } catch {
    return null;
  }
}

export async function readCallbackReturn(
  header: string | null,
  config: BrowserFlowConfig,
  now: number,
): Promise<URLSearchParams | null> {
  try {
    if (!header || header.length > 16384 || !validTime(now)) return null;
    const values = header
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(COOKIE + '='))
      .map((part) => part.slice(COOKIE.length + 1));
    if (values.length !== 1 || !values[0] || values[0].length > COOKIE_LIMIT) return null;
    const { payload, protectedHeader } = await jwtDecrypt(values[0], config.cookieKey, {
      issuer: ISSUER,
      audience: audience(config),
      typ: TYPE,
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
      requiredClaims: ['iat', 'exp'],
      maxTokenAge: TTL_SECONDS,
      clockTolerance: 0,
      currentDate: new Date(now),
    });
    if (
      protectedHeader.typ !== TYPE ||
      payload.aud !== audience(config) ||
      Object.keys(payload).length !== 5 ||
      typeof payload.parameters !== 'string' ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp !== (payload.iat as number) + TTL_SECONDS ||
      now >= (payload.exp as number) * 1000
    )
      return null;
    const params = callbackParameters(payload.parameters);
    return params?.toString() === payload.parameters ? params : null;
  } catch {
    return null;
  }
}
