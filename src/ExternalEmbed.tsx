import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { type Embed, embedFrameUrl, embedPublicUrl } from './shared/embed';
import './embed.css';

const LABELS = {
  youtube: {
    title: 'YouTube動画',
    load: 'YouTube動画を読み込む',
    notice: '読み込むとYouTubeに接続します。',
    close: '動画を閉じる',
    open: 'YouTubeで開く',
  },
  map: {
    title: 'Google マップ',
    load: '地図を読み込む',
    notice: '読み込むとGoogleに接続します。',
    close: '地図を閉じる',
    open: null,
  },
  instagram: {
    title: 'Instagramの投稿',
    load: 'Instagramの投稿を読み込む',
    notice: '読み込むとInstagramに接続します。',
    close: '投稿を閉じる',
    open: 'Instagramで開く',
  },
} as const;

/**
 * Click-to-load frame for an official embed. Nothing connects to the provider until the reader
 * presses the button; maps and Instagram also run sandboxed so they cannot navigate this page.
 */
export default function ExternalEmbed({ embed }: { embed: Embed }) {
  const src = embedFrameUrl(embed);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  const label = LABELS[embed.kind];
  const publicUrl = embedPublicUrl(embed);
  return (
    <figure className={'external-embed external-embed-' + embed.kind}>
      {loaded ? (
        <>
          {embed.kind === 'youtube' ? (
            <iframe
              src={src}
              title={label.title}
              referrerPolicy="strict-origin"
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : (
            <iframe
              src={src}
              title={label.title}
              referrerPolicy="strict-origin"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              loading="lazy"
            />
          )}
          <Button type="button" onClick={() => setLoadedSrc(null)}>
            {label.close}
          </Button>
        </>
      ) : (
        <div className="embed-placeholder">
          <Button type="button" className="primary" onClick={() => setLoadedSrc(src)}>
            {label.load}
          </Button>
          <p>{label.notice}</p>
        </div>
      )}
      {publicUrl && label.open && (
        <figcaption>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer">
            {label.open}
          </a>
        </figcaption>
      )}
    </figure>
  );
}
