import { useEffect, useMemo, useState } from 'react';
import { createMediaClient } from './media-client';
/** Never puts an authenticated endpoint in <img>. Blob creation waits for the guarded stream's EOF check. */
export default function PrivateImage({
  id,
  alt,
  fetcher,
  scopeKey,
}: {
  id: string;
  alt: string;
  fetcher: typeof fetch;
  scopeKey: string;
}) {
  const client = useMemo(() => createMediaClient(scopeKey, fetcher), [scopeKey, fetcher]);
  const [value, setValue] = useState<{ id: string; scope: string; url: string } | null>(null);
  const [revision, setRevision] = useState(0),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true,
      url: string | undefined;
    setValue(null);
    setFailed(false);
    void client.read(id).then(
      (blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setValue({ id, scope: scopeKey, url });
      },
      () => {
        if (live) {
          setValue(null);
          setFailed(true);
        }
      },
    );
    return () => {
      live = false;
      // An ordinary preview replacement drains the bounded request through the guard's EOF.
      // The session owner cancels invalid scopes. A component unmount never weakens that check.
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, id, scopeKey, revision]);
  return value?.id === id && value.scope === scopeKey ? (
    <img className="content-image" src={value.url} alt={alt} loading="lazy" />
  ) : (
    <span className="image-unavailable">
      {alt || '画像'}（私的プレビューを確認中、または取得できません）
      {failed && (
        <button type="button" onClick={() => setRevision((n) => n + 1)}>
          画像を再確認
        </button>
      )}
    </span>
  );
}
