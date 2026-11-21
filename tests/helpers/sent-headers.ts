import type { BrowserContext, Page, Route } from '@playwright/test';

export type SentRequest = {
  url: URL;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
};

/**
 * Records the headers each matching request is actually sent with, without request.allHeaders().
 *
 * allHeaders() waits for Chromium's requestWillBeSentExtraInfo, which can arrive after Playwright
 * stops tracking the request, so the promise may never settle under CI load (#134, #135).
 * While a route is installed, Chromium pauses the request at the network stage and
 * request.headers() already holds the final header set, including Cookie and Origin, so the
 * evidence is read synchronously before the request leaves. Without a route, request.headers()
 * omits Cookie, so a "no cookie" check would pass vacuously; never drop the route.
 *
 * Page routes run before context routes, and this handler only falls back, so existing routes
 * (fake Google, fixtures) keep their behaviour.
 */
export async function recordSentHeaders(
  target: BrowserContext | Page,
  match: (url: URL) => boolean,
) {
  const sent: SentRequest[] = [];
  let open = true;
  await target.route(match, async (route: Route) => {
    const request = route.request();
    if (open)
      sent.push({
        url: new URL(request.url()),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
      });
    await route.fallback();
  });
  return {
    sent,
    /** Ends the observation window synchronously; later requests are not recorded. */
    stop() {
      open = false;
    },
  };
}

/** Header names that must never accompany an anonymous public read. */
const IDENTITY_HEADERS = ['cookie', 'x-csrf-token', 'authorization'] as const;

/** Lists "path header" for every identity header found, so a failure names the request. */
export function identityHeadersOf(sent: SentRequest[]) {
  return sent.flatMap((r) =>
    IDENTITY_HEADERS.filter((name) => Object.hasOwn(r.headers, name)).map(
      (name) => r.url.pathname + ' ' + name,
    ),
  );
}

/**
 * Records sent headers of every hop of a page's navigations, including redirect hops.
 *
 * Routes never see a redirect hop (only the first URL of a chain is routed), so those headers
 * come from raw CDP events instead of Playwright's request tracker. Chromium keeps one requestId
 * across a redirect chain and emits requestWillBeSent and requestWillBeSentExtraInfo once per hop,
 * each in hop order, so the n-th event of each kind describes the same hop. ExtraInfo carries the
 * Cookie header the network stack attached.
 */
export async function recordRedirectHops(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  const chains = new Map<
    string,
    {
      hops: { url: string; method: string; postData?: string }[];
      headers: Record<string, string>[];
    }
  >();
  const chain = (id: string) => {
    let value = chains.get(id);
    if (!value) chains.set(id, (value = { hops: [], headers: [] }));
    return value;
  };
  cdp.on('Network.requestWillBeSent', (event) => {
    chain(event.requestId).hops.push({
      url: event.request.url,
      method: event.request.method,
      postData: event.request.postData,
    });
  });
  cdp.on('Network.requestWillBeSentExtraInfo', (event) => {
    chain(event.requestId).headers.push(
      Object.fromEntries(
        Object.entries(event.headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
      ),
    );
  });
  await cdp.send('Network.enable');
  return {
    /**
     * Matching hops whose ExtraInfo has arrived. A hop still missing its ExtraInfo is reported
     * as `missing` so the caller can poll for it instead of mistaking it for "no cookie".
     */
    sent(match: (url: URL, method: string) => boolean) {
      const sent: SentRequest[] = [];
      let missing = 0;
      for (const { hops, headers } of chains.values())
        hops.forEach((hop, index) => {
          const url = new URL(hop.url);
          if (!match(url, hop.method)) return;
          if (!headers[index]) missing++;
          else
            sent.push({
              url,
              method: hop.method,
              headers: headers[index],
              postData: hop.postData ?? null,
            });
        });
      return { sent, missing };
    },
    detach: () => cdp.detach(),
  };
}
