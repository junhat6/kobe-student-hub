import { parsePendingPilot } from './pending-pilot-policy';
import { parseOAuthConfig, type OAuthBindings } from './oauth-http';
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
export function pendingPilotPage(
  request: Request,
  bindings: OAuthBindings,
  now = Date.now(),
): Response | null {
  const u = new URL(request.url);
  if (!['/api/auth/pilot', '/api/auth/pilot.js'].includes(u.pathname)) return null;
  const config = parseOAuthConfig(bindings);
  if (
    request.method !== 'GET' ||
    u.search ||
    !config ||
    u.origin !== config.origin ||
    !parsePendingPilot(bindings.OAUTH_PENDING_PILOT, now)
  )
    return new Response('Not found', { status: 404, headers });
  if (u.pathname.endsWith('.js'))
    return new Response(script, {
      headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' },
    });
  return new Response(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>学校アカウント申請受付</title><body><main><h1>学校アカウント申請受付</h1><p>指定された学校アカウント1件の申請を受け付けます。Googleで確認されたメールアドレスと識別子を非公開で保存します。在籍承認・ログイン・投稿権限は付与しません。</p><p id="status" role="status"></p><button id="apply" type="button">Googleで申請する</button></main><script src="/api/auth/pilot.js" defer></script></body></html>`,
    { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
const script = `const button=document.getElementById('apply'),status=document.getElementById('status');
const messages={received:'申請を受け付けました。在籍承認・投稿権限はまだありません。',unavailable:'申請を受け付けられませんでした。'};
status.textContent=messages[location.hash.slice(1)]||'';history.replaceState(null,'','/api/auth/pilot');
button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Googleへ移動します。';try{
 const options={method:'POST',credentials:'same-origin',redirect:'error'};
 const bootstrap=await fetch('/api/auth/bootstrap',options);if(!bootstrap.ok&&bootstrap.status!==409)throw Error();
 const proof=await fetch('/api/auth/command?action=pending-registration',options);if(!proof.ok)throw Error();
 const {commandToken}=await proof.json();if(typeof commandToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(commandToken))throw Error();
 const start=await fetch('/api/auth/register',{...options,headers:{Authorization:'Bearer command.'+commandToken}});if(!start.ok)throw Error();
 const {authorizationUrl}=await start.json(),target=new URL(authorizationUrl);if(target.origin!=='https://accounts.google.com'||target.pathname!=='/o/oauth2/v2/auth')throw Error();
 location.assign(target.href);
 }catch{status.textContent=messages.unavailable;button.disabled=false;}});`;
