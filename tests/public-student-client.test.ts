import { describe, expect, it, vi } from 'vitest';
import { createPublicStudentClient } from '../src/community/student-client';
const author = {
  id: 'public-reader',
  name: 'Public name',
  department: '',
  year: '',
  bio: 'Public bio',
  initials: 'P',
};
const entry = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Article',
  summary: 'Summary',
  tags: [],
  audience: '',
  prerequisite: '',
  outcome: '',
  updatedAt: '2026-11-09',
  minutes: 1,
};
const project = {
  id: '00000000-0000-4000-8000-000000000002',
  title: 'Project',
  descriptionPreview: 'Public explanation',
  githubUrl: '',
  demoUrl: '',
  publishedOn: '2026-11-09',
};
function client(value: unknown) {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(value));
  return { fetcher, client: createPublicStudentClient(fetcher) };
}
describe('ordinary combined public student transport', () => {
  it('accepts genuine one-sided emptiness and both activities with anonymous bounded transport', async () => {
    for (const v of [
      { author, entries: [entry], projects: [] },
      { author, entries: [], projects: [project] },
      { author, entries: [entry], projects: [project] },
    ]) {
      const c = client(v);
      expect(await c.client.read(author.id)).toEqual(v);
      expect(c.fetcher).toHaveBeenCalledWith(
        '/api/students/' + author.id,
        expect.objectContaining({ credentials: 'omit', cache: 'no-store', redirect: 'error' }),
      );
    }
  });
  it('rejects orphan, duplicate, private-field and malformed-side payloads without inventing an empty list', async () => {
    for (const value of [
      { author, entries: [], projects: [] },
      { author: { ...author, google_subject: 'private' }, entries: [entry], projects: [] },
      { author, entries: [{ ...entry, body: 'not a summary' }], projects: [project] },
      { author, entries: [entry], projects: [{ ...project, githubUrl: 'javascript:bad' }] },
      { author, entries: [entry, entry], projects: [] },
      { author, entries: [entry], projects: Array.from({ length: 21 }, () => project) },
    ]) {
      await expect(client(value).client.read(author.id)).rejects.toThrow(
        '投稿者の公開情報を確認できませんでした。',
      );
    }
  });
  it('rejects an invalid author before any fetch', async () => {
    const c = client({});
    await expect(c.client.read('../private')).rejects.toThrow();
    expect(c.fetcher).not.toHaveBeenCalled();
  });
});
