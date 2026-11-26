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

/**
 * The author card beside an article or project (#312): public counts and the newest few public
 * items by title. No likes, views or followers.
 */
export interface PublicAuthorCard {
  articles: number;
  projects: number;
  /** Newest first, at most 4 so the page can drop the item being read and still show 3. */
  recent: { kind: 'article' | 'project'; id: string; title: string }[];
}
