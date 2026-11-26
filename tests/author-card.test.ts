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
    };
    expect(validAuthorCard(value)).toBe(true);
    expect(validAuthorCard({ articles: 0, projects: 0, recent: [] })).toBe(true);
  });
  it('rejects extra fields, popularity totals, impossible ids and lists beyond the counts', () => {
    const row = { kind: 'article', id: a, title: 'A' };
    for (const bad of [
      { articles: 1, projects: 0, recent: [row], likes: 3 },
      { articles: 1, projects: 0, recent: [{ ...row, views: 1 }] },
      { articles: 1, projects: 0, recent: [{ ...row, id: 'pub-x' }] },
      { articles: 1, projects: 0, recent: [{ ...row, kind: 'student' }] },
      { articles: 1, projects: 0, recent: [{ ...row, title: '  ' }] },
      { articles: 1, projects: 0, recent: [{ ...row, title: 'x'.repeat(201) }] },
      { articles: 2, projects: 0, recent: [row, row] },
      { articles: 0, projects: 0, recent: [row] },
      { articles: -1, projects: 0, recent: [] },
      { articles: 1.5, projects: 0, recent: [] },
      { articles: 9, projects: 0, recent: Array.from({ length: 5 }, () => row) },
      { articles: 1, projects: 0 },
    ])
      expect(validAuthorCard(bad)).toBe(false);
  });
});
