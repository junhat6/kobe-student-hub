# Newly published article to recent discovery — local journey

Cycle26/#53 connects local publication records to a cross-author reader entry. Article/author circulation already existed,but a reader needed a known article URL. Compared with more editor aids or unresolved operating actions,this is a core publication→discovery→article→author step. The usefulness hypothesis remains untested with students. Source PRD is unchanged.

## Small selected experience

/lab/discover presents up to20 newest eligible article snapshots,ordered by actual publication time descending and ID ascending only for equal instants. It is a bounded recent view,not a complete catalog,search/tag filter,recommendation,popularity feed or pagination. Cards retain reader context and the public author's name/department/year/initials,with ordinary article and author links.

Local article/author pages provide a recent-feed entry. A confirmed publication receipt opens that public list in a new tab so existing private editor text remains in its current page. Links do not create an identity,fetch private data or send an automatic publication command. Native back/direct/new-tab behavior is exercised only to the extent recorded by QA; no custom history controller or universal scroll/focus restoration is promised.

## Public projection and empty versus unavailable

The recent feed shares the bounded publication-candidate/full-DTO validation with the author view. Only currently published,non-sample,publication-backed records passing the existing full public projection can appear. Each card's summary and author are derived from the same validated row. Body,bio,related IDs,owner/draft linkage,authentication fields and moderation state are omitted. Explicit public user-entered text is not a semantic personal-information scrubber.

At most20 candidates are examined before bounded full-row loading. A malformed selected record,storage error or visibility/count mismatch between the two queries is unavailable. An actual absence of eligible records returns cards:[] successfully. This distinction must survive the browser client: failure must not look like an empty community. The existing author endpoint still rejects an orphan/no-publication view rather than returning an empty author result.

GET /__lab/discovery is anonymous,exact-path/no query or fragment,GET-only and capped at256KiB,including JSON escaping. It has no-store,no-referrer,noindex/nosniff JSON responses,no cookies or redirects. Browser reads omit credentials and use strict bounded decoding without automatic retries. Empty and failure screens clear old results; explicit retry remains available on failure. An invalid route never falls into legacy fixture identity creation.

The two queries recheck visibility before response construction; later hiding cannot erase already received content. The20-row/body and response bounds are distinct from a measured scale/query-plan/throughput guarantee. No indexing/schema change is hidden in a frontend deployment.

## Evidence and activation boundary

Use actual fictional local publication→new recent visibility and distinct-account reporting→fresh exclusion,plus existing author/private/public regressions. Backend tests establish a genuine empty dataset; a synthetic browser-empty response establishes only presentation behavior and must be labeled as such. Existing editor state contains other test publications,so checks target fresh IDs rather than assuming a global total of2.

Production Worker entry,main frontend/assets and public sample catalog remain unchanged. No schema,remote0004–0007,credentials/grants,operators/recipient configuration,mail/R2/contracts,deployment or screenshot publication. Earlier held originals remain held.

Actual school OAuth/admission/graduation/controller/log/cache/media,operating notifications/decisions/appeal/contact/restore/retention,and genuine student/physical-device trials remain release gates in #38. AI local operation evidence is not real authentication,student demand or value validation.
