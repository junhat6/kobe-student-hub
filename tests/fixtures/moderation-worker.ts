import { createFixtureSession } from '../helpers/coordinated-fixture';
import { SessionStore } from '../../worker/auth/sessions';
import { ArticleModerationStore } from '../../worker/moderation';
// Test-only fictional sessions and after-auth races. No production route imports this file.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const i = (await request.json()) as {
      action: string;
      now: number;
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      who?: string;
      target?: unknown;
      input?: unknown;
      disabled?: boolean;
      invalidConfig?: boolean;
      race?: string;
    };
    const origin = 'https://app.example.invalid';
    if (i.action === 'session')
      return Response.json(
        await createFixtureSession(env.DB, origin, () => i.now, {
          provider: 'google',
          subject: 'subject-' + i.who,
          email: 'fixture@st.kobedenshi.ac.jp',
        }),
      );
    let injected = false;
    const db = i.race
      ? new Proxy(env.DB, {
          get(target, key) {
            if (key !== 'prepare') {
              const value = Reflect.get(target, key);
              return typeof value === 'function' ? value.bind(target) : value;
            }
            return (sql: string) => {
              const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
                new Proxy(stmt, {
                  get(statement, prop) {
                    if (prop === 'bind')
                      return (...values: unknown[]) => wrap(statement.bind(...values));
                    if (prop === 'first')
                      return async (...args: Parameters<D1PreparedStatement['first']>) => {
                        const result = await statement.first(...args);
                        if (!injected && sql.startsWith('UPDATE auth_sessions SET last_seen_ms=')) {
                          injected = true;
                          if (i.race === 'status')
                            await env.DB.prepare(
                              "UPDATE private_accounts SET status='suspended'",
                            ).run();
                          else if (i.race === 'context')
                            await env.DB.prepare(
                              'UPDATE auth_browser_contexts SET generation=generation+1 WHERE context_hash IN(SELECT context_hash FROM auth_sessions WHERE account_id=?)',
                            )
                              .bind((result as { account_id?: string } | null)?.account_id ?? '')
                              .run();
                          else if (i.race === 'epoch')
                            await env.DB.prepare(
                              'UPDATE private_accounts SET session_epoch=session_epoch+1',
                            ).run();
                          else
                            await env.DB.prepare('UPDATE auth_sessions SET revoked_at_ms=?')
                              .bind(i.now)
                              .run();
                        }
                        return result;
                      };
                    const value = Reflect.get(statement, prop);
                    return typeof value === 'function' ? value.bind(statement) : value;
                  },
                });
              return wrap(target.prepare(sql));
            };
          },
        })
      : env.DB;
    const store = new ArticleModerationStore(
      db,
      origin,
      i.disabled ? [] : i.invalidConfig ? Array(11).fill('operator') : ['operator'],
      () => i.now,
    );
    const target = new Request(i.url ?? origin + '/private/report', {
      method: i.method ?? (i.action === 'report' ? 'POST' : 'GET'),
      headers: i.headers,
    });
    return Response.json(
      i.action === 'report'
        ? await store.report(target, i.target, i.input)
        : i.action === 'queue'
          ? await store.queue(target)
          : await store.readCase(target, i.target),
    );
  },
};
