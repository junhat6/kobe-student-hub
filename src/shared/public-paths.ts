export type PublicSurface = 'lab' | 'ordinary';

/** Keep the existing local fixtures separate from the ordinary student app. */
export function publicPaths(surface: PublicSurface) {
  const ordinary = surface === 'ordinary';
  return {
    feed: ordinary ? '/' : '/lab/discover',
    account: ordinary ? '/account' : '/lab/account',
    article: (id: string) => `${ordinary ? '/articles/' : '/lab/articles/'}${id}`,
    author: (id: string) => `${ordinary ? '/students/' : '/lab/authors/'}${id}`,
    likes: (id: string) => (ordinary ? `/students/${id}/likes` : `/lab/likes/${id}`),
    articlesApi: ordinary ? '/api/articles' : '/__lab/discovery',
    articleApi: (id: string) => `${ordinary ? '/api/articles/' : '/__lab/articles/'}${id}`,
    authorApi: (id: string) => `${ordinary ? '/api/authors/' : '/__lab/authors/'}${id}`,
    likesApi: (id: string) => (ordinary ? `/api/authors/${id}/likes` : `/__lab/likes/${id}`),
  };
}
