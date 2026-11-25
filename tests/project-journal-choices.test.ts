import { it, expect } from 'vitest';
import { journalChoices } from '../src/editor/ProjectJournalLinks';

// #273 verifier N1: the panel must not call a still-public journal article "stopped" just because
// it is older than the newest-20 own publication list.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
it('keeps older public journal articles as candidates and only server-stopped ones as stopped', () => {
  // The own list holds the newest 20 (ids 1–20); the journal links id 30 (older, public),
  // id 31 (stopped) and id 5 (in the list, public). id 1 is fixed at publish time.
  const ownArticles = Array.from({ length: 20 }, (_, n) => ({ id: id(n + 1), title: '記事' + n }));
  const journal = {
    projectId: id(99),
    fixedArticleIds: [id(1)],
    articleIds: [id(30), id(31), id(5)],
    articles: [
      { id: id(30), title: '古い日誌', isPublic: true },
      { id: id(31), title: '止めた日誌', isPublic: false },
      { id: id(5), title: '記事4', isPublic: true },
    ],
  };
  const { candidates, stopped } = journalChoices(journal, ownArticles);
  expect(stopped.map((x) => x.id)).toEqual([id(31)]);
  const ids = candidates.map((x) => x.id);
  expect(ids).toContain(id(30));
  expect(ids).toContain(id(5));
  expect(ids).not.toContain(id(1));
  expect(ids).not.toContain(id(31));
  expect(new Set(ids).size).toBe(ids.length);
  expect(candidates.find((x) => x.id === id(30))).toEqual({ id: id(30), title: '古い日誌' });
  // An article stopped after the own list was read appears only once, as stopped.
  const stale = journalChoices(
    {
      ...journal,
      articles: journal.articles.map((x) => (x.id === id(5) ? { ...x, isPublic: false } : x)),
    },
    ownArticles,
  );
  expect(stale.candidates.map((x) => x.id)).not.toContain(id(5));
  expect(stale.stopped.map((x) => x.id).sort()).toEqual([id(31), id(5)].sort());
  expect(journalChoices(null, ownArticles)).toEqual({ candidates: [], stopped: [] });
});
