import { describe, expect, it } from 'vitest';
import { validAuthorCard } from '../src/community/student-client';

const a = '11111111-1111-4111-8111-111111111111';
const p = '22222222-2222-4222-8222-222222222222';
describe('the author card DTO (#312)', () => {
  it('accepts public counts and up to four newest titles', () => {
    const value = {
      articles: 3,
      projects: 1,
      recent: [
        { kind: 'article', id: a, title: 'A' },
        { kind: 'project', id: p, title: 'P' },
      ],
      links: [{ service: 'github', url: 'https://github.com/kobe' }],
    };
    expect(validAuthorCard(value)).toBe(true);
    expect(validAuthorCard({ articles: 0, projects: 0, recent: [], links: [] })).toBe(true);
  });
  it('rejects extra fields, popularity totals, impossible ids and lists beyond the counts', () => {
    const row = { kind: 'article', id: a, title: 'A' };
    const links: unknown[] = [];
    for (const bad of [
      // #313: links are required and only in the accepted shapes.
      { articles: 0, projects: 0, recent: [] },
      { articles: 0, projects: 0, recent: [], links: [{ service: 'x', url: 'javascript:x' }] },
      {
        articles: 0,
        projects: 0,
        recent: [],
        links: [{ service: 'instagram', url: 'https://instagram.com/a' }],
      },
      { articles: 1, projects: 0, recent: [row], likes: 3, links },
      { articles: 1, projects: 0, recent: [{ ...row, views: 1 }], links },
      { articles: 1, projects: 0, recent: [{ ...row, id: 'pub-x' }], links },
      { articles: 1, projects: 0, recent: [{ ...row, kind: 'student' }], links },
      { articles: 1, projects: 0, recent: [{ ...row, title: '  ' }], links },
      { articles: 1, projects: 0, recent: [{ ...row, title: 'x'.repeat(201) }], links },
      { articles: 2, projects: 0, recent: [row, row], links },
      { articles: 0, projects: 0, recent: [row], links },
      { articles: -1, projects: 0, recent: [], links },
      { articles: 1.5, projects: 0, recent: [], links },
      { articles: 9, projects: 0, recent: Array.from({ length: 5 }, () => row), links },
      { articles: 1, projects: 0 },
    ])
      expect(validAuthorCard(bad)).toBe(false);
  });
});
