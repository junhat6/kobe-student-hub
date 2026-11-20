import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import type { PublicSurface } from './public-paths';

/** Client-side navigation in the student app; the router-less local labs keep plain anchors. */
export default function SurfaceLink({
  surface,
  to,
  ...rest
}: { surface: PublicSurface; to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return surface === 'ordinary' ? <Link to={to} {...rest} /> : <a href={to} {...rest} />;
}
