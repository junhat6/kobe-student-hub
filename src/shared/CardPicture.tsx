import { useState } from 'react';
import CardArt, { type CardArtInput } from './CardArt';
import { isCardImage } from './card-image';

/**
 * The picture frame of a public card (#311, C26 condition 5). With a public image the frame shows
 * it cropped to the frame (`object-fit: cover`; the image itself is unchanged), loaded lazily so a
 * long list fetches only what comes into view. The frame keeps its ratio before the image arrives,
 * so nothing below it moves. Without an image, or when the image can no longer be read (the
 * publication was stopped since the list was loaded), the drawn picture of #310 takes its place.
 * The picture repeats nothing the title says, so it stays decoration.
 */
export default function CardPicture({ image, ...art }: CardArtInput & { image?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (image && isCardImage(image) && failed !== image)
    return (
      <img
        className="content-card-image"
        src={image}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(image)}
      />
    );
  return <CardArt {...art} />;
}
