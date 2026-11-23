import type { Profile, PublishedArticleSummary } from './types';
import type { PublicProjectSummary } from './project-types';

export interface PublicStudent {
  author: Profile;
  /** Versioned same-origin icon path, or null to show the initial. */
  avatar: string | null;
  entries: PublishedArticleSummary[];
  projects: PublicProjectSummary[];
}

/** Public activity per Japan calendar day. Only days with at least one public event are listed. */
export interface PublicStudentActivity {
  /** First day of the window, YYYY-MM-DD (Japan). */
  from: string;
  /** Today, YYYY-MM-DD (Japan). */
  to: string;
  days: { date: string; count: number }[];
}

/** Likes received per public article (most-liked first, at most 20). Counts only, no likers. */
export interface PublicReceivedLikes {
  articles: { id: string; title: string; likes: number }[];
}
