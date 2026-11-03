// Test-only entry; no production OAuth callback or session behavior is exposed.
import { OAuthAttemptStore } from '../../worker/auth/oauth-attempts';
import { verifySchoolGoogleIdToken } from '../../worker/auth/google-identity';
interface Command { action: string; state?: string; browserBinding?: string; token?: string; now: number; }
export default {
  async fetch(request: Request, env: Env & { TEST_CLIENT_ID: string }) {
    const input = await request.json() as Command;
    const store = new OAuthAttemptStore(env.DB, () => input.now);
    if (input.action === 'start') return Response.json(await store.start());
    if (input.action === 'consume') return Response.json(await store.consume(input));
    if (input.action === 'cleanup') return Response.json({ removed: await store.cleanupExpired() });
    if (input.action === 'complete') {
      // A test of composition only: no code exchange, user/session creation or real callback.
      const attempt = await store.consume(input);
      const identity = attempt && await verifySchoolGoogleIdToken(input.token || '', {
        clientId: env.TEST_CLIENT_ID, expectedNonce: attempt.nonce,
      });
      return Response.json({ verified: !!identity });
    }
    return new Response(null, { status: 404 });
  },
};
