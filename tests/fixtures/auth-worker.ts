// Test-only entry point; never referenced by wrangler.jsonc or the production Worker.
import { verifySchoolGoogleIdToken } from '../../worker/auth/google-identity';
export default {
  async fetch(request: Request, env: { TEST_CLIENT_ID: string; TEST_EXPECTED_NONCE: string }) {
    const identity = await verifySchoolGoogleIdToken(await request.text(), {
      clientId: env.TEST_CLIENT_ID,
      expectedNonce: env.TEST_EXPECTED_NONCE,
    });
    return Response.json({ verified: identity !== null }, { status: identity ? 200 : 401 });
  },
};
