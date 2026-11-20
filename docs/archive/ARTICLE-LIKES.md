# Article likes — fictional local journey

Issue #59 selects one bounded reader action over independent project registration and published editing. Existing article/session/profile/hiding boundaries support a smaller coherent journey; project reporting and published-revision decisions need separate work. This is not a fixed product priority or evidence of student demand. Source PRD is unchanged.

## Intended local behavior

An existing fictional session can check its own article-like state, deliberately associate its chosen public profile with an article, withdraw that association and open a public liked-article list. No reader/list visit creates an identity. An unprepared profile is not populated from Google fields. A profile's public-field confirmation does not consent to future activity disclosure: the like action itself explains and explicitly requests the public association.

The public list contains a short chosen public profile and at most20 currently eligible article summaries. The local display proposal is newest like first with a deterministic tie; the time of liking is not a public field. There is no aggregate popularity count, list of people who liked an article, recommendation, history collection or project-like implementation. The original public-author endpoint keeps its existing eligibility semantics.

A valid registered public profile can have a genuinely empty liked list. Missing/invalid mapping or unavailable storage must not become false empty success. Short profile fields are already explicitly chosen for public display, but that alone does not authorize adding an article to this list. Public responses exclude private account/provider IDs, email, article body, draft/report data and like timestamps.

## Ownership and changing state

Private state and mutation use the current server session; mutation also needs CSRF and final SQL proof of the live account/session/epoch/time. Adding requires an existing confirmed public profile and a currently published record-backed non-sample article. Duplicate add does not create another association or change its original ordering time. Withdrawal deletes only the caller's association and remains possible when the target is hidden, deleted or absent; an ignored/failed delete must not be acknowledged as false state.

Unknown mutation results are not retried automatically. The reader must explicitly check the same account's current state before another action. Unknown reads are not proof of absence. Session binding checks before/after response and at body completion prevent a late private response from being consumed under another session. Focus/visibility observation is bounded, not instant coordination across all tabs. Cancelling a request cannot undo a committed mutation.

Fresh public reads exclude hidden/deleted/private/sample content and fail closed for invalid selected records or mid-read visibility changes. This does not erase text already received by a reader or establish actual CDN/cache behavior. Public transport uses no credentials or identity bootstrap, bounded JSON and generic unavailable responses.

## Scope and release boundaries

Migration0008 is local/test preparation only. Production worker/index.ts and its routes/assets remain unchanged; the deployed preview still provides fictional sample reading only. Local fixture active/suspended/deleted behavior is a technical scope, not a decision about enrollment, graduation or the future visibility of existing likes. Those details and consent/operating/privacy requirements must be resolved before genuine use.

No remote migration, real Google login/like/posting, new credential/grant, mail/R2/contract, ranking or screenshot publication is part of this unit. The full actual logging/privacy gate remains unfinished. Physical devices, Safari/IME and real student usefulness require separate evidence.

## Value to investigate

Hypothesis: making a deliberate public reaction and later finding its article in a public list may help rediscovery and understanding student activities. Public expression can also be unwanted or ambiguous; willingness to disclose an interest and reasons not to use it belong in a future voluntary trial. Likes/clicks and AI behavior tests do not demonstrate learning or demand. Use the existing trial boundaries and collect no raw student feedback in public GitHub.
