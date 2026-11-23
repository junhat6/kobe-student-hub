import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import { createAgentConnectionsClient, type AgentConnection } from './connections-client';
import './agent.css';

const day = (ms: number) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium' }).format(ms);

/** マイページ：接続中のAIエージェント。解除すると、そのエージェントは直後から使えない。 */
export default function AgentConnections({
  csrfToken,
  fetcher,
}: {
  csrfToken: string;
  fetcher: typeof fetch;
}) {
  const [items, setItems] = useState<AgentConnection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const client = createAgentConnectionsClient(csrfToken, fetcher);
  async function load(signal?: AbortSignal) {
    try {
      const state = await client.list(signal);
      if (signal?.aborted) return;
      setFailed(!state);
      setItems(state?.connections ?? null);
    } catch {
      if (!signal?.aborted) setFailed(true);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // The client is recreated per render; the session proof decides when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csrfToken, fetcher]);
  async function revoke(item: AgentConnection) {
    setBusy(item.id);
    setMessage('');
    try {
      const ok = await client.revoke(item.id);
      setMessage(
        ok
          ? `「${item.clientName}」との接続を解除しました。`
          : '解除できませんでした。もう一度試してください。',
      );
      await load();
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="account-block agent-connections" aria-labelledby="agent-connections-title">
      <h2 id="agent-connections-title">AIエージェントとの接続</h2>
      {failed ? (
        <p role="alert">接続の一覧を読み込めませんでした。ページを再読み込みしてください。</p>
      ) : items === null ? (
        <p role="status">読み込んでいます…</p>
      ) : items.length === 0 ? (
        <p>
          接続中のAIエージェントはありません。<Link to="/agents#connect">つなぎ方</Link>
        </p>
      ) : (
        <ul className="agent-connection-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.clientName}</strong>
                <small>
                  許可した日 {day(item.createdAt)} · 最後に使った日 {day(item.lastUsedAt)} · 期限{' '}
                  {day(item.expiresAt)}
                </small>
              </div>
              <Button
                className="agent-button"
                disabled={busy !== null}
                aria-label={`${item.clientName}との接続を解除`}
                onClick={() => void revoke(item)}
              >
                解除
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="agent-connections-note">
        接続したエージェントができるのは、公開記事を読むこと、あなたの下書きを作る・直すこと、公開済みの記事を公開したまま直すことだけです。初めての公開・削除はできません。
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
