# Reading to trying code — H03

## Chosen minimum and alternatives

PRD experience E23 (try something on one's own PC after reading) was adopted by the originator. That is one person's input, not student validation. The current Git article already contains a practice snippet; taking that displayed code into a local practice environment is a concrete next action available in the current preview.

| Candidate | Next useful step / constraint | This cycle |
| --- | --- | --- |
| Real sign-in and publishing | Requires authorized remote auth migration/configuration, sessions/private data, enrollment and moderation/operator gates | Keep closed; do not retry the denied migration |
| Markdown authoring with assist and edit/preview | Needs a coherent private save/recovery and publication flow; a disposable editor would add another preparation surface | Defer; renderer remains reusable, no editor prototype added |
| Images and video | Images require private ownership/lifecycle and R2 activation terms; YouTube/media behavior and privacy need an explicit implementation choice | Defer; do not enable uploads, image fetching or iframe embeds |
| More card-comparison features | The existing A/B prototype already supports a student trial; more UI cannot replace students' feedback | Keep as is; #5 remains unvalidated |
| Copy the article's displayed code | Can help a reader try the current example without transcribing it; no account or backend write needed | Implement one explicit copy action with manual selection fallback |

H03: extracting the displayed code may reduce transcription friction before trying an example. It is not proof of learning, safe execution, student demand or successful practice. No code is executed by this application. Existing article context remains the guide to where the example applies.

## Behavior and boundaries

Fenced/indented block code receives a small toolbar. Inline code stays inline. The explicit copy action reads only the rendered pre element's textContent, preserving that DOM text's indentation and line endings; syntax-highlighting markup and toolbar text are excluded. A pending request disables repeated copy activation, and success appears only after writeText resolves. Rejection/absence shows a generic failure without internal exception details and offers a manual select action that focuses the code and selects its full DOM range.

The app never reads the clipboard or invokes execCommand, executes code, saves a draft, collects events or posts content. The browser/OS controls write availability and permission behavior. A user-initiated write may invoke browser permission UI; no programmatic pre-grant is configured. See the [W3C Clipboard API working draft](https://www.w3.org/TR/clipboard-apis/#dom-clipboard-writetext). No site permission-policy/header relaxation is required in this patch.

Manual selection follows the browser's text-selection/copy behavior. Full DOM selection does not guarantee that a native copy preserves a final newline on every platform. On the tested Chromium, Selection.toString omitted the final LF while its selected Range.toString contained the complete DOM text. We verify the selected range exactly, and do not present that as an actual OS clipboard-content test. Automatic writeText receives the complete DOM string.

Raw HTML remains disabled, links retain their allowed schemes, and images/iframes are not added. Copying a snippet does not certify its correctness or applicability. Future real publishing and media require their existing gates.

## Evidence and next learning

Browser tests stub only the clipboard API boundary to resolve, reject, be unavailable or remain pending; they do not read or overwrite the user's OS clipboard. They verify exact per-block text/whitespace, literal script text not executed, multiple blocks, inline code, pending/success, generic failure and manual focus/full-range selection on desktop/mobile Chromium. Independent QA records its own execution and images.

Next student trial should include whether a reader wants to try the example, how they transfer it, what they change and whether the article helps them understand the result. Copy clicks alone are not learning or value. Do not add analytics for this hypothesis. Real desktop/native clipboard and physical mobile/Safari should be checked with an agreed disposable clipboard before claiming platform reliability. Cross-device transfer and a full authoring experience are outside this patch.
