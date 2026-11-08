import { fixtureStartRequest, fixtureClaim } from '../helpers/coordinated-fixture';
import { GoogleLoginBroker } from '../../worker/auth/google-login';
// Private test harness only; never import this fixture into the application.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const i = (await request.json()) as {
      action: string;
      now: number;
      url: string;
      method?: string;
      headers?: Record<string, string>;
      key: number[];
      clientSecret?: string | null;
    };
    const broker = new GoogleLoginBroker(
      env.DB,
      {
        origin: 'https://app.example.invalid',
        clientId: 'fixture-web-client.apps.googleusercontent.com',
        cookieKey: new Uint8Array(i.key),
        clientSecret: i.clientSecret as string,
      },
      () => i.now,
    );
    let target = new Request(i.url, { method: i.method ?? 'GET', headers: i.headers });
    if (i.action === 'start') {
      const prepared = await fixtureStartRequest(
        env.DB,
        target,
        'https://app.example.invalid',
        i.now,
      );
      target = prepared.request;
      const result = await broker.start(target);
      return Response.json(result ? { ...result, contextCookie: prepared.contextCookie } : null);
    }
    return Response.json(await broker.callback(target));
  },
};
