import type { ProjectDraftSummary } from '../project-types';
/** Known confirmations only, not a replacement for a fresh server list. */
export function mergeConfirmedProject(
  list: readonly ProjectDraftSummary[],
  incoming: ProjectDraftSummary,
): ProjectDraftSummary[] {
  const previous = list.find((row) => row.id === incoming.id);
  const rows =
    previous && previous.version >= incoming.version
      ? list
      : [...list.filter((row) => row.id !== incoming.id), incoming];
  return rows
    .map(({ id, title, version, updatedAt, publicationId }) => ({
      id,
      title,
      version,
      updatedAt,
      // A confirmed read carries no page id; keep the one the server list gave (#289).
      publicationId: publicationId ?? list.find((row) => row.id === id)?.publicationId ?? null,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 20);
}
