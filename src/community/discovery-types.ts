import type { PublicDiscoveryCard } from '../types';
import type { PublicProjectDiscovery } from '../project-types';
export interface OrdinaryDiscovery {
  recent: PublicDiscoveryCard[];
  popular: (PublicDiscoveryCard & { likeCount: number })[];
}
export interface RelatedDiscovery {
  articles: (PublicDiscoveryCard & { matchingTag: string })[];
  projects: (PublicProjectDiscovery['cards'][number] & { matchingTag: string })[];
}
