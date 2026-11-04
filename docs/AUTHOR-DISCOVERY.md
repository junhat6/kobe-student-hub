# Article to author to published articles — local journey

Cycle25/#51 connects the PRD's core article→author→their other articles journey to actual fictional local publication records. Compared with further editing aids and prepublication-preview changes, this directly lets a reader discover more of the author's shared experience. Owner editing/removal and operating restoration remain outside this unit because their policy/operations need separate decisions. The PRD source is unchanged and is not republished. Student usefulness remains a hypothesis,not an AI-test conclusion.

## Observable contract

From a local published article, the reader can open its public author page and select another published article. A direct author URL works anonymously; a validated optional source-article UUID provides a safe explicit return link. Ordinary anchors retain native modified-click/new-tab/history behavior. No private browser storage or automatic identity creation is added. Native back behavior is verified only to the extent recorded in QA; no new atomic navigation or retroactive data erasure guarantee is made.

The public author view contains the explicit public profile and up to20 currently eligible articles, ordered by actual publication time descending and ID ascending only for equal instants. Dates shown on cards retain the existing public day precision. The limit is explicit; this is not an unbounded catalog,full pagination/search/recommendation,project publishing,likes or profile editing.

Only non-sample publication-backed article records passing the existing public projection are eligible. Hidden/deleted/unlinked articles,private drafts and another author's articles are excluded. This journey does not expose an orphan profile with no eligible published article. Authentication account fields (school email/Google identifiers),report state,owner mappings and draft linkage are not serialized. User-entered public profile/article text stays explicit public content; this is not a semantic personal-information scrubber. Summary cards omit body and related IDs.

The store first checks at most20 candidate IDs and SQL bounds, then rereads bounded eligible rows and applies the existing full DTO validation before stripping to summaries. An invalid selected record,storage failure or candidate-count mismatch is unavailable,not a false empty list. Both queries retain current-public-state checks; a later hide cannot erase a response already delivered. Internal body work is bounded to20 valid-size rows; the public JSON is capped at256KiB. The cap accounts for JSON escaping of otherwise valid text.

Anonymous local GET /__lab/authors/:publicID uses exact slug/path,GET-only/no query or fragment,no-store/no-referrer/noindex/nosniff and generic errors. The browser uses credentials:omit,no automatic retries and bounded strict JSON. Retry/unavailable clears stale visible results. Page links/profile fields render as safe text. No extra login/profile probing or private request is needed to read.

## Release and evidence boundary

This is fictional local Workers/D1 publication→reader discovery,not real school login or general user posting. Production worker entry,main frontend assets and sample-only catalog stay unchanged. No new schema/remote0004–0007,credentials/grants,operator provision,mail/R2/contracts,deployment or screenshot publication. Existing held originals are not retried.

Real admission/graduation,OAuth/controller/log/cache/media safety,actual operators/notification delivery/explanation/appeal/contact,restore/re-report/retention decisions and genuine student/physical-device trials still gate activation in #38. New-read hidden exclusion and local viewport operations do not prove instantaneous revocation of already received content,CDN behavior,Safari or student value.
