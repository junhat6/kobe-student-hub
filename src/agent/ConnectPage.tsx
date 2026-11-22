import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@base-ui/react/button';
import AccountSessionBoundary from '../account/AccountSessionBoundary';
import { createAgentConnectionsClient, type ConsentRequest } from './connections-client';
import '../account/account.css';
import './agent.css';

/**
 * 「接続を許可」: the student's own AI agent asks to act as them through MCP.
 * The decision is bound server-side to the signed-in session; nothing here is trusted.
 */
function Consent({
  requestId,
  csrfToken,
  fetcher,
}: {
  requestId: string;
  csrfToken: string;
  fetcher: typeof fetch;
}) {
  const client = createAgentConnectionsClient(csrfToken, fetcher);
  const [request, setRequest] = useState<ConsentRequest | 'unavailable' | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'too-many' | 'failed' | 'leaving'>(
    'idle',
  );
  useEffect(() => {
    const controller = new AbortController();
    client
      .readRequest(requestId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setRequest(value === 'signed-out' ? 'unavailable' : value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRequest('unavailable');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, csrfToken]);
  async function decide(decision: 'allow' | 'deny') {
    setState('sending');
    try {
      const result = await client.decide(requestId, decision);
      if (typeof result === 'object') {
        setState('leaving');
        window.location.assign(result.redirectTo);
      } else setState(result === 'too-many' ? 'too-many' : 'failed');
    } catch {
      setState('failed');
    }
  }
  if (request === null) return <p role="status">接続の依頼を確認しています…</p>;
  if (request === 'unavailable')
    return (
      <p role="alert">
        この接続の依頼は使えません（期限の10分を過ぎたか、すでに決めた依頼です）。AIエージェントの画面からもう一度接続してください。
      </p>
    );
  return (
    <div className="agent-consent">
      <p className="agent-consent-lead">
        <strong>{request.clientName}</strong>
        が、あなたとして Kobe Student Hub につなぐ許可を求めています。
      </p>
      <dl className="agent-consent-facts">
        <dt>できること</dt>
        <dd>公開記事を読む／あなたの下書きを一覧・読む・作る・直す（非公開のまま）</dd>
        <dt>できないこと</dt>
        <dd>公開・削除、プロフィール・いいね・通報、ほかの人の下書き</dd>
        <dt>許可を渡す先</dt>
        <dd>{request.destination}</dd>
        <dt>期限</dt>
        <dd>90日。マイページの「AIエージェントとの接続」でいつでも解除できます。</dd>
      </dl>
      <p className="agent-consent-note">
        心当たりのない依頼なら「許可しない」を押してください。作られた下書きは、あなたが読んで下書き画面の「記事を公開する」から公開するまで誰にも見えません。
      </p>
      {state === 'too-many' && (
        <p role="alert">
          接続は10件までです。マイページで使っていない接続を解除してから、もう一度接続してください。
        </p>
      )}
      {state === 'failed' && (
        <p role="alert">送れませんでした。AIエージェントの画面からもう一度接続してください。</p>
      )}
      {state === 'leaving' && <p role="status">AIエージェントに戻ります…</p>}
      <div className="agent-consent-actions">
        <Button
          className="primary"
          disabled={state !== 'idle' && state !== 'failed'}
          onClick={() => void decide('allow')}
        >
          接続を許可する
        </Button>
        <Button
          disabled={state !== 'idle' && state !== 'failed'}
          onClick={() => void decide('deny')}
        >
          許可しない
        </Button>
      </div>
    </div>
  );
}

export default function ConnectPage() {
  const requestId = new URLSearchParams(useLocation().search).get('request') ?? '';
  return (
    <section className="account-page agent-connect">
      <AccountSessionBoundary
        title="AIエージェントとの接続"
        signedOutContent={
          <div className="account-signed-out">
            <p>接続を許可するには、学校Googleでログインしてください。</p>
            <a className="primary" href="/login" target="_blank" rel="noopener">
              新しいタブでログインする
            </a>
            <p>ログインしたら、このタブに戻って「ログイン状態を確認」を押してください。</p>
          </div>
        }
      >
        {({ csrfToken, fetcher }) =>
          /^[A-Za-z0-9_-]{43}$/.test(requestId) ? (
            <Consent requestId={requestId} csrfToken={csrfToken} fetcher={fetcher} />
          ) : (
            <p role="alert">
              接続の依頼が見つかりません。AIエージェントの画面からもう一度接続してください。
              <Link to="/agents">つなぎ方</Link>
            </p>
          )
        }
      </AccountSessionBoundary>
    </section>
  );
}
