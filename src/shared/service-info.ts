export interface PublicServiceInfo {
  contactUrl: string | null;
}

const credentialKeys = new Set([
  'token',
  'accesstoken',
  'idtoken',
  'refreshtoken',
  'apikey',
  'key',
  'password',
  'passwd',
  'secret',
  'clientsecret',
  'authorization',
  'auth',
  'authtoken',
  'authkey',
  'bearer',
  'jwt',
  'credentials',
  'code',
  'state',
  'nonce',
  'session',
  'sessionid',
  'csrftoken',
]);

/** A deliberately public destination, never a credential or a prefilled private message. */
export function publicContactUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(value) ||
    /%(?:0[\da-f]|1[\da-f]|7f)/i.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === 'mailto:') {
      if (url.search || url.hash || value.includes('%')) return null;
      const address = url.pathname;
      if (
        address.length > 254 ||
        !/^[A-Za-z0-9.!$&'*+/=^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
          address,
        )
      )
        return null;
      return 'mailto:' + address;
    }
    if (url.protocol !== 'https:' || url.port) return null;
    for (const params of [url.searchParams, new URLSearchParams(url.hash.slice(1))])
      for (const key of params.keys())
        if (credentialKeys.has(key.toLowerCase().replace(/[-_]/g, ''))) return null;
    return url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}

export function isPublicServiceInfo(value: unknown): value is PublicServiceInfo {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, 'contactUrl')
  )
    return false;
  const url = (value as Record<string, unknown>).contactUrl;
  return url === null || (typeof url === 'string' && publicContactUrl(url) === url);
}
