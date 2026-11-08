import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { createMediaClient, prepareImage } from './media-client';
import PrivateImage from './PrivateImage';
import { publicMediaPath, type MediaReceipt } from '../shared/media';
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
    [message, setMessage] = useState('画像を確認しています…'),
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
    void client.list(kind, draft.id).then(
      (v) => {
        if (current.current) {
          setImages(v);
          setMessage('画像は私的に保存されます。本文を保存し、公開前に確認してください。');
        }
      },
      () => {
        if (current.current) setMessage('画像一覧を確認できませんでした。');
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
      setMessage(
        '私的な画像を保存し、本文へ参照を入れました。本文を保存して、公開前に画像も確認してください。',
      );
    } catch {
      if (current.current)
        setMessage(
          '保存結果を確認できませんでした。同じ画像の確認・再送を選べます。自動では再送しません。',
        );
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
    <section className="media-attachments" aria-label="下書きの画像">
      <h3>画像を添える</h3>
      <p>
        JPEG・PNGを縮小して保存します。1枚512
        KiB・下書き8枚まで。保存しただけでは公開されません。位置情報などのメタデータは除去します。
      </p>
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png"
        aria-label="下書きへ画像を追加"
        disabled={disabled || busy || Boolean(pending) || images.length >= 8}
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) void select(selected);
        }}
      />
      <p aria-live="polite">{message}</p>
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
              setMessage('送信はしません。保存済み画像一覧を読み直してください。');
            }}
          >
            手元の再送を取り下げる
          </Button>
        </div>
      )}
      <Button
        disabled={disabled || busy}
        onClick={() =>
          void run(async (signal) => {
            try {
              const v = await client.list(kind, draft.id, signal);
              if (current.current) {
                setImages(v);
                setMessage('保存済みの私的画像を確認しました。');
              }
            } catch {
              if (current.current) setMessage('画像一覧を確認できませんでした。');
            }
          })
        }
      >
        保存済み画像を確認
      </Button>
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
