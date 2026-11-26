import { useEffect, useMemo, useState } from 'react';
import { MEDIA_PER_DRAFT, referencedMediaIds } from '../shared/media';
import { createCardImageClient } from './card-image-client';
import Icon from '../shared/Icon';
import PrivateImage from './PrivateImage';
import './media.css';

/**
 * #311 (C26 condition 5): the owner picks which attached image the public card shows, or leaves
 * it to the default (the first image in the body). Only images this saved version refers to are
 * offered; the card shows the choice once it is in the public version, and falls back to the
 * default when the image leaves it. Each change is saved at once; nothing here uploads.
 * #319: every option shows the picture the card would get (the default shows the first image), so
 * no explanation is needed; a saved choice is a check mark with its words for screen readers, and
 * only a failure stays as visible words.
 */
export default function CardImageChooser({
  kind,
  draftId,
  body,
  csrfToken,
  fetcher,
}: {
  kind: 'articles' | 'projects';
  draftId: string;
  body: string;
  csrfToken: string;
  fetcher: typeof fetch;
}) {
  const client = useMemo(() => createCardImageClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const ids = referencedMediaIds(body).slice(0, MEDIA_PER_DRAFT);
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setChoice(undefined);
    setFailed(false);
    client.read(kind, draftId, controller.signal).then(
      (value) => setChoice(value.mediaId),
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [client, kind, draftId, attempt]);
  if (!ids.length) return null;
  const where = kind === 'articles' ? '本文' : '説明';
  const pick = async (next: string | null) => {
    if (busy || next === choice) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await client.choose(kind, draftId, next);
      setChoice(saved.mediaId);
      setMessage({
        text: saved.mediaId ? 'カードに出す画像を保存しました。' : '既定に戻しました。',
        ok: true,
      });
    } catch {
      setMessage({ text: '保存できませんでした。時間をおいてもう一度選んでください。', ok: false });
    } finally {
      setBusy(false);
    }
  };
  const missing = typeof choice === 'string' && !ids.includes(choice);
  const checked = (value: string | null) =>
    value === null ? choice === null || missing : choice === value;
  return (
    <fieldset className="card-image-chooser" disabled={busy || (choice === undefined && !failed)}>
      <legend>カードに出す画像</legend>
      {failed ? (
        <p role="alert">
          いまの選択を確認できませんでした。
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            もう一度確認
          </button>
        </p>
      ) : (
        <div className="card-image-options">
          <label className="card-image-option">
            <input
              type="radio"
              name={`card-image-${draftId}`}
              checked={checked(null)}
              onChange={() => void pick(null)}
            />
            <span>
              既定<span className="sr-only">（{where}の最初の画像）</span>
            </span>
            <PrivateImage id={ids[0]} alt="" fetcher={fetcher} scopeKey={csrfToken} />
          </label>
          {ids.map((id, index) => (
            <label className="card-image-option" key={id}>
              <input
                type="radio"
                name={`card-image-${draftId}`}
                checked={checked(id)}
                onChange={() => void pick(id)}
              />
              <span>{`${String(index + 1)}枚目の画像`}</span>
              <PrivateImage
                id={id}
                alt={`${String(index + 1)}枚目の画像`}
                fetcher={fetcher}
                scopeKey={csrfToken}
              />
            </label>
          ))}
        </div>
      )}
      {missing && <p>選んでいた画像はいまの{where}に無いため、カードには既定の画像が出ます。</p>}
      <p
        className={
          'card-image-status' + (message && !message.ok ? ' card-image-status--error' : '')
        }
        role="status"
        aria-live="polite"
      >
        {message?.ok && <Icon name="check" size={18} />}
        <span className={message?.ok ? 'sr-only' : undefined}>{message?.text}</span>
      </p>
    </fieldset>
  );
}
