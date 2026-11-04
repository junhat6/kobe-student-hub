# Server-only Google exchange

`GoogleLoginBroker` joins the browser-bound one-time claim, Google ID-token verifier and private session store. It is not imported by a production route. No live OAuth client, secret or encryption key is configured by this change.

Start and callback require complete canonical HTTPS/client/key/secret configuration before creating or consuming an attempt. A successful callback claim is consumed before the outbound exchange, so a provider failure cannot replay it. The broker sends a form only to `https://oauth2.googleapis.com/token` with the exact server callback URL and stored PKCE verifier. It does not request refresh-token/offline access, provision accounts or expose provider payloads.

Workerd supports manual redirect handling rather than `redirect: 'error'`; the broker uses manual handling and rejects non-success or redirected responses. Token headers and body acquisition race an explicit five-second deadline, aborting the upstream operation. Late results cannot verify identity or create a session; cancellation is handled without waiting for a stalled cancellation promise. The streamed body limit is 32 KiB. Google signing-key retrieval has its existing independent five-second timeout; the exchange budget is not a guarantee for the entire callback's wall-clock duration. The returned ID token is verified by the existing RS256 Google JWKS verifier, including exact audience, issuer, nonce and school-domain claims. Only then may an existing active account receive a session. Account admission and current enrollment are separate requirements.

Matched failure returns a generic private result and attempt-cookie removal. Provider bodies, error details, code, verifier, secret, identity and tokens are not included in failure results or application logs. Success returns private cookie/CSRF/actor data to trusted server code only. Future controllers must set both cookies independently, use no-store responses and a clean safe redirect, and never serialize this broker result as a public JSON endpoint. The JSON test harness is deliberately private and never deployable.

Tests use ephemeral RSA keys and fixed-endpoint outbound stubs in local Workers/D1. They are not live Google, browser-cookie, account-admission, platform-log or student-value verification. Remote migration 0004, dedicated Google configuration and [actual logging gate](LOGGING-GATE.md) remain outstanding before enabling login. Posting additionally requires stored-owner checks, draft/media privacy and moderation/operational policy.


初回の資格確認待ち申請は、通常ログインとは別のローカルserver-only経路で検証します。[PENDING-REGISTRATION.md](PENDING-REGISTRATION.md)を参照。pendingの受付は在籍認定・active化・session発行ではなく、実登録・実ログインの提供でもありません。
