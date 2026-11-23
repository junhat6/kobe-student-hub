import { useCallback, useEffect, useRef, useState } from 'react';
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
/** How long 「元に戻す」 stays offered before the deletion is sent (Gmail's undo window). */
export const UNDO_MS = 6000;
const basisLabel = (line: TasteLine) =>
  line.basis === 'instruction'
    ? '本人の指示'
    : line.basis === 'reviews'
      ? `レビュー ${line.count}件`
      : `差分 ${line.count}件`;
const sameLine = (a: TasteLine, b: TasteLine) => a.kind === b.kind && a.text === b.text;
const FAILED = 'できませんでした。もう一度試してください。';

/**
 * マイページ：あなたのエージェントが書いた好み（C23 条件4）。1行ずつ消す・運営に見せるを
 * 切り替える。既定は見せない。まだ1行も無いときは何も出さない（作るのはエージェント）。
 *
 * 消すときは Gmail・Google ドライブの型に寄せ、行をすぐ隠して「元に戻す」を数秒出し、その間は
 * サーバーへ送らない（戻すのに復元 API が要らない）。時間切れ・次の操作・画面を離れるときに送る。
 * 成功は静かに（読み上げだけ）、失敗だけを見える文字で出す。
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
  const [error, setError] = useState('');
  const [announce, setAnnounce] = useState('');
  const [pending, setPending] = useState<TasteLine | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  /** Sends one operation on the line as it stands in the latest view; returns false on failure. */
  const send = useCallback(
    async (op: TasteActionOp, line: TasteLine, keepalive = false) => {
      const current = viewRef.current;
      const index = current ? current.lines.findIndex((l) => sameLine(l, line)) : -1;
      if (!current || index < 0) return true;
      try {
        const r = await fetcher(PATH, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          keepalive,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: proofAuthorization('csrf', csrfToken),
          },
          body: JSON.stringify({
            op,
            version: current.version,
            index,
            kind: line.kind,
            text: line.text,
          }),
        });
        const next = r.ok ? decodeOwnTasteView(await r.json()) : null;
        if (next) {
          viewRef.current = next;
          setView(next);
          return true;
        }
        setError(
          r.status === 409
            ? 'ほかの変更があったので、最新の内容に更新しました。もう一度試してください。'
            : r.status === 403
              ? '在籍期間の外なので、運営に見せることはできません。'
              : FAILED,
        );
        await load();
      } catch {
        setError(FAILED);
      }
      return false;
    },
    [csrfToken, fetcher, load],
  );

  /** Sends the deletion that is waiting behind 「元に戻す」, if any. */
  const flush = useCallback(
    async (keepalive = false) => {
      clearTimeout(timer.current);
      const line = pendingRef.current;
      if (!line) return true;
      pendingRef.current = null;
      setPending(null);
      return send('delete', line, keepalive);
    },
    [send],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  // Leaving the page (or this screen) must not silently drop a deletion the student asked for.
  useEffect(() => {
    const leave = () => void flush(true);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [flush]);

  async function run(work: () => Promise<boolean>, done: string) {
    setBusy(true);
    setError('');
    setAnnounce('');
    try {
      if ((await work()) && done) setAnnounce(done);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (line: OwnTasteView['lines'][number]) =>
    run(
      async () => (await flush()) && send(line.shared ? 'unshare' : 'share', line),
      line.shared ? '運営に見せるのをやめました。' : '運営に見せています。',
    );
  const remove = (line: TasteLine) =>
    run(async () => {
      if (!(await flush())) return false;
      pendingRef.current = line;
      setPending(line);
      timer.current = setTimeout(() => void run(() => flush(), ''), UNDO_MS);
      return true;
    }, '');
  function undo() {
    clearTimeout(timer.current);
    pendingRef.current = null;
    setPending(null);
    setAnnounce('元に戻しました。');
  }

  const lines = view?.lines.filter((line) => !pending || !sameLine(line, pending)) ?? [];
  if (!view || (lines.length === 0 && !pending)) return null;
  return (
    <section id="my-taste" className="account-block own-taste" aria-labelledby="own-taste-title">
      <h2 id="own-taste-title">あなたの好み</h2>
      {lines.length > 0 && (
        <ul className="own-taste-lines">
          {lines.map((line) => (
            <li key={line.kind + line.text}>
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
                onClick={() => void toggle(line)}
              >
                <Icon name={line.shared ? 'eye' : 'lock'} />
              </Button>
              <Button
                className="icon-button own-taste-button"
                disabled={busy}
                aria-label={`削除：${line.text}`}
                title="削除"
                onClick={() => void remove(line)}
              >
                <Icon name="trash" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="own-taste-error" role="alert">
          {error}
        </p>
      )}
      <p className="sr-only" role="status">
        {announce}
      </p>
      {pending && (
        <div className="own-taste-undo" role="status">
          <span>1行消しました</span>
          <Button className="own-taste-undo-button" onClick={undo}>
            元に戻す
          </Button>
        </div>
      )}
    </section>
  );
}
