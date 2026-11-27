// 使われ方の計測の受け口（POST /api/usage）。docs/loop/GROWTH.md「計測」。
// cookie・セッション・D1 には触れない。確かめた1行を Workers Analytics Engine に書くだけ。
// ログに何も出さない（恒久条件）。binding が無い環境（preview・テスト）では書かずに 204。
import { readBoundedJson } from './http-boundary';
import { USAGE_BODY_LIMIT, USAGE_PATH, automatedAgent, usageRow } from '../src/shared/usage-event';

export interface UsageBindings {
  USAGE?: AnalyticsEngineDataset;
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
const done = (status: number) => new Response(null, { status, headers: HEADERS });

export async function handleUsage(
  request: Request,
  dataset: AnalyticsEngineDataset | undefined,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== USAGE_PATH) return null;
  if (request.method !== 'POST') {
    const response = done(405);
    response.headers.set('Allow', 'POST');
    return response;
  }
  // 自サイトの画面から送られたものだけ（他サイトからの水増しを減らす。curl は防げないので集計側でも外れ値を見る）
  if (request.headers.get('Origin') !== url.origin || url.search) return done(403);
  if (request.headers.get('Cookie')) return done(400); // credentials: 'omit' で送る約束
  const body = await readBoundedJson(request, { bytes: USAGE_BODY_LIMIT, chunks: 8 });
  if (!body.ok) return done(body.status);
  if (automatedAgent(request.headers.get('User-Agent'))) return done(204);
  const row = usageRow(body.value, url.hostname);
  if (!row) return done(400);
  try {
    dataset?.writeDataPoint({ indexes: [row.index], blobs: row.blobs, doubles: row.doubles });
  } catch {
    // 計測の失敗で利用者の画面を邪魔しない
  }
  return done(204);
}
