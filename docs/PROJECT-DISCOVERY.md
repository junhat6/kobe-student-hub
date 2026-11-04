# Local recent-project discovery

Issue71 supplies an entry for a reader who knows neither a project URL nor its author. The existing standalone project reader and project-only author page remain the destination. The PRD's activity-discovery purpose motivates the choice; usefulness to real students is an unvalidated hypothesis. Source PRD is unchanged.

## Read contract

The isolated local /lab/works page reads exact GET /__lab/project-discovery anonymously. At most20 published snapshots appear in publication-time descending order, with ID as a deterministic tie-breaker. The limit bounds returned candidates and metadata, not a constant-cost indexed database scan, full history or complete search. No popularity, article reading time, combined ranking or recommendation is implied.

Cards contain only public project ID/title/descriptionPreview/publication date and short public author ID/name/department/year/initials. The preview is at most300 Unicode code points. Full description, biography, external URLs, private owner/draft/provider identifiers, source versions, reports and stop records do not enter this DTO. The full existing snapshot decoder checks the selected published data before this smaller projection is returned. Links open the existing project and project-only author pages; external pages are not fetched or embedded by this feed.

A first query selects at most20 current published IDs; a bounded second read must recover every selected valid public snapshot and author in the same order. Missing/orphan/malformed/oversized/visibility-changed selected records fail the read rather than silently disappearing into an empty success. Only a successful zero-candidate selection means no projects. The total response is limited to256KiB. This does not turn the pair into an atomic snapshot or retroactively erase previously received content. A later fresh lookup honors current visibility.

The client uses the existing credential-free bounded anonymous transport, checks exact keys and limits, rejects duplicate IDs and preserves server order. Loading/failure clears previous cards. A deliberate retry or refresh requests fresh data. The local route has no login/session bootstrap; invalid route variants must not fall through into the fictional author setup.

## Journey and limits

The author can open works discovery in a separate tab after confirmed publication; private later saves or unsaved input do not change the public snapshot. Articles and works have explicit navigation between their local discovery pages. The reader can choose a work, then its author and that person's other public works. Existing author-list external URL text remains its own contract; the new feed intentionally needs no external links.

Fresh owner-stop visibility excludes that project from new feed reads without changing its original snapshot, private edits, reports or another author's project. Project-report intake does not itself hide a work; its automatic thresholds/operating policy remain unresolved. The feed does not introduce a new moderation decision, restoration, republication or deletion operation.

This is fictional localhost HTTPS integration, not a real service launch. Actual Google/admission/graduation, public/private log and cache protection, real operators/notification/decisions/explanation/appeal/contact/retention, media and remote migrations remain separate gates in FIRST-RELEASE.md. PC/mobile emulation is not physical-device evidence; AI operation checks are not student value. A voluntary student check should ask whether unfamiliar work was found and what activity or next action the reader understood, including confusion or no useful result.

No new schema, remote data/configuration, credential, permission, paid contract or actual deployment belongs to this cycle. Images stay opt-in temporary local evidence. Existing production sample routes and assets remain separate.
