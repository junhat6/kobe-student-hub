export type ContentKind = 'article' | 'project';
export interface Profile { id: string; name: string; department: string; year: string; bio: string; initials: string; }
export interface Entry { id: string; kind: ContentKind; title: string; summary: string; body: string; tags: string[]; authorId: string; audience: string; prerequisite: string; outcome: string; updatedAt: string; minutes: number; relatedIds: string[]; }
export interface Catalog { entries: Entry[]; profiles: Profile[]; mode: 'sample'; }
