import type { Profile, PublishedArticleSummary } from './types';
import type { PublicProjectSummary } from './project-types';

export interface PublicStudent {
  author: Profile;
  entries: PublishedArticleSummary[];
  projects: PublicProjectSummary[];
}
