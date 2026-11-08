/** CLOSED LOCAL FIXTURE. Never import from production. No Google/operational keys.
 * Identity comes from an injected synthetic provider, not real authentication.
 * Fault/pause headers and fixture identity DTOs MUST NOT be exposed in an app. */
const O = 'https://session-order.fixture.test';
const C = '__Host-lab-context',
  S = '__Host-lab-session',
  A = '__Host-lab-attempt';
const fresh = () => crypto.randomUUID();
const privacy = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const json = (status: number, body: object) => Response.json(body, { status, headers: privacy });
const redirect = (setCookie?: string) =>
  new Response(null, {
    status: 303,
    headers: { ...privacy, Location: O + '/', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) },
  });
const cookie = (name: string, value: string, age: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
function read(req: Request, name: string) {
  const h = req.headers.get('Cookie');
  if (!h || h.length > 16384) return null;
  const vs = h
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + '='))
    .map((s) => s.slice(name.length + 1));
  return vs.length === 1 && /^[a-f0-9-]{36}$/.test(vs[0]) ? vs[0] : null;
}
async function digest(s: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
}
async function actorBody(r: Response) {
  if (!r.body) return null;
  const reader = r.body.getReader();
  let size = 0,
    value = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1) return null;
      value += new TextDecoder().decode(part.value);
    }
    return size === 1 ? value : null;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
const live = `s.context=?1 AND s.token=?2 AND c.epoch=s.epoch AND c.expires>?3 AND s.expires>?3 AND a.status='active' AND a.epoch=s.account_epoch`;
const joins =
  'lab_sessions s JOIN lab_contexts c ON c.id=s.context JOIN lab_accounts a ON a.id=s.actor';
async function gate(req: Request, phase: string) {
  const tag = req.headers.get('X-Lab-Pause-' + phase);
  if (tag) {
    const r = await fetch('https://closed-provider.invalid/pause/' + encodeURIComponent(tag));
    await r.body?.cancel();
  }
}
function fault(req: Request, phase: string, db: D1Database) {
  return req.headers.get('X-Lab-Fault') === phase ? [db.prepare("SELECT json('not json')")] : [];
}
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const db = env.DB,
      url = new URL(request.url),
      path = url.pathname;
    const supplied = request.headers.get('X-Lab-Now'),
      now = supplied === null ? Date.now() : Number(supplied);
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 1000000)
      return json(400, { error: 'fixture_clock' });
    if (request.url.length > 8192) return json(400, { error: 'bounded' });
    const context = read(request, C),
      session = read(request, S);
    const finalNow = () => {
      const v = request.headers.get('X-Lab-After-Now'),
        n = v === null ? (supplied === null ? Date.now() : now) : Number(v);
      if (!Number.isSafeInteger(n) || n < now || n > Number.MAX_SAFE_INTEGER - 1000000)
        throw Error('fixture clock');
      return n;
    };
    if (request.method === 'POST') {
      if (
        request.headers.get('Origin') !== O ||
        !['same-origin', 'none', null].includes(request.headers.get('Sec-Fetch-Site'))
      )
        return json(403, { error: 'origin' });
      if (
        !['0', null].includes(request.headers.get('Content-Length')) ||
        request.headers.has('Content-Type') ||
        request.headers.has('Transfer-Encoding')
      )
        return json(400, { error: 'empty_command' });
      void request.body?.cancel().catch(() => {});
    }
    try {
      if (path === '/lab/bootstrap' && request.method === 'POST') {
        if (
          context &&
          (await db
            .prepare('SELECT 1 FROM lab_contexts WHERE id=? AND expires>?')
            .bind(context, now)
            .first())
        )
          return json(409, { error: 'already_established' });
        const raw = fresh();
        await db
          .prepare('INSERT INTO lab_contexts VALUES(?,0,?)')
          .bind(raw, now + 900000)
          .run();
        return new Response(null, {
          status: 204,
          headers: { ...privacy, 'Set-Cookie': cookie(C, raw, 900) },
        });
      }
      if (path === '/lab/proof' && request.method === 'POST') {
        const action = url.searchParams.get('action');
        if (!['start', 'logout'].includes(action ?? '')) return json(400, { error: 'action' });
        const command = fresh(),
          r = await db
            .prepare(
              'INSERT INTO lab_commands(id,context,action,expected,expires) SELECT ?,id,?,epoch,min(expires,?) FROM lab_contexts WHERE id=? AND expires>?',
            )
            .bind(command, action, now + 60000, context, now)
            .run();
        return r.meta.changes ? json(200, { command }) : json(409, { error: 'context_required' });
      }
      if (['/lab/start', '/lab/logout'].includes(path) && request.method === 'POST') {
        const action = path.endsWith('start') ? 'start' : 'logout',
          command = request.headers.get('X-Lab-Command');
        if (!command || !/^[a-f0-9-]{36}$/.test(command)) return json(403, { error: 'proof' });
        const attempt = action === 'start' ? fresh() : null;
        // Single conditional UPDATE + trigger is atomic; batch rollback includes trigger effects.
        const results = await db.batch([
          db
            .prepare(
              `UPDATE lab_commands SET completed=1,attempt=?1 WHERE id=?2 AND context=?3 AND action=?4 AND completed=0 AND expires>?5 AND EXISTS(SELECT 1 FROM lab_contexts c WHERE c.id=lab_commands.context AND c.epoch=lab_commands.expected AND c.epoch<9007199254740991 AND c.expires>?5) RETURNING attempt`,
            )
            .bind(attempt, command, context, action, now),
          ...fault(request, 'command', db),
          db
            .prepare(
              'SELECT completed FROM lab_commands WHERE id=? AND context=? AND action=? AND expires>?',
            )
            .bind(command, context, action, now),
        ]);
        const won = results[0].results.length > 0;
        if (!won) {
          const done = results.at(-1)!.results[0] as { completed: number } | undefined;
          return done?.completed === 1
            ? json(200, { kind: 'already-completed' })
            : json(409, { error: 'stale_command' });
        }
        // Simulate a committed operation whose acknowledgement is lost. No replayed Cookie.
        if (request.headers.get('X-Lab-Fault') === 'after-command')
          return json(503, { error: 'uncertain_command' });
        if (action === 'logout') return json(200, { loggedOut: true });
        return new Response(null, {
          status: 303,
          headers: {
            ...privacy,
            Location: O + '/lab/provider?state=' + attempt,
            'Set-Cookie': cookie(A, attempt!, 60),
          },
        });
      }
      if (path === '/lab/callback' && request.method === 'GET') {
        const state = url.searchParams.get('state'),
          code = url.searchParams.get('code'),
          attemptCookie = read(request, A);
        if (
          !state ||
          url.searchParams.getAll('state').length !== 1 ||
          url.searchParams.getAll('code').length !== 1 ||
          state !== attemptCookie ||
          !['A', 'B', 'fail'].includes(code ?? '')
        )
          return redirect();
        const owner = fresh();
        const claimed = await db
          .prepare(
            `UPDATE lab_attempts SET owner=?1 WHERE id=?2 AND context=?3 AND owner IS NULL AND expires>?4 AND EXISTS(SELECT 1 FROM lab_contexts c WHERE c.id=lab_attempts.context AND c.epoch=lab_attempts.epoch AND c.expires>?4) RETURNING epoch`,
          )
          .bind(owner, state, context, now)
          .first<{ epoch: number }>();
        if (!claimed) return redirect();
        await gate(request, 'claim');
        const provider = await fetch('https://closed-provider.invalid/exchange', {
          method: 'POST',
          body: JSON.stringify({ state, code }),
        });
        if (!provider.ok) {
          await provider.body?.cancel();
          return redirect();
        }
        // Synthetic provider has a bounded two-byte actor response, no key or Google tokens.
        const actor = await actorBody(provider);
        if (!actor || !['A', 'B'].includes(actor)) return redirect();
        const account = await db
          .prepare("SELECT epoch FROM lab_accounts WHERE id=? AND status='active'")
          .bind(actor)
          .first<{ epoch: number }>();
        if (!account) return redirect();
        await gate(request, 'issue');
        const at = finalNow();
        const raw = fresh(),
          hash = await digest(raw),
          csrf = fresh();
        const result = await db.batch([
          db
            .prepare(
              `INSERT INTO lab_sessions(token,context,epoch,attempt,actor,account_epoch,csrf,expires) SELECT ?1,t.context,t.epoch,t.id,a.id,a.epoch,?2,?3 FROM lab_attempts t JOIN lab_contexts c ON c.id=t.context JOIN lab_accounts a ON a.id=?4 WHERE t.id=?5 AND t.owner=?6 AND t.completed=0 AND t.context=?7 AND t.epoch=c.epoch AND c.expires>?8 AND t.expires>?8 AND a.status='active' AND a.epoch=?9 RETURNING token`,
            )
            .bind(hash, csrf, at + 300000, actor, state, owner, context, at, account.epoch),
          ...fault(request, 'issue', db),
        ]);
        if (request.headers.get('X-Lab-Fault') === 'after-issue')
          return json(503, { error: 'uncertain_issue' });
        return redirect(result[0].results.length ? cookie(S, raw, 300) : undefined);
      }
      if (['/lab/private', '/lab/read', '/lab/write'].includes(path)) {
        if (
          (path === '/lab/write' && request.method !== 'POST') ||
          (path !== '/lab/write' && request.method !== 'GET')
        )
          return json(405, { error: 'method' });
        if (request.headers.get('X-Lab-Fault') === 'lookup')
          await db.prepare('SELECT missing_lab_column FROM lab_contexts').first();
        const hash = session ? await digest(session) : '',
          csrf = request.headers.get('X-Lab-Session-CSRF');
        const pre = await db
          .prepare(`SELECT s.actor,s.csrf FROM ${joins} WHERE ${live}`)
          .bind(context, hash, now)
          .first<{ actor: string; csrf: string }>();
        if (!pre) return json(401, { error: 'signed_out' });
        if (path === '/lab/private') return json(200, pre); // fictional identities only; deliberately NOT a production DTO
        await gate(request, path === '/lab/write' ? 'write' : 'read');
        const at = finalNow();
        if (path === '/lab/write') {
          const r = await db
            .prepare(
              `UPDATE lab_records SET version=version+1 WHERE actor=?4 AND EXISTS(SELECT 1 FROM ${joins} WHERE ${live} AND s.actor=lab_records.actor AND s.csrf=?5) RETURNING version`,
            )
            .bind(context, hash, at, pre.actor, csrf)
            .first();
          return r ? json(200, { saved: true }) : json(401, { error: 'signed_out' });
        }
        const r = await db
          .prepare(
            `SELECT r.value FROM lab_records r WHERE r.actor=?4 AND EXISTS(SELECT 1 FROM ${joins} WHERE ${live} AND s.actor=r.actor)`,
          )
          .bind(context, hash, at, pre.actor)
          .first();
        return r ? json(200, r) : json(401, { error: 'signed_out' });
      }
      return json(404, { error: 'fixture_route' });
    } catch {
      return json(503, { error: 'unavailable' });
    }
  },
};
