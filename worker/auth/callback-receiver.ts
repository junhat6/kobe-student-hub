/** Static, same-origin receiver. Provider values only exist in this document's memory. */
export const callbackReceiverScript = String.raw`(() => {
'use strict';
let fragment = location.hash;
let live = true;
const abort = new AbortController();
const message = () => {
  const status = document.getElementById('status');
  if (status) status.textContent = 'ログインを確認できませんでした。アカウント画面からやり直してください。';
};
const stop = () => { live = false; fragment = ''; abort.abort(); };
addEventListener('pagehide', stop);
addEventListener('pageshow', () => { if (!live) message(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stop(); });
(async () => {
  let timer;
  try {
    // Clear both query and fragment before parsing, requests, or navigation.
    history.replaceState(null, '', '/api/auth/callback');
    if (!live || document.visibilityState !== 'visible' || fragment.length > 8193 || !fragment.startsWith('#')) throw Error();
    const raw = fragment.slice(1);
    fragment = '';
    if (!raw || /%(?![a-fA-F0-9]{2})/.test(raw)) throw Error();
    const params = new URLSearchParams(raw);
    const critical = new Set(['state','code','error','error_description','iss']);
    if ([...params].length > 64) throw Error();
    for (const [key,value] of params) {
      if (!critical.has(key)) continue;
      if (params.getAll(key).length !== 1 || value.includes('\uFFFD') || /[\u0000-\u001f\u007f]/.test(value) || value.length > (key === 'code' ? 2048 : 1024)) throw Error();
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.get('state') || '')) throw Error();
    const code = params.get('code'), error = params.get('error');
    if ((code === null) === (error === null) || (code !== null && !/^[\x21-\x7e]{1,2048}$/.test(code)) || (error !== null && !/^[A-Za-z0-9_]{1,100}$/.test(error)) || (params.has('iss') && params.get('iss') !== 'https://accounts.google.com')) throw Error();
    const body = new URLSearchParams();
    for (const [key,value] of params) if (critical.has(key)) body.append(key,value);
    if (new TextEncoder().encode(body.toString()).byteLength > 8192 || !live) throw Error();
    timer = setTimeout(() => { stop(); message(); }, 15000);
    const response = await fetch('/api/auth/callback', {
      method: 'POST', credentials: 'same-origin', redirect: 'manual', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: abort.signal,
      headers: {'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body
    });
    if (!live) return;
    if (response.type !== 'opaqueredirect') throw Error();
    location.replace('/account#');
  } catch { if (live) message(); }
  finally { clearTimeout(timer); fragment = ''; }
})();
})();`;

export const callbackReceiverHtml =
  '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ログインの確認</title><p id="status" role="status">ログインを確認しています。</p><p><a href="/account">アカウント画面へ</a></p><script src="/api/auth/callback/receive.js" defer></script></html>';

export const callbackReceiverCsp =
  "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

const critical = new Set(['state', 'code', 'error', 'error_description', 'iss']);
/** Bounded body is already decoded with fatal UTF-8 before this grammar runs. */
export function callbackParameters(raw: string): URLSearchParams | null {
  if (!raw || /%(?![a-fA-F0-9]{2})/.test(raw)) return null;
  const params = new URLSearchParams(raw);
  if ([...params].length > 64) return null;
  for (const [key, value] of params) {
    if (
      !key ||
      key.length > 128 ||
      (critical.has(key) && params.getAll(key).length !== 1) ||
      key.includes('\uFFFD') ||
      /[\u0000-\u001f\u007f]/.test(key) ||
      value.includes('\uFFFD') ||
      /[\u0000-\u001f\u007f]/.test(value) ||
      value.length > (key === 'code' ? 2048 : 1024)
    )
      return null;
  }
  const state = params.get('state'),
    code = params.get('code'),
    error = params.get('error');
  if (
    !state ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    (code === null) === (error === null) ||
    (code !== null && !/^[\x21-\x7e]{1,2048}$/.test(code)) ||
    (error !== null && !/^[A-Za-z0-9_]{1,100}$/.test(error)) ||
    (params.has('iss') && params.get('iss') !== 'https://accounts.google.com')
  )
    return null;
  // RFC provider extensions are bounded and ignored. Only canonical protocol values survive.
  return new URLSearchParams({
    state,
    ...(code === null ? { error: error! } : { code }),
    ...(params.has('iss') ? { iss: params.get('iss')! } : {}),
  });
}
