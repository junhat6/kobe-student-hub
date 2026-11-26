type ContentKind = 'article' | 'project';
export interface Profile {
  id: string;
  name: string;
  department: string;
  year: string;
  bio: string;
  initials: string;
}
export interface Entry {
  id: string;
  kind: ContentKind;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  authorId: string;
  audience: string;
  prerequisite: string;
  outcome: string;
  updatedAt: string;
  /** UTC ISO time behind `updatedAt` for published articles (#308); absent in the sample catalog. */
  publishedAt?: string;
  minutes: number;
  relatedIds: string[];
}
export interface Catalog {
  entries: Entry[];
  profiles: Profile[];
  mode: 'sample';
}

/** Public article detail. `publication` is omitted when the first public revision cannot be read. */
export interface PublishedArticleDetail {
  entry: Entry;
  author: Profile;
  /** Japan day of the first public revision; `revised` is true once a later revision was published. */
  publication?: { publishedOn: string; publishedAt?: string; revised: boolean };
}

export type PublishedArticleSummary = Pick<
  Entry,
  | 'id'
  | 'title'
  | 'summary'
  | 'tags'
  | 'audience'
  | 'prerequisite'
  | 'outcome'
  | 'updatedAt'
  | 'publishedAt'
  | 'minutes'
>;
export interface PublicAuthorArticles {
  author: Profile;
  entries: PublishedArticleSummary[];
}

export type PublicArticleAuthor = Pick<Profile, 'id' | 'name' | 'department' | 'year' | 'initials'>;
export interface PublicDiscoveryCard {
  entry: PublishedArticleSummary;
  author: PublicArticleAuthor;
}
export interface PublicDiscovery {
  cards: PublicDiscoveryCard[];
}

// Local-only public likes prototype; never includes private identity or like timestamps.
export interface PublicLikedArticles {
  profile: PublicArticleAuthor;
  entries: PublishedArticleSummary[];
}
