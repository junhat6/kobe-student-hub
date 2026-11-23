import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import type { OwnPublicationSummary } from '../own-publication-types';
import type { PublicationStopState } from '../publication-stop-types';
import { createPublicationStopClient } from './publication-stop-client';
import Icon from '../shared/Icon';
import './publication-stop-dialog.css';

// The student-facing stop: one confirmation dialog (YouTube Studio / note style).
// The safety rules of the lab panel stay: the dialog re-reads the server state first and
// only enables the stop when that state is the same published version the row showed;
// a failed or unknown result is never resent automatically.
export default function PublicationStopDialog({
  record,
  csrfToken,
  fetcher,
  parentBusy,
  onPending,
  onUncertain,
  onClose,
  onStopped,
}: {
  record: OwnPublicationSummary | null;
  csrfToken: string;
  fetcher: typeof fetch;
  parentBusy: boolean;
  onPending: (value: boolean) => void;
  onUncertain: (value: boolean) => void;
  onClose: () => void;
  onStopped: (record: OwnPublicationSummary) => void;
}) {
  const client = useMemo(() => createPublicationStopClient(fetcher), [fetcher]),
    generation = useRef(0),
    lock = useRef(false),
    request = useRef<AbortController | null>(null);
  const [value, setValue] = useState<PublicationStopState | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [problem, setProblem] = useState('');
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (busy || uncertain) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, uncertain]);
  // `action` returns the record it saw stopped. The parent hears of it only after the pending
  // flag is cleared, otherwise the parent's list refresh is still locked and would be skipped.
  async function run(
    action: (signal: AbortSignal, run: number) => Promise<OwnPublicationSummary | null>,
  ) {
    if (lock.current || parentBusy) return;
    lock.current = true;
    setBusy(true);
    onPending(true);
    const current = generation.current,
      controller = new AbortController();
    request.current = controller;
    let stopped: OwnPublicationSummary | null = null;
    try {
      stopped = await action(controller.signal, current);
    } finally {
      if (current === generation.current) {
        lock.current = false;
        setBusy(false);
        onPending(false);
        if (stopped) onStopped(stopped);
      }
    }
  }
  async function inspect(target: OwnPublicationSummary) {
    await run(async (signal, current) => {
      setValue(null);
      setProblem('');
      try {
        const result = await client.read(target.kind, target.publicId, signal);
        if (current !== generation.current) return null;
        setValue(result);
        setUncertain(false);
        onUncertain(false);
        // A previous unknown result did stop it: report the stop, never send it again.
        if (result.stopped) return target;
        if (result.sourceVersion !== target.sourceVersion || result.status !== 'published')
          setProblem('この公開はもう変わっています。閉じて一覧を見直してください。');
      } catch {
        if (current === generation.current)
          setProblem('いまの状態を確かめられませんでした。閉じてからもう一度開いてください。');
      }
      return null;
    });
  }
  async function stop(target: OwnPublicationSummary) {
    if (!ready) return;
    await run(async (signal, current) => {
      setProblem('');
      try {
        const result = await client.stop(
          target.kind,
          target.publicId,
          target.sourceVersion,
          csrfToken,
          true,
          signal,
        );
        if (current !== generation.current) return null;
        setValue(result);
        setUncertain(false);
        onUncertain(false);
        return target;
      } catch {
        if (current === generation.current) {
          setUncertain(true);
          onUncertain(true);
          setProblem(
            '止められたか分かりませんでした。自動では送り直しません。「確かめる」で今の状態を見てください。',
          );
        }
        return null;
      }
    });
  }
  useEffect(() => {
    generation.current++;
    request.current?.abort();
    lock.current = false;
    setValue(null);
    setUncertain(false);
    setProblem('');
    if (record) void inspect(record);
    return () => {
      generation.current++;
      request.current?.abort();
      lock.current = false;
      onPending(false);
    };
  }, [client, record]);
  const ready =
    !!record &&
    !busy &&
    !parentBusy &&
    !uncertain &&
    value?.kind === record.kind &&
    value.publicId === record.publicId &&
    value.sourceVersion === record.sourceVersion &&
    value.status === 'published' &&
    !value.stopped;
  const noun = record?.kind === 'project' ? '作品' : '記事';
  return (
    <AlertDialog.Root
      open={!!record}
      onOpenChange={(open) => {
        // Closing while a request is in flight would hide its result.
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="stop-dialog-backdrop" />
        <AlertDialog.Popup className="stop-dialog">
          <AlertDialog.Title className="stop-dialog-title">
            この{noun}の公開を止めますか？
          </AlertDialog.Title>
          <p className="stop-dialog-target">{record?.title}</p>
          <AlertDialog.Description className="stop-dialog-lines" render={<ul />}>
            <li>
              <Icon name="eye" size={18} />
              読む人のページから外れます。もう一度公開することはできません。
            </li>
            <li>
              <Icon name="lock" size={18} />
              下書きは残ります。
            </li>
          </AlertDialog.Description>
          <p className="stop-dialog-status" role="status" aria-live="polite">
            {busy && !value ? '確かめています…' : busy ? '止めています…' : ''}
          </p>
          {problem && (
            <p className="stop-dialog-problem" role="alert">
              {problem}
            </p>
          )}
          <div className="stop-dialog-actions">
            <AlertDialog.Close className="stop-dialog-cancel" disabled={busy}>
              やめる
            </AlertDialog.Close>
            {uncertain ? (
              <button
                type="button"
                className="stop-dialog-confirm"
                disabled={busy || parentBusy}
                onClick={() => record && void inspect(record)}
              >
                確かめる
              </button>
            ) : (
              <button
                type="button"
                className="stop-dialog-confirm is-danger"
                disabled={!ready}
                onClick={() => record && void stop(record)}
              >
                公開を止める
              </button>
            )}
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
