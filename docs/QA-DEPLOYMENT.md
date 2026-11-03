# Independent QA — deployed sample preview

Date: 2026-11-03. Reviewer: independent QA agent, separate context from the deployer.

Target verified directly: [public sample preview](https://kobe-student-hub-preview.ideaboost-whiteboard.workers.dev/).

The deployer identified this as verified main `6e82dfbd70669c3bc869fd5cc35e8cfe5c5b80fd`, with runtime-version details retained privately, with sample migrations 0001/0002 only. This reviewer verified the public HTTP/UI behavior below, not the Cloudflare deployment metadata or private database migration table. The unmerged Cycle 04 attempt-store migration is not inferred to be deployed.

## Independent HTTP checks

Sent ordinary unauthenticated GET requests and **empty** POST denial probes to the exact public origin. Used no real account, token, authorization code, state, nonce, credential or secret-bearing query. The only query used was the non-sensitive study selector `variant=b`.

| Request | Direct result |
| --- | --- |
| GET `/api/health` | HTTP 200; `status:ok`, `stage:development-preview`, `writesEnabled:false` |
| GET `/api/catalog` | HTTP 200; mode `sample`, four entries, two profiles whose display names identify them as samples |
| GET `/`, `/articles/git-branches`, `/study/cards?variant=b` | HTTP 200; SPA HTML/root delivered on each path; static security headers present |
| Empty POST `/api/content` | HTTP 405; no `Set-Cookie` |
| Empty POST `/api/auth/callback` | HTTP 405; no `Set-Cookie` |

Catalog response had `Cache-Control:no-store` and no session cookie. The response text contained none of the checked private markers: email/Google-subject fields, OAuth attempt table/hash/nonce fields, access/refresh tokens, client secrets or the local private-fixture marker strings. This is a check of this sample response, not an exhaustive proof about every future public DTO or a remote private-data insertion test.

The following headers were independently read and asserted on all three static paths:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
X-Robots-Tag: noindex, nofollow
```

The independent assertion script completed successfully. No redirect to login or session issuance occurred. No remote setting or record was changed by this reviewer.

## Independent deployed-browser walkthrough

Opened the actual HTTPS origin in a dedicated macOS Chrome tab and inspected a screenshot **before interaction**. The home rendered its sample-only/development notice, article feed, search and navigation; no real sign-in/posting action was offered.

Then directly operated:

1. Home article list → `learning-notes`: title, sample disclaimer, reader context and Markdown body rendered; inspected another screenshot.
2. Article author → `sample-a`: sample profile and that author's two articles appeared.
3. Browser Back → article → related `tiny-notes`: project page rendered, with its related-article section and fictional-project explanation.
4. Opened deployed `/about` → its comparison link: default card A showed the three fictional articles without the extra reader-context groups.
5. Switched to card B: URL became `/study/cards?variant=b`, selected-button state changed, same three titles/order remained, and each card exposed prerequisite/outcome information. Inspected a screenshot showing the visible B fields.

No blocking navigation or rendering failure was found in this narrow deployed desktop walkthrough. Screenshots/accessibility output were inspected in the tool session; this reviewer did not export standalone screenshot files for this deployment check. Existing local-study images are not re-labelled as deployed evidence.

## Limits and release boundary

No mobile viewport, physical iPhone, Safari or full deployed E2E suite was executed in this deployment pass. Earlier local mobile tests remain separate evidence. This preview contains fictional examples only; student usefulness, preference for card B and real participant validation remain untested.

No real Google OAuth, token verification request, callback code/state exchange, browser-bound attempt, session, current-enrollment check, real-user posting, media privacy or moderation flow was enabled or tested. Empty callback denial is not live authentication acceptance testing.

No secret-bearing canary query/body/header audit was performed. No platform/access logs, traces, retention controls or actual log destinations were inspected or changed. Correct public security headers and absence of app logging do **not** establish OAuth log secrecy. The operational logging gate remains unsatisfied.

## Disposition

The public URL is reachable and the sample-only discovery/study preview passes the independent HTTP and desktop checks above. No blocking finding was identified for this limited preview. This is not authorization or evidence of readiness to collect real student accounts/content. Only this QA document was edited by this reviewer; no remote resource, configuration, logging or authentication action was performed.
