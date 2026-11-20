# Images and R2 — next-stage boundaries

Images are a PRD requirement, but current UI has no real uploads or user accounts. R2 use is acceptable in principle; activation/contract details and secure upload/retrieval remain separate work. No bucket, R2 credential, new payment method or subscription was created by this preparation.

## Service and cost boundary

Cloudflare Workers Paid is a separate service plan with a $5/month minimum plus usage; it is not an all-inclusive R2 subscription or a guaranteed total cap. Prefer existing/free allowances for the current sample preview. R2 Standard's published free allowance is 10 GB-month storage, 1 million Class A and 10 million Class B operations per month. Beyond it, published rates are $0.015/GB-month, $4.50/million Class A and $0.36/million Class B operations; applicable taxes/fees and billing rounding may apply. Egress is listed as free. Other storage classes/features have different charges. These figures must be rechecked before activation and do not establish a particular account's bill.

R2 activation is an auto-renewing subscription/usage agreement even when the initial/basic amount is zero. Do not accept its legal terms or charge a saved payment method without the applicable concrete confirmation. Clarify whether a stated budget is a target or a total ceiling; a free allowance is not proof of a hard spending cap. No paid Workers upgrade is implied by permission to investigate/use R2.

## Security and ownership before real upload

- Start with a private bucket via a Worker binding, not a public r2.dev URL. An unguessable object key is not authorization.
- Store ownership and publication linkage in D1. For every retrieval, enforce current publication/owner/admin policy server-side; draft, hidden and deleted media must not become publicly available through stable cached URLs.
- Upload requires the real authenticated owner, CSRF and rate/quota controls. Validate decoded image format/dimensions/size, optimize server-side or via an appropriate verified service, and reject unsupported/active formats. Exact limits and transformation choice are not decided here.
- Separate temporary upload, attachment, publication and deletion states. Plan orphans, failures, edits, retention and user deletion before accepting real files.
- Test another user's draft retrieval, hidden-content retrieval and cache transitions. Do not enable uploads before identity, private-data and moderation gates are met.
- Prefer bindings over new S3 credentials. Any new persistent key/grant requires its applicable confirmation and must not be committed or logged.

## Next small task

Once activation terms/payment conditions are resolved, define one bounded private-image lifecycle, local R2 tests and ownership checks. Do not add video uploads, public buckets, image AI or a second paid service merely to prepare this step. Keep student value testing separate from storage-operation tests.

Primary pricing references: [R2](https://developers.cloudflare.com/r2/pricing/), [Workers](https://developers.cloudflare.com/workers/platform/pricing/). Subscription terms: [Cloudflare agreement](https://www.cloudflare.com/terms/). Checked 2026-11-03; no legal acceptance was performed.
