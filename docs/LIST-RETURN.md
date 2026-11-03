# Return to the discovery list

## Observed problem and hypothesis

An existing `search?tag=学び方` result contained one sample. Opening its article and choosing `← 一覧へ` led to the unfiltered home with four entries. Browser Back preserved the original list. This loss of conditions is reproduced behavior; whether students become confused and whether this change improves their experience remain unvalidated hypotheses.

## Bounded behavior

Article/project card URLs carry a `from` target built from a known public list path and its existing filters. Search/home preserve q, tag and kind; study preserves variant; a public student profile's list path can also be used. The article's return link uses that target. A bare direct link defaults to home. Copying/opening the card URL in another tab carries the list conditions, without inventing an original scroll position for that new tab.

Return targets are reconstructed through an allowlist. External/protocol-relative URLs, backslashes, fragments, API/detail routes and oversized values are rejected; unknown parameters (including nested return targets) are dropped. Only public list navigation is supported. This is not authentication/authorization or a generic redirect feature.

Same-tab ordinary activation captures the actual list position and entry ID in navigation state. Explicit return restores that position and focuses the originating card without focus-induced scrolling. A bounded 50-entry in-memory map restores recent Back/Forward positions/focus in the running app. It also preserves same-path query-control behavior rather than stealing input focus whenever a filter changes. No analytics, server writes, localStorage, cookie or user-history service was added. Browser history continues to contain visited URLs and the small navigation state; it is not a private browsing guarantee.

A related article inherits an existing list snapshot, if one exists. A directly opened/new-tab article can carry a valid `from` URL but no snapshot: related navigation must not invent a list position from its article's scroll offset. In that case the return list opens at its top/main focus. New tabs do not transfer another tab's exact scroll/focus. The memory map is lost on reload; explicit-return state can survive the browser's same-tab history state. Exact restoration across browser restarts, evicted pages, dynamic content changes or physical Safari is not guaranteed.

This scope does not carry a search context through every author-profile navigation or restore arbitrary article-body anchors while late content is loading. Those are separate decisions rather than silently expanding this patch.

## Verification

Pure tests cover allowed filters/routes, invalid targets and bounded matching snapshots. Browser regression covers search words/tag/kind, explicit return, Back/Forward, focus/position, direct/new-tab/reload, project/study lists and related navigation with/without a real snapshot. Independent QA records its exact source and screenshots separately. Student usefulness and physical-device behavior remain untested.
