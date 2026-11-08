import { fixtureStartRequest, fixtureClaim } from '../helpers/coordinated-fixture';
import { GoogleLoginBroker } from '../../worker/auth/google-login';
import { BrowserOAuthFlow, type OAuthIntent } from '../../worker/auth/browser-flow';
import { PendingRegistrationStore } from '../../worker/auth/pending-registration';
// Test-only private JSON harness; no production route imports this fixture.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const i = (await request.json()) as {
      action: string;
      now: number;
      key: number[];
      url: string;
      method?: string;
      headers?: Record<string, string>;
      clientSecret?: string;
      intent?: OAuthIntent;
      identity?: Parameters<PendingRegistrationStore['record']>[0];
      race?: string;
      fault?: boolean;
    };
    let changed = false;
    const pending = new WeakSet<object>();
    const mutate = async () => {
      if (i.fault) throw Error('private fixture storage failure');
      if (!changed && i.race) {
        changed = true;
        await env.DB.prepare('UPDATE private_accounts SET status=? WHERE google_subject=?')
          .bind(i.race, 'race-subject')
          .run();
      }
    };
    const db =
      i.race || i.fault
        ? new Proxy(env.DB, {
            get(t, k) {
              if (k === 'batch')
                return async (statements: D1PreparedStatement[]) => {
                  if (statements.some((s) => pending.has(s))) await mutate();
                  return t.batch(statements);
                };
              if (k !== 'prepare') {
                const v = Reflect.get(t, k);
                return typeof v === 'function' ? v.bind(t) : v;
              }
              return (sql: string) => {
                const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
                  const proxy = new Proxy(statement, {
                    get(a, p) {
                      if (p === 'bind') return (...args: unknown[]) => wrap(a.bind(...args));
                      const v = Reflect.get(a, p);
                      return typeof v === 'function' ? v.bind(a) : v;
                    },
                  });
                  if (sql.startsWith('INSERT INTO private_accounts')) pending.add(proxy);
                  return proxy;
                };
                return wrap(t.prepare(sql));
              };
            },
          })
        : env.DB;
    let fixtureContext = '';
    const config = {
        origin: 'https://app.example.invalid',
        clientId: 'fixture-web-client.apps.googleusercontent.com',
        cookieKey: new Uint8Array(i.key),
        clientSecret: i.clientSecret!,
      },
      broker = new GoogleLoginBroker(db, config, () => i.now),
      target = new Request(i.url, { method: i.method ?? 'GET', headers: i.headers });
    let preparedTarget = target;
    if (['start-registration', 'start-login', 'flow-start'].includes(i.action)) {
      const prepared = await fixtureStartRequest(
        db,
        target,
        config.origin,
        i.now,
        i.action === 'start-login' ? 'login' : (i.intent ?? 'pending-registration'),
      );
      preparedTarget = prepared.request;
      fixtureContext = prepared.contextCookie;
    }
    const value =
      i.action === 'start-registration'
        ? await broker.startRegistration(preparedTarget)
        : i.action === 'registration'
          ? await broker.registrationCallback(target)
          : i.action === 'start-login'
            ? await broker.start(preparedTarget)
            : i.action === 'login'
              ? await broker.callback(target)
              : i.action === 'flow-start'
                ? await new BrowserOAuthFlow(db, config, () => i.now).start(
                    preparedTarget,
                    i.intent,
                  )
                : i.action === 'flow-claim'
                  ? await new BrowserOAuthFlow(db, config, () => i.now).claim(target, i.intent)
                  : await (async () => {
                      const claim = await fixtureClaim(
                        db,
                        config.origin,
                        i.now,
                        'pending-registration',
                      );
                      return claim
                        ? await new PendingRegistrationStore(db, () => i.now).record(
                            i.identity!,
                            claim.proof,
                          )
                        : null;
                    })();
    return Response.json(
      value && fixtureContext ? { ...value, contextCookie: fixtureContext } : value,
    );
  },
};
