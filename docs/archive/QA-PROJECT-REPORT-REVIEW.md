# Independent QA — project report intake/read-only review (Cycle32 / #63)

## Result and scope

No outstanding blocker found in this fictional local intake experiment. Reviewed PROJECT-REPORT-REVIEW.md and final implementation: reporting a work does not apply the article three-report rule, change visibility, enqueue mail, perform a decision or provide restoration/deletion. Real work moderation/operating rules remain unresolved and production activation is not justified by this prototype.

Separate report storage/routes/DTOs target immutable project snapshots. Existing active fixture/session is a technical check, not actual enrollment/admission. A receipt means this session's account has an accepted report; it does not prove the currently typed reason matches stored text or that anyone acted/notified. Original duplicate reason/detail is retained.

## Independent execution and lineage

- `node scripts/build-test-fixtures.mjs && npx vitest run tests/project-reports.test.ts tests/projects.test.ts tests/project-report-client.test.ts tests/public-author-client.test.ts tests/public-discovery-client.test.ts tests/public-likes-client.test.ts`: **39 passed,6files,6.54s** (report9 +projects10 +report/review clients6 +affected anonymous clients14), actual isolated Workers/D1.
- Explicit `npm run editor:build`, then `KOBE_LOCAL_EVIDENCE_DIR=/tmp/kobe-project-report-independent-images npx playwright test --config playwright.editor.config.ts tests/editor-project-reports.spec.ts tests/editor-project-reports-independent.spec.ts --workers=1 --output=/tmp/kobe-project-report-independent-test-output --reporter=list`: **12 passed,19.8s**, developer8 +independent4. Final lab assets `index-BlYKsuA3.js`, `index-BFqVx9h8.css`.
- Independent final `npx tsc --noEmit` passed. Scripts/editor8788 released after execution; no unrelated full-suite repeat.

Parent's full114 editor checkpoint used the prepared independent test with an injected401. After that run finished, only this independent case was strengthened: confirmed invalidation now uses real CSRF-protected current-token logout, then actual server401 on focus. The final12 above cover that final test version. Synthetic503 still represents an unavailable proof; it is not described as an actual outage. Product source was unchanged by this test-only strengthening.

Earlier source reviews led the owner to preserve hidden same-session buffers rather than discard every focus check, use a stable guarded-fetch proxy and add a non-key inspection generation so repeated fast proofs reconcile hidden/inert without remounting the child. Final cases verify the same textarea instance survives unknown/same scope and repeated inspection. Defensive queue sentinel distinguishes truly empty from an orphan target; actual schema foreign keys prevent creating that orphan without weakening constraints, so this branch is source-reviewed, not falsely reported as a real corrupt-DB fixture test.

## Verified boundaries

1. Backend actual D1 tests cover one-account/project dedupe without reason overwrite, final session/CSRF/target checks, accepted own receipts for hidden/deleted targets, false only valid published target, corrupted/storage failures, trusted operator allowlist default empty, bounded queue and case, accepted records after structural account removal, rollback and stalled-body deadline/no late write. Public project projection stays private-report-free. The approved pure snapshot decoder export retains existing project validation without requiring public visibility for a trusted hidden/deleted case.
2. Case query reads21, validates selected records, returns20 newest reasons plus explicit reportsTruncated. Oversized/invalid selected records fail the case rather than silently disappearing into a false complete view. Reporter/account/provider/session identifiers are not projected. Queue/case final SQL rechecks live operator authority; browser role fields are not authority.
3. Developer browser cases exercise explicit report preparation only, escaped private reasons, ordinary-user operator denial, stale-case clearing on failure, actual committed POST with injected lost acknowledgment/no automatic retry and manual own receipt. A held A acknowledgment cannot populate B scope or retain A's private reason; B requires explicit proof/continuation.
4. Independent case creates21 actual fresh fictional reporter accounts via existing local fixture and sends21 accepted POSTs to one published work. Fresh public work remains200 and does not contain private reason/detail. Trusted operator UI shows exactly20 entries and the explicit note that more records exist/not all reports are shown. No automatic-hide/restore/decision/mail buttons are present. Raw private API confirms reportsTruncated:true, exact reason/detail/time keys, private no-store/no Set-Cookie and query rejection.
5. Independent session case injects503 proof: same reason stays in the mounted DOM but hidden/inert. Manual same-session proof and two repeated inspections reveal the identical textarea marker without remount/input loss. Real existing-session logout then returns200 and invalidates current token; subsequent actual proof401 removes the private reason subtree. No localStorage/sessionStorage content is added.

## Final local visual evidence

All eight final screenshots were actually opened and visually inspected independently, including both full20-item case captures. Parent separately viewed desktop01/02 and mobile02/03/04. Public work remains displayed after21 reports; partial-case notice, plain reasons, preserved same-session input and cleared invalid scope are readable in desktop/mobile with no visible overlap. Long case length is bounded but not claimed to be a validated human review workflow.

Screenshots require explicit KOBE_LOCAL_EVIDENCE_DIR resolving under/tmp and produce no PNG by default. All evidence remains local temporary files; no image upload/publication or held-image retry. Base `/tmp/kobe-project-report-independent-images/`.

| Local PNG | SHA256 |
| --- | --- |
| `editor-desktop/01-many-reports-no-auto-hide.png` | `c3da66a4c02a591d2a0fa9128334a6a75df77ec26dcca179d9027b5757ced173` |
| `editor-desktop/02-readonly-case-partial-twenty.png` | `8710c05ede26c13e23e5774a084b53e8395f7ea101dc2b90eb07398635f0a3e7` |
| `editor-desktop/03-same-session-reason-retained.png` | `96c435f30f0b877bc3757bc96585b3c4fb860040bdc141f5e04549c0671b747f` |
| `editor-desktop/04-confirmed-invalid-private-reason-cleared.png` | `c44ee999d15d5779164da2c50ca86ff752253f6e181aa19194dd57fe19142327` |
| `editor-mobile/01-many-reports-no-auto-hide.png` | `6102788512fbb639775d15d25d71d2bb212dbecffcea5eef8a9627a765d40668` |
| `editor-mobile/02-readonly-case-partial-twenty.png` | `1fc1ec24744cd6b112513fab02a69773d5c93cfa0c7cee20c1ea4abddc28e3ff` |
| `editor-mobile/03-same-session-reason-retained.png` | `d0a86ef32f3710baccba01f82022fbc8365b7c456b59ca480e68e73278f4534d` |
| `editor-mobile/04-confirmed-invalid-private-reason-cleared.png` | `9936d56f8204cf47051a6e07a4559e6fffe5344e48e075a6d51ae0f6f6641588` |

## Final reviewed fingerprints

Working-tree source/test/integration hashes; no future commit SHA assumed.

| File | SHA256 |
| --- | --- |
| `worker/project-reports.ts` | `296d641d0bc27315cf95149236311847c63e7f8f477a75710ffe5e6d9e237882` |
| `worker/project-reports-http.ts` | `2e5b594b168bea2efb07a5c6747fc7f26e8ce4998300a6be17191a9a557f6e49` |
| `worker/projects.ts` | `74c2fabe06b8127e4f3ccfc778f96108ed14153e6ef6ae8352b08e85775cefb9` |
| `migrations/0010_project_reports.sql` | `355bad3037ad2bdcda14920f98fe21e6960e60d1170ce7f11112d313096a0c8b` |
| `src/project-report-types.ts` | `55e14747c1b8695f91df5d5a5a1f17fcf26ec9b7d4255429273f0dcebc756445` |
| `src/editor/ProjectReport.tsx` | `5ae682109c81a4b395bb00fd7f5b55cc8f95848453da8bf4deef68392db023a4` |
| `src/editor/ProjectModerationLab.tsx` | `8cefc579a282552a82ce193f0638a9e9ed0ab4366d7c277b03bd1e254f4c7637` |
| `src/editor/ProjectSessionScope.tsx` | `dd757fbfc7996902021a147af655dcf16a6eaf2d7fd98a1ee2568a2ae1b4ecba` |
| `src/editor/project-report-client.ts` | `93f0f428917300394ef17982e5f802ef5b72fd90718e8b1ff71efd46702f0067` |
| `src/editor/project-moderation-client.ts` | `8fbb4b79203ff11d607f90cbbc75e8c71d60758a0036039f006428a450b20112` |
| `src/editor/project-report.css` | `b11891a377b04874edaeebe034738c7f692affacfff41b5c06ec3de043dd05a6` |
| `src/editor/PublicProjectLab.tsx` | `1e7c802af3194a9c0bf65f03b4850aa67b97d18198b407d614685530b0806e1e` |
| `tests/project-reports.test.ts` | `5aa048e27dddaa117a0f56cd278120af229eb6c7b785871769a31c529ed0bf5b` |
| `tests/project-report-client.test.ts` | `9317f097369c67cb9547a8116eb33c1096b98919997dc59c430db2326e652fd2` |
| `tests/editor-project-reports.spec.ts` | `93795547320b38a8cbf5c6460360415b4cd64806c8239112075b9b91d9e48b77` |
| `tests/editor-project-reports-independent.spec.ts` | `19c8a75057af459bdd06894d8fa99dc16ba31baa38c60de9bfe025fd3ce23726` |
| `tests/fixtures/project-reports-worker.ts` | `a6a8b2df82c2e7f1ecf990fd4370ef80a30e28f21bbd1eef24001a55937faa06` |
| `tests/fixtures/editor-worker.ts` | `bb0429e8c7a4e408f7e5a4184e7c21d1cbfb4e36a213ebcb2154d648ad1573ca` |
| `tests/editor/entry.tsx` | `19049320b5cc82c6b3fb21349a4b4b4c32654cf2ac55f2cb7a89c10ef129023d` |
| `scripts/build-test-fixtures.mjs` | `b0d9700a41ce351a2e097ffc69485fe806538fd74c6fc475690f1530d8155a5e` |
| `scripts/editor-preview.mjs` | `7ef80840fa8264515fe6a4e2b6f929c39f93f142459ba2923bcd432aa302c62b` |

## Limits and real-use gates

Migration0010 and existing explicit operator/session helpers are local/test only. No production entry/assets/config, remote schema/data, real Google/admission, permanent role/credential/grant, paid contract/R2/mail/deploy or screenshot publication was performed by QA. No actual notification, hiding policy, decision/audit, author explanation/appeal/contact, restoration/re-report or retention rule is implemented or inferred. Account-removal structural behavior is not approved retention policy.

Request cancellation cannot undo committed intake; session proofs are bounded observations, not instantaneous atomic cross-tab guarantees. A true own receipt does not establish reason equality or response outcome. Real log/cache/privacy, physical devices/Safari/IME/assistive technology and student/operating-person usefulness remain unverified. Chromium desktop/iPhone13 emulation and synthetic proof/response faults are distinguished from actual D1/session behavior. Self-signed TLS ignored only in test contexts; CertificateUnknown diagnostics occurred while tests passed with no global OS trust change. No private operational facts appear here. QA changed only its authorized independent spec and this report.
