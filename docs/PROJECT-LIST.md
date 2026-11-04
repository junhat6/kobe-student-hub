# Confirmed private-project list metadata

Issue73 repairs an observed local authoring mismatch: after a successful private save updated the selected snapshot to version2, the list still showed its earlier title and version1. The author's later unsavedversion3 stayed in the form. Independent PC/mobile baseline execution reproduced the mismatch before implementation. This is a display consistency fix; no data loss, student harm or validated student usefulness is inferred.

## Confirmation and list contract

Only successful, validated private create/save acknowledgements and owned draft GETs contribute id/title/version/updatedAt metadata. Those results already pass the existing transport/session proof and current component generation. Description/URLs and public publication receipt fields do not enter the reconciliation helper. A public sourceVersion is not a private draft version.

Within the current fetched list page, an incoming higher version updates or adds its metadata; equal/older versions retain the existing known record. Confirmed metadata is ordered by server updatedAt descending, then ASCII ID, and bounded to20. A one-record confirmation does not replace the other known records or establish the server's globally newest20. New confirmed creations can appear without an automatic list request.

An explicit list refresh still replaces this bounded page with the server's fetched result. The page then incorporates later confirmed save/read metadata. This is a point-in-time view, not a promise of immediate cross-tab consistency, complete history, causal database replication or offline recovery. A previously failed list refresh remains labeled failed after a one-record acknowledgement. A failed/unknown save never inserts the optimistic form title/version.

Inspecting a saved draft updates only the confirmed metadata and the existing comparison candidate. It does not replace input or resolve an uncertain save by itself. The existing explicit open/rebase decision remains necessary. Saving a captured snapshot leaves later typing dirty and separate. No retry, new network request, public edit, deletion, restoration or extra data mutation is introduced.

The existing author session boundary remains responsible for private state. Its pre-request/post-header/EOF proof and generation checks prevent an old account response from entering another account's list. This fix cannot guarantee memory erasure, instantaneous identity detection without an event/request, or actual Google/login/log/cache readiness.

## Evidence and remaining work

Verification covers confirmed title/version updates while later typing remains, uncertain committed-save responses followed by manual inspection, older/equal metadata, bounded ordering, and actual delayed response/account change and immutable publicv1/privatev2 separation. Baseline and final evidence are distinct; temporary opt-in images remain local. PC/mobile browser emulation is not physical-device or student-value evidence.

Actual school authentication/admission/graduation, private data/log/cache/media protection, real operators/notification/judgment/explanation/appeal/contact/retention and remote migrations remain the FIRST-RELEASE.md gates. The current public sample preview is unchanged. No schema, remote data/configuration, credential, new permission/paid contract, actual deployment or image publication belongs to this cycle.
