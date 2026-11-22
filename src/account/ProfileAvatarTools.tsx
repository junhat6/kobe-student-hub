import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { createAvatarClient, prepareAvatar } from '../editor/avatar-client';
import Icon from '../shared/Icon';

/**
 * Camera and trash controls beside the own profile icon. Results are announced through the
 * editor's status line; an unclear write is re-read instead of resent.
 */
export default function ProfileAvatarTools({
  csrfToken,
  fetcher,
  avatar,
  onChange,
  onMessage,
}: {
  csrfToken: string;
  fetcher: typeof fetch;
  avatar: string | null;
  onChange: (avatar: string | null) => void;
  onMessage: (message: string) => void;
}) {
  const client = useMemo(() => createAvatarClient(csrfToken, fetcher), [csrfToken, fetcher]);
  const input = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    mounted.current = true;
    client.read().then(
      (value) => mounted.current && change.current(value),
      () => {},
    );
    return () => {
      mounted.current = false;
    };
  }, [client]);
  async function settle(action: () => Promise<string>, failure: string) {
    setBusy(true);
    setError('');
    try {
      const note = await action();
      if (mounted.current) onMessage(note);
    } catch (problem) {
      if (!mounted.current) return;
      // Show what the server actually holds now, then say what went wrong.
      await client.read().then(
        (value) => mounted.current && onChange(value),
        () => {},
      );
      setError(
        problem instanceof Error && problem.name !== 'AvatarClientError'
          ? problem.message
          : problem instanceof Error && problem.message.startsWith('この画像')
            ? problem.message
            : failure,
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="profile-avatar-tools">
        <Button
          className="icon-button"
          aria-label="アイコン画像を変える"
          title="アイコン画像を変える"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Icon name="camera" size={18} />
        </Button>
        {avatar && (
          <Button
            className="icon-button"
            aria-label="アイコン画像を消す"
            title="アイコン画像を消す"
            disabled={busy}
            onClick={() =>
              void settle(async () => {
                await client.remove();
                onChange(null);
                return 'アイコン画像を消しました。';
              }, '消せませんでした。もう一度押してください。')
            }
          >
            <Icon name="trash" size={18} />
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void settle(async () => {
              const prepared = await prepareAvatar(file);
              onChange(await client.upload(prepared));
              return 'アイコン画像を変えました。';
            }, '変えられませんでした。もう一度選んでください。');
          }}
        />
      </div>
      {error && (
        <p className="profile-editor-error profile-avatar-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
