import type { PublicDiscoveryCard } from '../types';
import type { ProjectDiscoveryCard } from '../project-types';
export interface OrdinaryDiscovery {
  recent: PublicDiscoveryCard[];
  popular: (PublicDiscoveryCard & { likeCount: number })[];
}
export interface RelatedDiscovery {
  articles: (PublicDiscoveryCard & { matchingTag: string })[];
  projects: (ProjectDiscoveryCard & { matchingTag: string })[];
  /** Projects whose author linked this article when publishing them. */
  linkedProjects: ProjectDiscoveryCard[];
}
