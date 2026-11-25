// Local-only standalone project model, separate from article/minutes/report semantics.
import type { Profile } from './types';
export interface ProjectFields {
  title: string;
  description: string;
  githubUrl: string;
  demoUrl: string;
  /** Optional one-line list of technologies used (comma separated, 100 characters). */
  technologies: string;
}
/** 制作中 or 完成 (#275). Lives on the public snapshot only; older snapshots are 'complete'. */
export type ProjectStage = 'in_progress' | 'complete';
export const PROJECT_STAGES: readonly ProjectStage[] = ['in_progress', 'complete'];
export const isProjectStage = (v: unknown): v is ProjectStage =>
  v === 'in_progress' || v === 'complete';
export interface ProjectDraft extends ProjectFields {
  id: string;
  version: number;
  updatedAt: number;
}
export type ProjectDraftSummary = Pick<ProjectDraft, 'id' | 'title' | 'version' | 'updatedAt'>;
export interface PublicProject extends ProjectFields {
  id: string;
  publishedOn: string;
  stage: ProjectStage;
}
export interface PublicProjectSummary {
  id: string;
  title: string;
  descriptionPreview: string;
  githubUrl: string;
  demoUrl: string;
  publishedOn: string;
  stage: ProjectStage;
}
export interface PublicProjectReader {
  project: PublicProject;
  author: Profile;
}
/** Owner-linked articles that are still public; title only so the project page stays bounded. */
export interface PublicProjectArticleLink {
  id: string;
  title: string;
}
/** A journal article the owner linked after publishing (#273); shown oldest first with its first public day. */
export interface PublicProjectJournalEntry {
  id: string;
  title: string;
  publishedOn: string;
}
/** Most journal links one project keeps (also enforced by the 0046 insert trigger). */
export const PROJECT_JOURNAL_LIMIT = 20;
export interface PublicProjectPage extends PublicProjectReader {
  articles: PublicProjectArticleLink[];
  journal: PublicProjectJournalEntry[];
}
/** Owner view of a published project's journal links: fixed at publish time vs. added later. */
export interface ProjectJournal {
  projectId: string;
  fixedArticleIds: string[];
  articleIds: string[];
  /** The same links in order with the owner's own title and whether the article is still public. */
  articles: { id: string; title: string; isPublic: boolean }[];
}
export interface PublicAuthorProjects {
  author: Profile;
  projects: PublicProjectSummary[];
}
export interface ProjectReceipt {
  publication: ({ projectId: string; sourceVersion: number } & PublicProjectReader) | null;
}

// Recent cross-author discovery intentionally omits full descriptions, biography and external URLs.
export type ProjectDiscoverySummary = Pick<
  PublicProjectSummary,
  'id' | 'title' | 'descriptionPreview' | 'publishedOn'
>;
/** Cross-author card used by home and related reading; it carries no stage. */
export interface ProjectDiscoveryCard {
  project: ProjectDiscoverySummary;
  author: Pick<Profile, 'id' | 'name' | 'department' | 'year' | 'initials'>;
}
/** The works list (/api/projects) adds only the stage to each card (#275). */
export interface PublicProjectDiscovery {
  cards: (Omit<ProjectDiscoveryCard, 'project'> & {
    project: ProjectDiscoverySummary & Pick<PublicProjectSummary, 'stage'>;
  })[];
}
