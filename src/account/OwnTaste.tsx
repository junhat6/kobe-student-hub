import { useCallback, useEffect, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { proofAuthorization } from '../shared/auth-proof';
import Icon from '../shared/Icon';
import {
  decodeOwnTasteView,
  type OwnTasteView,
  type TasteActionOp,
  type TasteLine,
} from '../shared/taste-ledger';
import './own-taste.css';

const PATH = '/api/private/my-taste';
const basisLabel = (line: TasteLine) =>
  line.basis === 'instruction'
    ? '本人の指示'
    : line.basis === 'reviews'
      ? `レビュー ${line.count}件`
      : `差分 ${line.count}件`;

/**
 * マイページ：あなたのエージェントが書いた好みの台帳（C23 条件4）。1行ずつ消す・運営に見せるを
 * 切り替える。既定は見せない。台帳がまだ無いときは何も出さない（作るのはエージェント）。
 */
export default function OwnTaste({
  csrfToken,
  fetcher,
}: {
  csrfToken: string;
  fetcher: typeof fetch;
}) {
  const [view, setView] = useState<OwnTasteView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetcher(PATH, {
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal,
        });
        const next = r.ok ? decodeOwnTasteView(await r.json()) : null;
        if (!signal?.aborted) setView(next);
      } catch {
        /* the section stays hidden */
      }
    },
    [fetcher],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function act(op: TasteActionOp, index: number) {
    if (!view) return;
    const line = view.lines[index];
    setBusy(true);
    setMessage('');
    try {
      const r = await fetcher(PATH, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: proofAuthorization('csrf', csrfToken),
        },
        body: JSON.stringify({
          op,
          version: view.version,
          index,
          kind: line.kind,
          text: line.text,
        }),
      });
      const next = r.ok ? decodeOwnTasteView(await r.json()) : null;
      if (next) {
        setView(next);
        setMessage(
          op === 'delete'
            ? '1行消しました。'
            : op === 'share'
              ? '運営に見せています。'
              : '運営に見せるのをやめました。',
        );
      } else {
        setMessage(
          r.status === 409
            ? 'エージェントが台帳を書き換えていました。最新の台帳を表示しています。'
            : r.status === 403
              ? '在籍期間の外なので、運営に見せることはできません。'
              : 'できませんでした。もう一度試してください。',
        );
        await load();
      }
    } catch {
      setMessage('できませんでした。もう一度試してください。');
    } finally {
      setBusy(false);
    }
  }
  if (!view || view.lines.length === 0) return null;
  return (
    <section id="my-taste" className="account-block own-taste" aria-labelledby="own-taste-title">
      <h2 id="own-taste-title">あなたの好み</h2>
      <ul className="own-taste-lines">
        {view.lines.map((line, i) => (
          <li key={i + line.kind + line.text}>
            <div className="own-taste-text">
              <span>{line.text}</span>
              <small>
                {line.kind === 'writing' ? '執筆' : 'アプリ'} · {basisLabel(line)} · {line.date}
              </small>
            </div>
            <Button
              className="icon-button own-taste-button"
              disabled={busy}
              aria-pressed={line.shared}
              aria-label={`運営に見せる：${line.text}`}
              title={line.shared ? '運営に見せています' : '運営に見せる'}
              onClick={() => void act(line.shared ? 'unshare' : 'share', i)}
            >
              <Icon name={line.shared ? 'eye' : 'lock'} />
            </Button>
            <Button
              className="icon-button own-taste-button"
              disabled={busy}
              aria-label={`削除：${line.text}`}
              title="削除"
              onClick={() => void act('delete', i)}
            >
              <Icon name="trash" />
            </Button>
          </li>
        ))}
      </ul>
      {message && (
        <p className="own-taste-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
