import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import './youtube.css';

export default function YouTubeEmbed({ videoId }: { videoId: string }) {
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const loaded = loadedId === videoId;
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const publicUrl = 'https://www.youtube.com/watch?v=' + videoId;
  return (
    <figure className="youtube-embed">
      {loaded ? (
        <>
          <iframe
            src={'https://www.youtube-nocookie.com/embed/' + videoId}
            title="YouTube動画"
            referrerPolicy="strict-origin"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
          <Button type="button" onClick={() => setLoadedId(null)}>
            動画を閉じる
          </Button>
        </>
      ) : (
        <div className="youtube-placeholder">
          <Button type="button" className="primary" onClick={() => setLoadedId(videoId)}>
            YouTube動画を読み込む
          </Button>
          <p>読み込むとYouTubeに接続します。</p>
        </div>
      )}
      <figcaption>
        <a href={publicUrl} target="_blank" rel="noopener noreferrer">
          YouTubeで開く
        </a>
      </figcaption>
    </figure>
  );
}
