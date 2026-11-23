import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { createMediaClient, MediaLimitError, prepareImage } from './media-client';
import PrivateImage from './PrivateImage';
import { MEDIA_PER_DRAFT, publicMediaPath, type MediaReceipt } from '../shared/media';
import './media.css';
interface Props {
  kind: 'articles' | 'projects';
  draft: { id: string; version: number };
  csrfToken: string;
  fetcher: typeof fetch;
  disabled: boolean;
  onInsert: (text: string) => void;
  onBusy?: (busy: boolean) => void;
  onUncertain?: (uncertain: boolean) => void;
}
export default function MediaAttachments({
  kind,
  draft,
  csrfToken,
  fetcher,
  disabled,
  onInsert,
  onBusy,
  onUncertain,
}: Props) {
  const client = useMemo(() => createMediaClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const [images, setImages] = useState<MediaReceipt[]>([]),
    [message, setMessage] = useState(''),
    [loaded, setLoaded] = useState(false),
    [listFailed, setListFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{ id: string; blob: Blob; version: number } | null>(null);
  const current = useRef(true),
    locked = useRef(false),
    file = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    current.current = true;
    setImages([]);
    setPending(null);
    setLoaded(false);
    setListFailed(false);
    setMessage('');
    // The panel reads its own list; a retry is offered only when that read fails.
    void client.list(kind, draft.id).then(
      (v) => {
        if (current.current) {
          setImages(v);
          setLoaded(true);
        }
      },
      () => {
        if (current.current) {
          setListFailed(true);
          setLoaded(true);
          setMessage('保存した画像を読み込めませんでした。');
        }
      },
    );
    return () => {
      current.current = false;
      // Bounded reads/writes finish their EOF session proof and discard late results.
      // Scope invalidation remains owned by the shared session guard.
      onBusy?.(false);
    };
  }, [client, kind, draft.id, onBusy]);
  useEffect(() => {
    onUncertain?.(Boolean(pending));
    return () => onUncertain?.(false);
  }, [pending, onUncertain]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true;
    setBusy(true);
    onBusy?.(true);
    controller.current = new AbortController();
    try {
      await action(controller.current.signal);
    } finally {
      locked.current = false;
      controller.current = null;
      if (current.current) {
        setBusy(false);
        onBusy?.(false);
      }
    }
  }
  async function reload(signal: AbortSignal, done: string) {
    try {
      const v = await client.list(kind, draft.id, signal);
      if (current.current) {
        setImages(v);
        setListFailed(false);
        setMessage(done);
      }
    } catch {
      if (current.current) {
        setListFailed(true);
        setMessage('保存した画像を読み込めませんでした。');
      }
    }
  }
  async function send(command: { id: string; blob: Blob; version: number }, signal: AbortSignal) {
    setPending(command);
    try {
      const r = await client.upload(
        kind,
        draft.id,
        command.version,
        command.id,
        command.blob,
        signal,
      );
      if (!current.current) return;
      setPending(null);
      setImages((old) => [...old.filter((i) => i.id !== r.id), r]);
      onInsert(`\n\n![画像](${publicMediaPath(r.id)})\n`);
      setMessage('画像を保存して本文に入れました。位置情報などは消してあります。');
    } catch (error) {
      if (!current.current) return;
      if (error instanceof MediaLimitError) {
        // A definitive refusal: nothing was saved, so there is nothing to confirm or resend.
        setPending(null);
        setMessage(error.message);
        return;
      }
      setMessage('画像を保存できたか分かりませんでした。');
    }
  }
  async function select(selected: File) {
    await run(async (signal) => {
      try {
        setMessage('画像を縮小・最適化しています…');
        const blob = await prepareImage(selected);
        if (!current.current || signal.aborted) return;
        await send({ id: crypto.randomUUID(), blob, version: draft.version }, signal);
      } catch (error) {
        if (current.current)
          setMessage(error instanceof Error ? error.message : '画像の準備ができませんでした。');
      }
    });
    if (file.current) file.current.value = '';
  }
  return (
    <section className="media-attachments" aria-label="下書きの画像" aria-busy={!loaded}>
      <div className="media-head">
        <h3>画像</h3>
        <span className="media-private">
          <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12">
            <path
              d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v7h-9z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          公開するまで本人だけ
        </span>
        <label
          className={
            'media-pick' +
            (disabled || !loaded || busy || Boolean(pending) || images.length >= MEDIA_PER_DRAFT
              ? ' is-disabled'
              : '')
          }
        >
          <span aria-hidden="true">＋ 画像を選ぶ</span>
          <input
            className="media-file"
            ref={file}
            type="file"
            accept="image/jpeg,image/png"
            aria-label="下書きへ画像を追加"
            disabled={
              disabled || !loaded || busy || Boolean(pending) || images.length >= MEDIA_PER_DRAFT
            }
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) void select(selected);
            }}
          />
        </label>
      </div>
      <p aria-live="polite">{message}</p>
      {loaded && !listFailed && images.length >= MEDIA_PER_DRAFT && (
        <p className="media-note">画像は1つの下書きに{MEDIA_PER_DRAFT}枚までです。</p>
      )}
      {pending && (
        <div>
          <p>結果未確定の画像があります。別の画像を送る前に確認してください。</p>
          <Button
            disabled={disabled || busy || pending.version !== draft.version}
            onClick={() => void run((signal) => send(pending, signal))}
          >
            同じ画像の保存を確認・再送
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setPending(null);
              // Re-read what the server actually kept instead of asking the student to do it.
              if (disabled) {
                setListFailed(true);
                setMessage('再送は取り下げました。');
              } else void run((signal) => reload(signal, '再送は取り下げました。'));
            }}
          >
            手元の再送を取り下げる
          </Button>
        </div>
      )}
      {listFailed && (
        <Button
          disabled={disabled || busy}
          onClick={() => void run((signal) => reload(signal, ''))}
        >
          もう一度
        </Button>
      )}
      <div className="media-grid">
        {images.map((image) => (
          <figure key={image.id}>
            <PrivateImage id={image.id} alt="下書きの画像" fetcher={fetcher} scopeKey={csrfToken} />
            <figcaption>
              {image.width} × {image.height} · {Math.ceil(image.bytes / 1024)} KiB
            </figcaption>
            <Button
              disabled={disabled || busy || Boolean(pending)}
              onClick={() => onInsert(`\n\n![画像](${publicMediaPath(image.id)})\n`)}
            >
              本文へ参照を入れる
            </Button>
            <Button
              disabled={disabled || busy}
              onClick={() => {
                if (
                  !window.confirm(
                    '未公開で、保存した本文から参照を外した画像だけ削除できます。削除しますか？',
                  )
                )
                  return;
                void run(async (signal) => {
                  try {
                    await client.remove(image.id, signal);
                    if (current.current) {
                      setImages((old) => old.filter((i) => i.id !== image.id));
                      setMessage('画像を削除しました。');
                    }
                  } catch {
                    if (current.current)
                      setMessage(
                        '削除を確認できません。本文から参照を外して保存したか、公開版に含まれていないか確認してください。',
                      );
                  }
                });
              }}
            >
              画像を削除
            </Button>
          </figure>
        ))}
      </div>
    </section>
  );
}
