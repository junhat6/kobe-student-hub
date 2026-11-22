import type { Profile, PublishedArticleSummary } from './types';
import type { PublicProjectSummary } from './project-types';

export interface PublicStudent {
  author: Profile;
  /** Versioned same-origin icon path, or null to show the initial. */
  avatar: string | null;
  entries: PublishedArticleSummary[];
  projects: PublicProjectSummary[];
}
